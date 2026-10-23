// Rekam video demo Sempat yang sinkron dengan narasi. Urutan:
//   1. backend/.venv/Scripts/python docs/demo/tts.py      (buat klip suara + durasi)
//   2. node e2e/record-demo.mjs                           (rekam video, catat waktu tiap narasi)
//   3. backend/.venv/Scripts/python docs/demo/mux.py      (gabungkan suara ke MP4)
import { chromium } from 'playwright-core'
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const BASE = process.env.SEMPAT_URL ?? 'http://localhost:5173'
const OUT = fileURLToPath(new URL('../../docs/demo/', import.meta.url))
const RAW = `${OUT}_raw/`
mkdirSync(RAW, { recursive: true })
// Kartu judul memuat logo dan fon dari server aplikasi (file:// diblokir peramban).
const LOGO = `${BASE}/brand/sempat-logo.png`
const FONT = (w) => `${BASE}/node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-${w}-normal.woff2`
const NARASI = JSON.parse(readFileSync(`${OUT}narasi.json`, 'utf8'))
const DURASI = JSON.parse(readFileSync(`${OUT}_tts/durasi.json`, 'utf8'))
const LINE = Object.fromEntries(NARASI.lines.map((l) => [l.id, l]))
const W = 1440
const H = 810

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: RAW, size: { width: W, height: H } }, locale: 'id-ID', timezoneId: 'Asia/Jakarta' })

// Kursor tiruan dan bilah keterangan yang bertahan antar-halaman.
await ctx.addInitScript(() => {
  const css = `
    #__cur{position:fixed;z-index:2147483647;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;
      background:rgba(245,165,27,.35);border:2px solid #f5a51b;pointer-events:none;transition:transform .12s}
    #__cur.down{transform:scale(.7);background:rgba(245,165,27,.7)}
    #__cap{position:fixed;z-index:2147483646;left:50%;bottom:28px;transform:translateX(-50%);max-width:1100px;
      background:rgba(22,22,22,.92);color:#fff;font:500 21px/1.4 'IBM Plex Sans',Arial,sans-serif;padding:12px 22px;
      pointer-events:none;border-left:4px solid #f5a51b;transition:opacity .25s}
    #__cap:empty{opacity:0}`
  const store = {
    get: (k, d) => {
      try {
        return sessionStorage.getItem(k) ?? d
      } catch {
        return d
      }
    },
    set: (k, v) => {
      try {
        sessionStorage.setItem(k, v)
      } catch {
        /* halaman tanpa origin */
      }
    },
  }
  const boot = () => {
    if (document.getElementById('__cur')) return
    const st = document.createElement('style')
    st.textContent = css
    document.head.appendChild(st)
    const c = document.createElement('div')
    c.id = '__cur'
    const p = JSON.parse(store.get('__curpos', '[720,400]'))
    c.style.left = p[0] + 'px'
    c.style.top = p[1] + 'px'
    document.body.appendChild(c)
    const cap = document.createElement('div')
    cap.id = '__cap'
    cap.textContent = store.get('__cap', '')
    document.body.appendChild(cap)
    addEventListener('mousemove', (e) => {
      c.style.left = e.clientX + 'px'
      c.style.top = e.clientY + 'px'
      store.set('__curpos', JSON.stringify([e.clientX, e.clientY]))
    }, true)
    addEventListener('mousedown', () => c.classList.add('down'), true)
    addEventListener('mouseup', () => c.classList.remove('down'), true)
  }
  window.__boot = boot
  window.__setCap = (t) => {
    store.set('__cap', t)
    boot()
    const el = document.getElementById('__cap')
    if (el) el.textContent = t
  }
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', boot)
  else boot()
})

const page = await ctx.newPage()
const T0 = Date.now()
const marks = []
const wait = (ms) => page.waitForTimeout(ms)
const setCap = (t) => page.evaluate((x) => window.__setCap?.(x), t).catch(() => {})
// Mulai satu baris narasi: keterangan tampil dan waktunya dicatat; hasilnya fungsi "tunggu narasi selesai".
const say = async (id) => {
  const start = Date.now()
  marks.push({ id, t: (start - T0) / 1000 })
  await setCap(LINE[id].caption)
  const end = start + DURASI[id] * 1000 + 450
  return () => wait(Math.max(0, end - Date.now()))
}
const glide = (x, y) => page.mouse.move(x, y, { steps: 22 })
const press = async () => {
  await page.mouse.down()
  await wait(90)
  await page.mouse.up()
}
const clickOn = async (loc, pause = 350) => {
  let b
  for (let i = 0; i < 6 && !b; i++) {
    try {
      await loc.waitFor({ state: 'visible', timeout: 10000 })
      await loc.scrollIntoViewIfNeeded({ timeout: 3000 })
      await wait(150)
      b = await loc.boundingBox()
    } catch {
      await wait(400)
    }
  }
  if (!b) throw new Error('elemen tidak dapat diklik')
  await glide(b.x + b.width / 2, b.y + b.height / 2)
  await wait(pause)
  await press()
}
const clickXY = async (x, y) => {
  await glide(x, y)
  await wait(400)
  await press()
}
const typeIn = async (loc, text) => {
  await clickOn(loc, 200)
  await page.keyboard.type(text, { delay: 55 })
}
const mapPoint = (lon, lat) =>
  page.evaluate(([lo, la]) => {
    const m = window.__sempatMap
    const p = m.project([lo, la])
    const r = m.getCanvas().getBoundingClientRect()
    return [r.left + p.x, r.top + p.y]
  }, [lon, lat])
