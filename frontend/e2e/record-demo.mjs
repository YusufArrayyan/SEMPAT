// Rekam video demo Sempat dengan teks keterangan. Jalankan: node e2e/record-demo.mjs
// Hasil WebM diubah ke MP4 oleh skrip Python sesudahnya (lihat README docs/demo).
import { chromium } from 'playwright-core'
import { mkdirSync, renameSync, readdirSync, rmSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const BASE = process.env.SEMPAT_URL ?? 'http://localhost:5173'
const OUT = fileURLToPath(new URL('../../docs/demo/', import.meta.url))
const RAW = `${OUT}_raw/`
mkdirSync(RAW, { recursive: true })
const LOGO = pathToFileURL(fileURLToPath(new URL('../public/brand/sempat-logo.png', import.meta.url))).href
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
  const boot = () => {
    if (document.getElementById('__cur')) return
    const st = document.createElement('style')
    st.textContent = css
    document.head.appendChild(st)
    const c = document.createElement('div')
    c.id = '__cur'
    const p = JSON.parse(sessionStorage.getItem('__curpos') || '[720,400]')
    c.style.left = p[0] + 'px'
    c.style.top = p[1] + 'px'
    document.body.appendChild(c)
    const cap = document.createElement('div')
    cap.id = '__cap'
    cap.textContent = sessionStorage.getItem('__cap') || ''
    document.body.appendChild(cap)
    addEventListener('mousemove', (e) => {
      c.style.left = e.clientX + 'px'
      c.style.top = e.clientY + 'px'
      sessionStorage.setItem('__curpos', JSON.stringify([e.clientX, e.clientY]))
    }, true)
    addEventListener('mousedown', () => c.classList.add('down'), true)
    addEventListener('mouseup', () => c.classList.remove('down'), true)
  }
  window.__setCap = (t) => {
    sessionStorage.setItem('__cap', t)
    const el = document.getElementById('__cap')
    if (el) el.textContent = t
  }
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', boot)
  else boot()
})

const page = await ctx.newPage()
const wait = (ms) => page.waitForTimeout(ms)
const cap = async (t, ms = 0) => {
  await page.evaluate((x) => window.__setCap?.(x), t)
  if (ms) await wait(ms)
}
// Gerak mouse halus ke elemen lalu klik
const glide = async (x, y) => page.mouse.move(x, y, { steps: 22 })
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
  await page.mouse.down()
  await wait(90)
  await page.mouse.up()
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

// --- 0. Kartu judul ---------------------------------------------------------------------------
await page.setContent(`
  <body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#161616;font-family:'IBM Plex Sans',Arial,sans-serif;color:#fff">
    <div style="display:flex;align-items:center;gap:36px;max-width:1100px">
      <img src="${LOGO}" style="width:170px;height:170px">
      <div>
        <div style="font-size:64px;font-weight:600;letter-spacing:-1px">Sempat</div>
        <div style="font-size:28px;font-weight:300;color:#e0e0e0;margin-top:6px">Uji kecukupan tempat evakuasi sementara tsunami · Kota Bengkulu</div>
        <div style="font-size:18px;color:#a8a8a8;margin-top:22px">Demo aplikasi web · data contoh sintetis</div>
      </div>
    </div>
  </body>`)
await wait(4200)

// --- 1. Masuk ---------------------------------------------------------------------------------
await page.goto(`${BASE}/masuk`)
await cap('Masuk dengan akun demo berperan Analis.', 900)
await typeIn(page.getByLabel('Surel'), 'demo.analis@sempat.demo')
await typeIn(page.getByLabel('Kata sandi'), 'DemoAnalis2026')
await clickOn(page.getByRole('button', { name: 'Masuk' }))
await page.getByRole('heading', { name: 'Dasbor' }).waitFor()
await cap('Dasbor: dataset terbit, hasil terakhir, peringatan kualitas data, dan panduan alur pertama.', 3800)

