// Render docs/mockup/mockup.html menjadi PNG untuk esai. Jalankan: node e2e/render-mockup.mjs
import { chromium } from 'playwright-core'
import { fileURLToPath, pathToFileURL } from 'node:url'

const DIR = fileURLToPath(new URL('../../docs/mockup/', import.meta.url))
const url = pathToFileURL(`${DIR}mockup.html`).href
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1800, height: 1200 }, deviceScaleFactor: 2 })

await page.goto(url)
await page.evaluate(() => document.fonts.ready)
await page.locator('#sheet').screenshot({ path: `${DIR}sempat-mockup-seluler.png` })

for (const id of ['masuk', 'peta', 'rute', 'prioritas', 'publik']) {
  await page.goto(`${url}?satu=${id}`)
  await page.evaluate(() => document.fonts.ready)
  await page.locator(`figure[data-id="${id}"] .phone`).screenshot({ path: `${DIR}ponsel-${id}.png`, omitBackground: true })
}
console.log('selesai:', DIR)
await browser.close()
