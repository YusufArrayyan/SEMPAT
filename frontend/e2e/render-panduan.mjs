// Render docs/panduan/panduan.html menjadi PDF. Jalankan: node e2e/render-panduan.mjs [URL]
import { chromium } from 'playwright-core'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const DIR = fileURLToPath(new URL('../../docs/panduan/', import.meta.url))
const URL_APP = process.argv[2] ?? 'https://sempat.onrender.com'
const tanggal = new Intl.DateTimeFormat('id-ID', { dateStyle: 'long', timeZone: 'Asia/Jakarta' }).format(new Date())
const html = readFileSync(`${DIR}panduan.html`, 'utf8')
  .replaceAll('{{URL}}', URL_APP)
  .replaceAll('{{TANGGAL}}', tanggal)
  .replaceAll('{{IK_A}}', process.env.IK_A ?? '39,9%')
  .replaceAll('{{IK_B}}', process.env.IK_B ?? '58,6%')
const tmp = `${DIR}_render.html`
writeFileSync(tmp, html)

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage()
await page.goto(pathToFileURL(tmp).href)
await page.evaluate(() => document.fonts.ready)
// Peringatan bila isi halaman meluap
const over = await page.evaluate(() =>
  [...document.querySelectorAll('.page')].map((p, i) => ({ i: i + 1, over: p.scrollHeight - p.clientHeight })).filter((x) => x.over > 2),
)
if (over.length) console.log('halaman meluap:', over)
await page.pdf({ path: `${DIR}Panduan-Akun-Demo-Sempat.pdf`, format: 'A4', printBackground: true, preferCSSPageSize: true })
unlinkSync(tmp)
console.log('PDF:', `${DIR}Panduan-Akun-Demo-Sempat.pdf`)
await browser.close()
