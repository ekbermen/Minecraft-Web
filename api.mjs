import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";

export const config = { path: "/api/*" };

const SECRET = process.env.MINEOS_SECRET || "degistir-bunu";
const MAX_PLAYERS = 50, WAKE_MS = 35000, MAX_SERVERS = 3;
const users = () => getStore("users"), servers = () => getStore("servers");
const VERSIONS = ["1.21.4", "1.20.1", "1.19.4", "1.18.2"];
const out = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
const b64 = (s) => Buffer.from(s).toString("base64url");
const sign = (p) => crypto.createHmac("sha256", SECRET).update(p).digest("base64url");

const hash = (pw, salt = crypto.randomBytes(16).toString("hex")) =>
  ({ salt, h: crypto.scryptSync(pw, salt, 32).toString("hex") });
const makeToken = (u) => { const p = b64(JSON.stringify({ u, exp: Date.now() + 30 * 864e5 })); return p + "." + sign(p); };
function auth(req) {
  const [p, s] = (req.headers.get("authorization") || "").replace("Bearer ", "").split(".");
  if (!p || s !== sign(p)) return null;
  const d = JSON.parse(Buffer.from(p, "base64url")); return d.exp > Date.now() ? d.u : null;
}

// Sunucuyu gerçekten açıp kapatan servis (Railway'de çalışacak) PROVIDER_URL ile bağlanır.
// Yoksa simülasyon modu: ~35 sn sonra "açıldı" sayılır.
const P = process.env.PROVIDER_URL, PH = { authorization: "Bearer " + (process.env.PROVIDER_KEY || "") };
const provider = {
  create: (s) => P && fetch(`${P}/servers`, { method: "POST", headers: PH, body: JSON.stringify(s) }),
  wake: (s) => P && fetch(`${P}/servers/${s.id}/start`, { method: "POST", headers: PH }),
  async ready(s) {
    if (!P) return Date.now() - s.startedAt >= WAKE_MS ? { host: "play.example.com", port: 25565 } : null;
    const r = await (await fetch(`${P}/servers/${s.id}`, { headers: PH })).json();
    return r.ready ? { host: r.host, port: r.port } : null;
  }
};

export default async (req) => { try { return await handle(req); } catch (e) { return out({ error: "Sunucu servisine ulaşılamadı: " + e.message }, 502); } };
async function handle(req) {
  const path = new URL(req.url).pathname.replace(/^\/(\.netlify\/functions\/api|api)\/?/, "");
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const [a, id, act] = path.split("/");

  if (a === "register") {
    const { username, password, password2, email } = body;
    if (!/^[A-Za-z0-9_]{3,16}$/.test(username || "")) return out({ error: "Kullanıcı adı 3-16 karakter, harf/rakam/_ olmalı." }, 400);
    if ((password || "").length < 6) return out({ error: "Şifre en az 6 karakter olmalı." }, 400);
    if (password !== password2) return out({ error: "İki şifre aynı değil." }, 400);
    const key = username.toLowerCase();
    if (await users().get(key)) return out({ error: "Bu kullanıcı adı alınmış." }, 409);
    // E-posta sadece saklanır, doğrulama/mesaj yok.
    await users().setJSON(key, { username, email: email || "", ...hash(password), createdAt: Date.now() });
    return out({ token: makeToken(username), username });
  }
  if (a === "login") {
    const u = await users().get((body.username || "").toLowerCase(), { type: "json" });
    if (!u || hash(body.password || "", u.salt).h !== u.h) return out({ error: "Kullanıcı adı veya şifre yanlış." }, 401);
    return out({ token: makeToken(u.username), username: u.username });
  }

  const me = auth(req);
  if (!me) return out({ error: "Giriş yapmalısın." }, 401);
  const prefix = me.toLowerCase() + ":";

  if (a === "servers" && !id) {
    if (req.method === "GET") {
      const { blobs } = await servers().list({ prefix });
      return out(await Promise.all(blobs.map((b) => servers().get(b.key, { type: "json" }))));
    }
    const { blobs } = await servers().list({ prefix });
    if (blobs.length >= MAX_SERVERS) return out({ error: `En fazla ${MAX_SERVERS} sunucu açabilirsin.` }, 400);
    const s = { id: crypto.randomUUID().slice(0, 8), owner: me, name: String(body.name || "Sunucum").slice(0, 24),
      version: VERSIONS.includes(body.version) ? body.version : "1.21.4", maxPlayers: MAX_PLAYERS, status: "sleeping", startedAt: null, createdAt: Date.now() };
    await servers().setJSON(prefix + s.id, s); await provider.create(s);
    return out(s);
  }

  const s = await servers().get(prefix + id, { type: "json" });
  if (!s) return out({ error: "Sunucu bulunamadı." }, 404);
  const save = () => servers().setJSON(prefix + id, s);

  if (act === "join") {            // oyuncu girmek isteyince: uyuyorsa uyandır
    if (s.status === "sleeping" || P) { s.status = "starting"; s.startedAt = Date.now(); await save(); await provider.wake(s); }
  }
  if (s.status === "starting") {   // hazır mı?
    const r = await provider.ready(s);
    if (r) { Object.assign(s, { status: "running", ...r }); await save(); }
  }
  return out({ ...s, proxy: process.env.PROXY_URL || "", elapsed: s.startedAt ? Date.now() - s.startedAt : 0, wakeMs: WAKE_MS, simulated: !P });
}
