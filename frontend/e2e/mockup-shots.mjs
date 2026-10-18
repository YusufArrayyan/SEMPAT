// Tangkapan layar ponsel asli untuk mockup esai. Jalankan: node e2e/mockup-shots.mjs
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const BASE = process.env.SEMPAT_URL ?? 'http://localhost:5173'
const OUT = fileURLToPath(new URL('../../docs/mockup/screens/', import.meta.url))
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'id-ID', timezoneId: 'Asia/Jakarta' })
const page = await ctx.newPage()
const shot = (n) => page.screenshot({ path: `${OUT}${n}.png` })

// 1. Masuk
await page.goto(`${BASE}/masuk`)
await page.waitForTimeout(800)
await shot('1-masuk')

await page.getByLabel('Surel').fill('analis@sempat.local')
await page.getByLabel('Kata sandi').fill('sempat-analis-2026')
await page.getByRole('button', { name: 'Masuk' }).click()
await page.waitForURL(`${BASE}/`)

// Hasil dasar terbaru skenario Esai 2026 (jalankan bila belum ada)
const scen = await page.evaluate(async () => (await (await fetch('/api/scenarios')).json()).items)
const esai = scen.find((s) => s.name.startsWith('Esai'))
let run = await page.evaluate(async (id) => (await fetch(`/api/scenarios/${id}/runs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"kind":"tunggal"}' })).json(), esai.id)
for (let i = 0; i < 30; i++) {
  const st = await page.evaluate(async (id) => (await (await fetch(`/api/runs/${id}`)).json()).status, run.id)
  if (st === 'selesai') break
  await page.waitForTimeout(500)
}

// 2. Peta hasil
await page.goto(`${BASE}/hasil/${run.id}`)
await page.getByText('indeks kecukupan kota').waitFor()
await page.waitForTimeout(2500)
await shot('2-peta-hasil')

// 3. Rincian sel: pilih sel Terlambat dengan defisit kecil (rute sedang) lewat URL
const cells = await page.evaluate(async (id) => (await (await fetch(`/api/runs/${id}/cells`)).json()).features, run.id)
const pick = cells
  .filter((f) => f.properties.kelas === 'terlambat' && f.properties.sisa_menit > -3 && f.properties.jarak_m > 900)
  .sort((a, b) => b.properties.penduduk - a.properties.penduduk)[0]
await page.goto(`${BASE}/hasil/${run.id}?sel=${pick.id}`)
await page.locator('#cell-title').waitFor()
const hit = true
await page.waitForTimeout(2500)
await shot('3a-rute')
await page.evaluate(() => {
  const el = document.querySelector('#cell-title')
  window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 150)
})
await page.waitForTimeout(500)
await shot('3-rincian-sel')

// 4. Prioritas
await page.goto(`${BASE}/hasil/${run.id}?tab=prioritas`)
await page.getByText('indeks kecukupan kota').waitFor()
await page.waitForTimeout(1500)
await page.getByRole('tab', { name: /Prioritas/ }).scrollIntoViewIfNeeded()
await page.evaluate(() => window.scrollBy(0, -120))
const first = page.locator('details summary', { hasText: 'Syarat yang terpenuhi' }).first()
await first.click()
await page.waitForTimeout(500)
await shot('4-prioritas')

// 5. Ringkasan IK per kecamatan
await page.goto(`${BASE}/hasil/${run.id}?tab=wilayah`)
await page.getByText('indeks kecukupan kota').waitFor()
await page.waitForTimeout(1500)
await page.locator('.display').first().scrollIntoViewIfNeeded()
await page.evaluate(() => window.scrollBy(0, -24))
await page.waitForTimeout(400)
await shot('5-ringkasan')

// 6. Tampilan publik (warga / relawan)
let share = await page.evaluate(async (id) => (await (await fetch(`/api/runs/${id}`)).json()).share_token, run.id)
if (!share) share = await page.evaluate(async (id) => (await (await fetch(`/api/runs/${id}/share`, { method: 'POST' })).json()).token, run.id)
const pub = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'id-ID' })
const pp = await pub.newPage()
await pp.goto(`${BASE}/publik/${share}`)
await pp.getByText('indeks kecukupan kota').waitFor()
await pp.waitForTimeout(2500)
await pp.screenshot({ path: `${OUT}6-publik.png` })

console.log('selesai:', OUT, 'sel kena:', hit)
await browser.close()