// --- 2. Data -----------------------------------------------------------------------------------
await clickOn(page.getByRole('navigation', { name: 'Navigasi utama' }).getByRole('link', { name: 'Data' }))
await page.getByRole('link', { name: /Data contoh/ }).first().waitFor()
await clickOn(page.getByRole('link', { name: /Data contoh/ }).first())
await page.getByText('Laporan validasi').waitFor()
await cap('Data TES, jalan, wilayah, penduduk, dan zona genangan diimpor lalu divalidasi otomatis.', 3000)
await page.mouse.wheel(0, 900)
await wait(600)
await page.getByRole('heading', { name: 'Laporan validasi' }).scrollIntoViewIfNeeded()
await page.mouse.wheel(0, -60)
await cap('Laporan validasi menolak TES yang salah koordinat dan memberi tanda pada data yang belum lengkap.', 4200)

// --- 3. Buat skenario --------------------------------------------------------------------------
await clickOn(page.getByRole('navigation', { name: 'Navigasi utama' }).getByRole('link', { name: 'Skenario' }))
await cap('Skenario menyimpan parameter rumus sisa waktu: jeda respons, waktu tiba gelombang, dan moda.', 2200)
await clickOn(page.getByRole('button', { name: /Buat skenario/ }).first())
await page.getByLabel('Nama skenario (opsional)').waitFor()
await wait(700)
await typeIn(page.getByLabel('Nama skenario (opsional)'), 'Demo esai — jalan kaki, jeda 10 menit')
await clickOn(page.getByRole('button', { name: 'Buat dan buka editor' }))
await page.getByRole('button', { name: /Jalankan skenario dasar/ }).waitFor()
await wait(1500)

await cap('Ubah jeda respons menjadi 10 menit: warga baru mulai bergerak 10 menit setelah gempa.', 800)
const delay = page.getByLabel('Jeda respons τ')
await clickOn(delay)
await page.keyboard.press('Control+A')
await page.keyboard.type('10', { delay: 120 })
await wait(1500)
await cap('Jalankan perhitungan: jarak terpendek lewat jalan dari setiap sel 100 m ke TES terdekat.', 900)
await clickOn(page.getByRole('button', { name: /Jalankan skenario dasar/ }))
await page.getByText('Perhitungan selesai.').waitFor({ timeout: 60000 })
await wait(2200)
await cap('Hasil langsung tampil di peta: hijau Cukup, kuning Rawan, ungu bertitik Terlambat.', 3500)

