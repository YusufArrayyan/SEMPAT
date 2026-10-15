// Uji asap ujung ke ujung dengan Edge headless (playwright-core).
// Jalankan: node e2e/smoke.mjs  (API di :8000 dan Vite di :5173 harus hidup)
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const BASE = process.env.SEMPAT_URL ?? 'http://localhost:5173'
const OUT = fileURLToPath(new URL('./shots/', import.meta.url))
mkdirSync(OUT, { recursive: true })
const only = process.argv[2]

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'id-ID', timezoneId: 'Asia/Jakarta' })
const page = await ctx.newPage()
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))
const shot = (name) => page.screenshot({ path: `${OUT}${name}.png` })
const step = (s) => console.log('•', s)

step('masuk')
await page.goto(`${BASE}/masuk`)
await shot('01-masuk')
await page.getByLabel('Surel').fill('admin@sempat.local')
await page.getByLabel('Kata sandi').fill('sempat-admin-2026')
await page.getByRole('button', { name: 'Masuk' }).click()
await page.waitForURL(`${BASE}/`)
await page.getByRole('heading', { name: 'Dasbor' }).waitFor()
await shot('02-dasbor')

step('editor skenario + jalankan')
await page.goto(`${BASE}/skenario`)
await page.getByRole('link', { name: /Esai 2026/ }).first().click()
await page.getByRole('button', { name: /Jalankan skenario dasar/ }).waitFor()
await page.waitForTimeout(1500)
await page.getByRole('button', { name: /Jalankan skenario dasar/ }).click()
await page.getByText('Perhitungan selesai.').waitFor({ timeout: 60000 })
await page.waitForTimeout(1500)
await shot('03-editor-selesai')

step('hasil + klik sel')
await page.getByRole('button', { name: 'Lihat hasil' }).click()
await page.waitForURL(/\/hasil\//)
await page.getByText('indeks kecukupan kota').waitFor()
await page.waitForTimeout(2500)
await shot('04-hasil')
// klik sel: cari piksel berwarna kelas di kanvas peta
const canvas = page.locator('.workspace-map canvas')
const box = await canvas.boundingBox()
const hit = await page.evaluate(() => {
  const c = document.querySelector('.workspace-map canvas')
  const gl = c.getContext('webgl2') || c.getContext('webgl')
  return { w: c.width, h: c.height, has: !!gl }
})
let clicked = false
for (let fy = 0.3; fy < 0.8 && !clicked; fy += 0.05) {
  for (let fx = 0.15; fx < 0.6 && !clicked; fx += 0.03) {
    await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy)
    await page.waitForTimeout(150)
    if (await page.getByText(/^Sel #\d+/).count()) clicked = true
  }
}
console.log('  kanvas', hit, 'sel diklik:', clicked)
await page.waitForTimeout(1200)
await shot('05-hasil-sel')
await page.getByRole('tab', { name: /Prioritas/ }).click()
await page.waitForTimeout(400)
await shot('06-prioritas')
await page.getByRole('tab', { name: 'Beban TES' }).click()
await shot('07-beban')

step('data')
await page.goto(`${BASE}/data`)
await page.getByRole('link', { name: /Data contoh/ }).first().click()
await page.getByText('Laporan validasi').waitFor()
await page.waitForTimeout(2500)
await shot('08-dataset')
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
await page.waitForTimeout(300)
await shot('09-validasi')

step('metodologi')
await page.goto(`${BASE}/metodologi`)
await page.waitForTimeout(800)
await shot('10-metodologi')

step('admin')
await page.goto(`${BASE}/admin`)
await page.getByRole('tab', { name: 'Log audit' }).click()
await page.waitForTimeout(800)
await shot('11-audit')

if (!only) {
  step('intervensi: TES hipotetis + uji')
  await page.goto(`${BASE}/skenario`)
  await page.getByRole('link', { name: /Esai 2026/ }).first().click()
  await page.getByRole('button', { name: 'Taruh TES hipotetis' }).waitFor()
  await page.waitForTimeout(2000)
  await page.getByRole('button', { name: 'Taruh TES hipotetis' }).click()
  const mb = await page.locator('.workspace-map canvas').boundingBox()
  await page.mouse.click(mb.x + mb.width * 0.32, mb.y + mb.height * 0.62)
  await page.getByRole('button', { name: 'Tambahkan TES' }).click()
  await page.waitForTimeout(800)
  await page.getByRole('button', { name: /Uji \d+ intervensi/ }).click()
  await page.getByText('Perhitungan selesai.').waitFor({ timeout: 60000 })
  await page.getByRole('button', { name: 'Lihat selisih' }).click()
  await page.waitForURL(/bandingkan/)
  await page.getByText('Selisih IK kota').waitFor()
  await page.waitForTimeout(2500)
  await shot('12-bandingkan')

  step('laporan + tautan publik')
  await page.goto(`${BASE}/skenario`)
  await page.getByRole('link', { name: /Esai 2026/ }).first().click()
  await page.getByRole('link', { name: /Buka hasil/ }).click()
  await page.getByRole('tab', { name: 'Laporan' }).click()
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Unduh Laporan PDF' }).click()])
  await dl.saveAs(`${OUT}laporan.pdf`)
  const pubBtn = page.getByRole('button', { name: 'Buat tautan publik' })
  if (await pubBtn.count()) await pubBtn.click()
  const url = await page.getByLabel('Alamat tautan publik').inputValue()
  await shot('13-laporan')
  const pub = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, locale: 'id-ID' })
  const pp = await pub.newPage()
  pp.on('pageerror', (e) => errors.push('publik: ' + e))
  await pp.goto(url)
  await pp.getByText('indeks kecukupan kota').waitFor()
  await pp.waitForTimeout(2500)
  await pp.screenshot({ path: `${OUT}14-publik-seluler.png`, fullPage: true })
  await pub.close()
}

console.log('galat konsol:', errors.length ? errors : 'tidak ada')
await browser.close()
