// MineOs sunucu servisi: WebSocket proxy + Minecraft sunucu yöneticisi (tek Railway servisi).
// Sunucular 127.0.0.1'de çalışır, tarayıcı proxy üzerinden bağlanır. Dünyalar DATA_DIR (volume) içinde kalır.
const express = require('express'), netApi = require('net-browserify'), compression = require('compression'), cors = require('cors')
const { spawn } = require('child_process'), fs = require('fs'), path = require('path')
const DATA = process.env.DATA_DIR || '/data', KEY = process.env.PROVIDER_KEY || ''
const IDLE_MS = (+process.env.IDLE_MINUTES || 5) * 60000, MAX_RUNNING = +process.env.MAX_RUNNING || 3, RAM = process.env.SERVER_RAM || '1G'
fs.mkdirSync(DATA, { recursive: true })
const REG = path.join(DATA, 'servers.json')
const reg = () => { try { return JSON.parse(fs.readFileSync(REG)) } catch { return {} } }
const procs = {}

async function jar (version) {
  const f = path.join(DATA, 'jars', `${version}.jar`)
  if (fs.existsSync(f)) return f
  fs.mkdirSync(path.dirname(f), { recursive: true })
  const m = await (await fetch('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json')).json()
  const v = m.versions.find(x => x.id === version)
  if (!v) throw Error('Bilinmeyen sürüm: ' + version)
  const d = await (await fetch(v.url)).json()
  fs.writeFileSync(f + '.tmp', Buffer.from(await (await fetch(d.downloads.server.url)).arrayBuffer()))
  fs.renameSync(f + '.tmp', f)
  return f
}

async function start (id) {
  const s = reg()[id]
  if (!s) throw Error('Sunucu kayıtlı değil')
  if (procs[id]) return procs[id]
  if (Object.keys(procs).length >= MAX_RUNNING) throw Error('Şu an çok sunucu açık, birazdan tekrar dene.')
  const e = procs[id] = { ready: false, players: new Set(), idleSince: Date.now() }
  try {
    const dir = path.join(DATA, 'worlds', id); fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'eula.txt'), 'eula=true\n')
    fs.writeFileSync(path.join(dir, 'server.properties'),
      `server-ip=127.0.0.1\nserver-port=${s.port}\nmax-players=${s.maxPlayers}\nonline-mode=false\nmotd=${String(s.name).replace(/[\r\n]/g, ' ')}\nview-distance=8\n`)
    e.p = spawn('java', ['-Xms256M', `-Xmx${RAM}`, '-jar', await jar(s.version), 'nogui'], { cwd: dir })
    let buf = ''
    e.p.stdout.on('data', d => {
      buf += d; let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const l = buf.slice(0, i); buf = buf.slice(i + 1); let m
        if (/Done \(/.test(l)) { e.ready = true; e.idleSince = Date.now() }
        if ((m = l.match(/\]: (\S+) joined the game/))) e.players.add(m[1])
        if ((m = l.match(/\]: (\S+) left the game/))) { e.players.delete(m[1]); if (!e.players.size) e.idleSince = Date.now() }
      }
    })
    e.p.on('exit', () => { delete procs[id] })
  } catch (err) { delete procs[id]; throw err }
  return e
}

// Boşta kalan sunucuyu kapat (dünya kaydedilir)
setInterval(() => {
  for (const e of Object.values(procs)) if (e.ready && !e.players.size && Date.now() - e.idleSince > IDLE_MS) e.p.stdin.write('stop\n')
}, 30000)
const shutdown = () => { Object.values(procs).forEach(e => e.p && e.p.stdin.write('stop\n')); setTimeout(() => process.exit(0), 20000) }
process.on('SIGTERM', shutdown)

const app = express()
app.use(compression()); app.use(cors()); app.use(netApi({ allowOrigin: '*', timeout: 10000 }))
app.get('/health', (q, r) => r.send('ok'))
const api = express.Router()
api.use(express.json())
api.use((q, r, n) => (KEY && q.headers.authorization === 'Bearer ' + KEY) ? n() : r.status(401).json({ error: 'yetkisiz' }))
api.post('/', (q, r) => {
  const all = reg(), b = q.body
  if (!all[b.id]) {
    const port = 25600 + Object.keys(all).length
    all[b.id] = { id: b.id, name: b.name, version: b.version, maxPlayers: Math.min(+b.maxPlayers || 50, 50), port }
    fs.writeFileSync(REG, JSON.stringify(all))
  }
  r.json(all[b.id])
})
api.post('/:id/start', async (q, r) => {
  try { await start(q.params.id); r.json({ ok: true }) } catch (e) { r.status(500).json({ error: e.message }) }
})
api.get('/:id', (q, r) => {
  const s = reg()[q.params.id]; if (!s) return r.status(404).json({ error: 'yok' })
  const e = procs[q.params.id]
  r.json({ ready: !!(e && e.ready), host: '127.0.0.1', port: s.port, players: e ? e.players.size : 0 })
})
app.use('/servers', api)
app.listen(process.env.PORT || 8080, () => console.log('MineOs servisi hazır'))