const api = (path, method = 'GET', body) =>
  page.evaluate(
    async ([p, m, b]) => (await fetch(`/api${p}`, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined })).json(),
    [path, method, body],
  )
const scrollPanelToTabs = () =>
  page.locator('.workspace-panel').evaluate((el) => {
    const t = el.querySelector('[role="tablist"]')
    el.scrollTo({ top: t.offsetTop - 20, behavior: 'smooth' })
  })
const card = (inner) => `<!doctype html><html><head><style>
  @font-face{font-family:Plex;font-weight:300;src:url('${FONT(300)}') format('woff2')}
  @font-face{font-family:Plex;font-weight:600;src:url('${FONT(600)}') format('woff2')}
  body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#161616;font-family:Plex,Arial,sans-serif;color:#fff}
  #__cur{display:none!important}
  </style></head><body>${inner}</body></html>`
let cardHtml = ''
let cardN = 0
await page.route(`${BASE}/__kartu*`, (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: cardHtml }))
const showCard = async (inner) => {
  cardHtml = card(inner)
  await page.goto(`${BASE}/__kartu?n=${++cardN}`)
  await page.evaluate(async () => {
    await document.fonts.ready
    await Promise.all([...document.images].map((i) => (i.complete ? null : new Promise((r) => (i.onload = i.onerror = r)))))
  })
}

// --- 0. Kartu judul ---------------------------------------------------------------------------
await showCard(`<div style="display:flex;align-items:center;gap:40px;max-width:1150px">
  <img src="${LOGO}" style="width:180px;height:180px">
  <div>
    <div style="font-size:68px;font-weight:600;letter-spacing:-1px">Sempat</div>
    <div style="font-size:28px;font-weight:300;color:#e0e0e0;margin-top:6px">Uji kecukupan tempat evakuasi sementara tsunami · Kota Bengkulu</div>
    <div style="font-size:18px;font-weight:300;color:#a8a8a8;margin-top:22px">Demo aplikasi web · data contoh sintetis</div>
  </div></div>`)
await wait(600)
let done = await say('judul')
await done()

// --- 1. Masuk ---------------------------------------------------------------------------------
await page.goto(`${BASE}/masuk`)
const demoAnalis = page.getByRole('button', { name: /Masuk sebagai Demo Analis/ })
const demoPeneliti = page.getByRole('button', { name: /Masuk sebagai Demo Peneliti/ })
await demoAnalis.waitFor()
done = await say('masuk')
// Sorot panel akun demo: Peneliti dulu, lalu Analis yang diklik.
await wait(1200)
const bp = await demoPeneliti.boundingBox()
await glide(bp.x + bp.width * 0.7, bp.y + bp.height / 2)
await wait(1800)
const ba = await demoAnalis.boundingBox()
await glide(ba.x + ba.width * 0.7, ba.y + ba.height / 2)
await done()
await clickOn(demoAnalis)
await page.getByRole('heading', { name: 'Dasbor' }).waitFor()
await wait(500)
done = await say('dasbor')
await done()

// --- 2. Data -----------------------------------------------------------------------------------
await clickOn(page.getByRole('navigation', { name: 'Navigasi utama' }).getByRole('link', { name: 'Data' }))
await clickOn(page.getByRole('link', { name: /Data contoh/ }).first())
await page.getByText('Laporan validasi').waitFor()
done = await say('data')
await wait(4500)
await page.mouse.wheel(0, 700)
await done()
await page.getByRole('heading', { name: 'Laporan validasi' }).scrollIntoViewIfNeeded()
await page.mouse.wheel(0, -60)
done = await say('validasi')
await done()

// --- 3. Buat skenario --------------------------------------------------------------------------
await clickOn(page.getByRole('navigation', { name: 'Navigasi utama' }).getByRole('link', { name: 'Skenario' }))
done = await say('skenario')
await wait(1500)
await clickOn(page.getByRole('button', { name: /Buat skenario/ }).first())
await page.getByLabel('Nama skenario (opsional)').waitFor()
await typeIn(page.getByLabel('Nama skenario (opsional)'), 'Demo esai — jalan kaki, jeda 10 menit')
await done()
await clickOn(page.getByRole('button', { name: 'Buat dan buka editor' }))
await page.getByRole('button', { name: /Jalankan skenario dasar/ }).waitFor()
await wait(1200)

done = await say('jeda')
await clickOn(page.getByLabel('Jeda respons τ'))
await page.keyboard.press('Control+A')
await page.keyboard.type('10', { delay: 140 })
await done()
done = await say('jalankan')
await clickOn(page.getByRole('button', { name: /Jalankan skenario dasar/ }))
await page.getByText('Perhitungan selesai.').waitFor({ timeout: 60000 })
await done()
done = await say('peta')
await done()