// --- 4. Hasil + rute ---------------------------------------------------------------------------
await clickOn(page.getByRole('button', { name: 'Lihat hasil' }))
await page.waitForURL(/\/hasil\//)
await page.getByText('indeks kecukupan kota').waitFor()
await wait(1800)
await cap('Indeks kecukupan kota: porsi penduduk di zona genangan yang sempat mencapai TES.', 3800)
const runId = page.url().split('/hasil/')[1].split('?')[0]
const cells = (await api(`/runs/${runId}/cells`)).features
const pick = cells
  .filter((f) => f.properties.kelas === 'terlambat' && f.properties.jarak_m > 900 && f.properties.jarak_m < 1700)
  .sort((a, b) => b.properties.penduduk - a.properties.penduduk)[0]
const ring = pick.geometry.coordinates[0]
const clon = (ring[0][0] + ring[2][0]) / 2
const clat = (ring[0][1] + ring[2][1]) / 2
await page.evaluate(([lo, la]) => window.__sempatMap.easeTo({ center: [lo, la], zoom: 13.4, duration: 1600 }), [clon, clat])
await cap('Klik satu sel Terlambat untuk melihat rutenya.', 2000)
const [px, py] = await mapPoint(clon, clat)
await glide(px, py)
await wait(400)
await page.mouse.down()
await wait(90)
await page.mouse.up()
await page.locator('#cell-title').waitFor()
await wait(1400)
await cap('Rute biru = jalur terpendek ke TES. Rincian: m = Tₐ − (τ + t); sisa waktu negatif berarti tidak sempat.', 5200)

await page.locator('.workspace-panel').evaluate((el) => {
  const t = el.querySelector('[role="tablist"]')
  el.scrollTo({ top: t.offsetTop - 20, behavior: 'smooth' })
})
await wait(900)
await clickOn(page.getByRole('tab', { name: /Prioritas/ }))
await wait(700)
await clickOn(page.locator('details summary', { hasText: 'Syarat yang terpenuhi' }).first())
await cap('Daftar prioritas: kelurahan dengan penduduk Terlambat terbanyak, lengkap dengan rekomendasi dan alasannya.', 5200)
await clickOn(page.getByRole('tab', { name: 'Beban TES' }))
await cap('Beban TES: penduduk yang menuju tiap TES dibanding kapasitasnya; beban di atas 1 ditandai merah.', 4200)

// --- 5. Uji intervensi -------------------------------------------------------------------------
await clickOn(page.getByRole('link', { name: /Demo esai/ }).first())
await page.getByRole('button', { name: 'Taruh TES hipotetis' }).waitFor()
await wait(1800)
await cap('Uji intervensi sebelum dibiayai: tambahkan satu TES hipotetis di kawasan yang paling terlambat.', 1500)
await clickOn(page.getByRole('button', { name: 'Taruh TES hipotetis' }))
await wait(600)
await page.evaluate(([lo, la]) => window.__sempatMap.easeTo({ center: [lo, la], zoom: 12.6, duration: 1200 }), [clon, clat])
await wait(1500)
const [tx, ty] = await mapPoint(clon, clat)
await glide(tx, ty)
await wait(400)
await page.mouse.down()
await wait(90)
await page.mouse.up()
await page.getByLabel('Kapasitas (jiwa)').waitFor()
await typeIn(page.getByLabel('Kapasitas (jiwa)'), '3000')
await clickOn(page.getByRole('button', { name: 'Tambahkan TES' }))
await wait(900)
await cap('Tambahkan juga percepatan respons 3 menit, misalnya lewat sirene dan latihan rutin.', 1200)
await clickOn(page.getByRole('button', { name: 'Tambah', exact: true }))
await wait(1400)
await cap('Jalankan uji intervensi: sistem menghitung ulang dan membandingkannya dengan skenario dasar.', 900)
await clickOn(page.getByRole('button', { name: /Uji \d+ intervensi/ }))
await page.getByText('Perhitungan selesai.').waitFor({ timeout: 60000 })
await wait(1200)
await clickOn(page.getByRole('button', { name: 'Lihat selisih' }))
await page.waitForURL(/bandingkan/)
await page.getByText('Selisih IK kota').waitFor()
await wait(1500)
await cap('Dua peta berdampingan: kiri skenario dasar, kanan dengan intervensi.', 3500)
await page.getByText('Selisih IK kota').scrollIntoViewIfNeeded()
await page.mouse.wheel(0, 120)
await cap('Hasilnya terukur: kenaikan IK dan jumlah penduduk yang berpindah dari Terlambat ke Sempat.', 5200)

// --- 6. Laporan --------------------------------------------------------------------------------
const b = new URL(page.url()).searchParams.get('b')
await page.goto(`${BASE}/hasil/${b}?tab=laporan`)
await page.getByText('indeks kecukupan kota').waitFor()
await page.locator('.workspace-panel').evaluate((el) => {
  const t = el.querySelector('[role="tablist"]')
  el.scrollTop = t.offsetTop - 20
})
await wait(800)
await cap('Ekspor laporan PDF, CSV, dan GeoJSON; setiap angka terikat pada versi data dan parameter.', 4500)
await cap('Tautan publik baca-saja dapat dibagikan kepada relawan dan warga tanpa akun.', 3500)

// --- 7. Penutup --------------------------------------------------------------------------------
await cap('', 0)
await page.setContent(`
  <body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#161616;font-family:'IBM Plex Sans',Arial,sans-serif;color:#fff">
    <div style="text-align:center;max-width:1000px">
      <img src="${LOGO}" style="width:120px;height:120px">
      <div style="font-size:40px;font-weight:300;margin-top:24px">Dari setiap sel permukiman, apakah warga sempat?</div>
      <div style="font-size:20px;color:#c6c6c6;margin-top:18px">Hasil adalah uji kecukupan pada skenario terpilih, bukan prediksi tsunami.</div>
      <div style="font-size:18px;color:#f5a51b;margin-top:30px">sempat.onrender.com</div>
    </div>
  </body>`)
await wait(4500)

const video = page.video()
await ctx.close()
const src = await video.path()
renameSync(src, `${OUT}sempat-demo.webm`)
rmSync(RAW, { recursive: true, force: true })
await browser.close()
console.log('video:', `${OUT}sempat-demo.webm`, readdirSync(OUT))
