// Production-build check: CSP holds (no violations), the import worker runs under it,
// media renders from local storage, PNG export downloads, and the app reloads OFFLINE
// from the service worker with all data intact.
//   npm run build && npm run preview   (in another terminal)
//   node scripts/e2e-prod.mjs [baseUrl]
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.argv[2] ?? 'http://localhost:4173'
const OUT = process.env.OUT ?? 'screens'
const ZIP = 'fixtures/WhatsApp Chat - Weekend Squad.zip'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, acceptDownloads: true })
await ctx.addInitScript(() => {
  window.__csp = []
  document.addEventListener('securitypolicyviolation', e => window.__csp.push(`${e.violatedDirective} ← ${e.blockedURI}`))
})
const page = await ctx.newPage()
const errors = []
page.on('pageerror', e => errors.push(String(e)))
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })

await page.goto(BASE)
const cspMeta = await page.getAttribute('meta[http-equiv="Content-Security-Policy"]', 'content')

// real user path: the Import button's file input
await page.locator('input[type=file]').setInputFiles(ZIP)
await page.getByText('New Rewind').waitFor({ timeout: 30_000 })

await page.getByText('Weekend Squad').first().click()
await page.getByRole('tab', { name: 'Chat' }).click()
await page.waitForTimeout(1500)
const media = await page.evaluate(() => [...document.querySelectorAll('main img')].filter(e => e.getAttribute('src')?.startsWith('blob:') && e.naturalWidth > 0).length)

// PNG export through the share hub (posters)
await page.getByRole('button', { name: 'Play the Rewind' }).click()
const story = page.locator('.fixed.inset-0.z-50')
await story.getByRole('button', { name: 'Share', exact: true }).click()
const dl = page.waitForEvent('download', { timeout: 15_000 })
await page.getByRole('button', { name: /this one/ }).click()
const download = await dl
const png = { name: download.suggestedFilename(), bytes: (await download.createReadStream().then(s => new Promise(r => { let n = 0; s.on('data', c => (n += c.length)); s.on('end', () => r(n)) }))) }

// video through the real button, under the production CSP (lazy Mediabunny chunk + WebCodecs)
const v0 = Date.now()
await page.getByRole('button', { name: 'Make video' }).click()
await page.getByRole('dialog').getByRole('button', { name: /^(Share|Save)$/ }).waitFor({ timeout: 120_000 })
const video = { seconds: Math.round((Date.now() - v0) / 100) / 10 }
await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
await story.getByRole('button', { name: 'Close story' }).click()

// offline: SW must have precached the app; IndexedDB/OPFS hold the data
const swReady = await page.evaluate(async () => !!(await Promise.race([navigator.serviceWorker.ready, new Promise(r => setTimeout(() => r(null), 8000))])))
await page.waitForTimeout(500)
await ctx.setOffline(true)
await page.goto(BASE)
try {
  await page.getByText('Weekend Squad').first().waitFor({ timeout: 10_000 })
} catch (e) {
  await page.screenshot({ path: `${OUT}/prod-offline-fail.png` })
  console.log('OFFLINE FAIL', { url: page.url(), body: (await page.locator('body').innerText()).slice(0, 300), errors })
  throw e
}
await page.screenshot({ path: `${OUT}/prod-offline-list.png` })
await page.getByRole('button', { name: /Rewind$/ }).first().click()
await page.keyboard.press('Space')
await page.waitForTimeout(1300)
await page.screenshot({ path: `${OUT}/prod-offline-story.png` })
const offlineStory = await story.innerText().catch(() => '')

console.log(JSON.stringify({
  cspMeta: !!cspMeta,
  cspViolations: await page.evaluate(() => window.__csp),
  media,
  png,
  video,
  swReady,
  offline: { listLoaded: true, storyText: offlineStory.slice(0, 60).replace(/\n/g, ' | ') },
  errors: errors.slice(0, 5),
}, null, 2))
await browser.close()