// --- 4. Hasil + rute ---------------------------------------------------------------------------
await clickOn(page.getByRole('button', { name: 'Lihat hasil' }))
await page.waitForURL(/\/hasil\//)
await page.getByText('indeks kecukupan kota').waitFor()
await wait(800)
done = await say('ik')
const runId = page.url().split('/hasil/')[1].split('?')[0]
const cells = (await api(`/runs/${runId}/cells`)).features
const pick = cells
  .filter((f) => f.properties.kelas === 'terlambat' && f.properties.jarak_m > 900 && f.properties.jarak_m < 1700)
  .sort((a, b) => b.properties.penduduk - a.properties.penduduk)[0]
const ring = pick.geometry.coordinates[0]
const clon = (ring[0][0] + ring[2][0]) / 2
const clat = (ring[0][1] + ring[2][1]) / 2
await done()
await page.evaluate(([lo, la]) => window.__sempatMap.easeTo({ center: [lo, la], zoom: 13.4, duration: 1600 }), [clon, clat])
done = await say('klik')
await wait(1800)
const [px, py] = await mapPoint(clon, clat)
await clickXY(px, py)
await page.locator('#cell-title').waitFor()
await done()
done = await say('rute')
await done()

await scrollPanelToTabs()
await wait(700)
await clickOn(page.getByRole('tab', { name: /Prioritas/ }))
await wait(500)
await clickOn(page.locator('details summary', { hasText: 'Syarat yang terpenuhi' }).first())
done = await say('prioritas')
await done()
await clickOn(page.getByRole('tab', { name: 'Beban TES' }))
done = await say('beban')
await done()

// --- 5. Uji intervensi -------------------------------------------------------------------------
await clickOn(page.getByRole('link', { name: /Demo esai/ }).first())
await page.getByRole('button', { name: 'Taruh TES hipotetis' }).waitFor()
await wait(1200)
done = await say('tes_baru')
await clickOn(page.getByRole('button', { name: 'Taruh TES hipotetis' }))
await page.evaluate(([lo, la]) => window.__sempatMap.easeTo({ center: [lo, la], zoom: 12.6, duration: 1200 }), [clon, clat])
await wait(1500)
const [tx, ty] = await mapPoint(clon, clat)
await clickXY(tx, ty)
await page.getByLabel('Kapasitas (jiwa)').waitFor()
await typeIn(page.getByLabel('Kapasitas (jiwa)'), '3000')
await clickOn(page.getByRole('button', { name: 'Tambahkan TES' }))
await done()
done = await say('sirene')
await clickOn(page.getByRole('button', { name: 'Tambah', exact: true }))
await done()
done = await say('uji')
await clickOn(page.getByRole('button', { name: /Uji \d+ intervensi/ }))
await page.getByText('Perhitungan selesai.').waitFor({ timeout: 60000 })
await done()
await clickOn(page.getByRole('button', { name: 'Lihat selisih' }))
await page.waitForURL(/bandingkan/)
await page.getByText('Selisih IK kota').waitFor()
await wait(1200)
done = await say('banding')
await done()
await page.getByText('Selisih IK kota').scrollIntoViewIfNeeded()
await page.mouse.wheel(0, 120)
done = await say('selisih')
await done()

// --- 6. Laporan --------------------------------------------------------------------------------
const b = new URL(page.url()).searchParams.get('b')
await page.goto(`${BASE}/hasil/${b}?tab=laporan`)
await page.getByText('indeks kecukupan kota').waitFor()
await scrollPanelToTabs()
await wait(900)
done = await say('laporan')
await done()
await page.locator('.workspace-panel').evaluate((el) => el.scrollBy({ top: 260, behavior: 'smooth' }))
done = await say('publik')
await done()

// --- 7. Penutup --------------------------------------------------------------------------------
await setCap('')
await showCard(`<div style="text-align:center;max-width:1050px">
  <img src="${LOGO}" style="width:130px;height:130px">
  <div style="font-size:42px;font-weight:300;margin-top:26px">Dari setiap sel permukiman, apakah warga sempat?</div>
  <div style="font-size:20px;font-weight:300;color:#c6c6c6;margin-top:18px">Hasil adalah uji kecukupan pada skenario terpilih, bukan prediksi tsunami.</div>
  <div style="font-size:19px;color:#f5a51b;margin-top:30px">sempat.onrender.com</div>
  <div style="font-size:17px;font-weight:300;color:#a8a8a8;margin-top:8px">Masuk sekali klik dengan tombol akun demo Analis atau Peneliti</div></div>`)
await setCap('')
done = await say('penutup')
await done()
await wait(1200)

const video = page.video()
await ctx.close()
renameSync(await video.path(), `${OUT}sempat-demo.webm`)
rmSync(RAW, { recursive: true, force: true })
writeFileSync(`${OUT}_tts/marks.json`, JSON.stringify(marks, null, 1))
await browser.close()
console.log('video:', `${OUT}sempat-demo.webm`, 'durasi', ((Date.now() - T0) / 1000).toFixed(1), 'dtk', readdirSync(OUT))
