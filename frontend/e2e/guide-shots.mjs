// Tangkapan layar desktop untuk PDF panduan. Jalankan: node e2e/guide-shots.mjs
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const BASE = process.env.SEMPAT_URL ?? 'http://localhost:5173'
const OUT = fileURLToPath(new URL('../../docs/panduan/img/', import.meta.url))
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 }, deviceScaleFactor: 2, locale: 'id-ID', timezoneId: 'Asia/Jakarta' })
const page = await ctx.newPage()
const shot = (n) => page.screenshot({ path: `${OUT}${n}.png` })
const api = (path, method = 'GET', body) =>
  page.evaluate(
    async ([p, m, b]) => {
      const r = await fetch(`/api${p}`, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined })
      return r.json()
    },
    [path, method, body],
  )
const waitRun = async (id) => {
  for (let i = 0; i < 60; i++) {
    const r = await api(`/runs/${id}`)
    if (['selesai', 'gagal', 'dibatalkan'].includes(r.status)) return r
    await page.waitForTimeout(500)
  }
}

await page.goto(`${BASE}/masuk`)
await page.waitForTimeout(600)
await shot('01-masuk')
await page.getByLabel('Surel').fill('demo.analis@sempat.demo')
await page.getByLabel('Kata sandi').fill('DemoAnalis2026')
await page.getByRole('button', { name: 'Masuk' }).click()
await page.waitForURL(`${BASE}/`)
await page.getByRole('heading', { name: 'Dasbor' }).waitFor()

// Siapkan hasil: dasar + intervensi pada skenario Esai 2026
const esai = (await api('/scenarios')).items.find((s) => s.name.startsWith('Esai'))
const base = await waitRun((await api(`/scenarios/${esai.id}/runs`, 'POST', { kind: 'tunggal' })).id)
const full = await api(`/scenarios/${esai.id}`)
if (!full.interventions.some((i) => i.type === 'kurangi_jeda' && i.enabled)) {
  await api(`/scenarios/${esai.id}/interventions`, 'POST', { type: 'kurangi_jeda', label: 'Sirene dan latihan: jeda turun 3 menit', payload: { minus_min: 3 } })
}
const iv = await waitRun((await api(`/scenarios/${esai.id}/runs`, 'POST', { kind: 'tunggal', with_interventions: true })).id)

await page.goto(`${BASE}/`)
await page.waitForTimeout(1200)
await shot('02-dasbor')

await page.goto(`${BASE}/data`)
await page.getByRole('link', { name: /Data contoh/ }).first().click()
await page.getByText('Laporan validasi').waitFor()
await page.waitForTimeout(2500)
await shot('03-data')
await page.getByRole('heading', { name: 'Laporan validasi' }).scrollIntoViewIfNeeded()
await page.evaluate(() => window.scrollBy(0, -80))
await page.waitForTimeout(400)
await shot('04-validasi')

await page.goto(`${BASE}/skenario`)
await page.waitForTimeout(1000)
await shot('05-skenario')

await page.goto(`${BASE}/skenario/${esai.id}`)
await page.getByRole('button', { name: /Jalankan skenario dasar/ }).waitFor()
await page.waitForTimeout(2500)
await shot('06-editor')
await page.locator('.workspace-panel').evaluate((el) => (el.scrollTop = el.scrollHeight * 0.42))
await page.waitForTimeout(400)
await shot('07-editor-intervensi')

const cells = (await api(`/runs/${base.id}/cells`)).features
const pick = cells.filter((f) => f.properties.kelas === 'terlambat' && f.properties.sisa_menit > -3 && f.properties.jarak_m > 900).sort((a, b) => b.properties.penduduk - a.properties.penduduk)[0]
await page.goto(`${BASE}/hasil/${base.id}`)
await page.getByText('indeks kecukupan kota').waitFor()
await page.waitForTimeout(2500)
await shot('08-hasil')
await page.goto(`${BASE}/hasil/${base.id}?sel=${pick.id}`)
await page.locator('#cell-title').waitFor()
await page.waitForTimeout(2500)
await shot('09-rincian-sel')

await page.goto(`${BASE}/hasil/${base.id}?tab=prioritas`)
await page.getByText('indeks kecukupan kota').waitFor()
await page.waitForTimeout(1000)
await page.locator('details summary', { hasText: 'Syarat yang terpenuhi' }).first().click()
await page.locator('.workspace-panel').evaluate((el) => {
  const t = el.querySelector('[role="tablist"]')
  el.scrollTop = t.offsetTop - 20
})
await page.waitForTimeout(500)
await shot('10-prioritas')

await page.goto(`${BASE}/hasil/${base.id}?tab=tes`)
await page.getByText('indeks kecukupan kota').waitFor()
await page.waitForTimeout(800)
await page.locator('.workspace-panel').evaluate((el) => {
  const t = el.querySelector('[role="tablist"]')
  el.scrollTop = t.offsetTop - 20
})
await page.waitForTimeout(400)
await shot('11-beban-tes')

await api(`/runs/${base.id}/share`, 'POST')
await page.goto(`${BASE}/hasil/${base.id}?tab=laporan`)
await page.getByText('indeks kecukupan kota').waitFor()
await page.waitForTimeout(800)
await page.locator('.workspace-panel').evaluate((el) => {
  const t = el.querySelector('[role="tablist"]')
  el.scrollTop = t.offsetTop - 20
})
await page.waitForTimeout(400)
await shot('12-laporan')

await page.goto(`${BASE}/bandingkan?a=${base.id}&b=${iv.id}`)
await page.getByText('Selisih IK kota').waitFor()
await page.waitForTimeout(2500)
await shot('13-bandingkan')
await page.getByRole('heading', { name: 'Selisih IK per wilayah' }).scrollIntoViewIfNeeded()
await page.evaluate(() => window.scrollBy(0, -260))
await page.waitForTimeout(400)
await shot('14-bandingkan-tabel')

await page.goto(`${BASE}/metodologi`)
await page.waitForTimeout(800)
await shot('15-metodologi')

console.log(JSON.stringify({ base: base.id, iv: iv.id, ikBase: base.summary.ik, ikIv: iv.summary.ik }))
await browser.close()
