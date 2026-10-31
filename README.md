# MineOs kurulum (2 parça)

## 1) Railway: sunucu servisi (önce bunu yap)
1. Bu repoyu GitHub'a yükle. Railway > New Project > Deploy from GitHub > bu repo.
2. Servis ayarı: Root Directory = `railway`. (Dockerfile otomatik bulunur.)
3. Variables: `PROVIDER_KEY` = uzun rastgele bir şifre. İsteğe bağlı: `MAX_RUNNING` (aynı anda açık sunucu, varsayılan 3), `SERVER_RAM` (varsayılan 1G), `IDLE_MINUTES` (varsayılan 5).
4. Volume ekle: Mount path = `/data` (dünyalar burada kalır, bunu yapmazsan dünyalar silinir).
5. Settings > Networking > Generate Domain. Çıkan adres = RAILWAY_URL.

## 2) Netlify: tek site
1. Netlify > Add new site > Import from Git > aynı repo. Ayarlar `netlify.toml`'dan gelir.
2. Environment variables:
   - `MINEOS_SECRET` = uzun rastgele metin
   - `PROVIDER_URL` = RAILWAY_URL
   - `PROVIDER_KEY` = Railway'dekiyle aynı
   - `PROXY_URL` = RAILWAY_URL
3. Deploy. Site adresi: ana sayfa MineOs, oyun `/client/` altında.

Sürümler: 1.21.4, 1.20.1, 1.19.4, 1.18.2 (Mojang EULA'yı kabul etmiş sayılırsın).
