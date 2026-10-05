// End-to-end screen check: drives the real app (dev server) through import → ring → story →
// share sheet → dashboard → reader → year filter → shared link, on phone Chromium, phone
// WebKit (Safari's engine) and desktop Chromium. Screenshots land in $OUT (default ./screens).
//   npm run dev  (in another terminal)
//   node scripts/e2e-screens.mjs [baseUrl]
import { chromium, webkit, devices } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.argv[2] ?? 'http://localhost:5173'
const OUT = process.env.OUT ?? 'screens'
mkdirSync(OUT, { recursive: true })

const runs = [
  { name: 'phone-chromium', browser: chromium, ctx: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } },
  { name: 'phone-webkit', browser: webkit, ctx: { ...devices['iPhone 14'] } },
  { name: 'desktop-chromium', browser: chromium, ctx: { viewport: { width: 1440, height: 900 } } },
]
const only = process.env.ONLY?.split(',')
const report = {}

for (const run of runs.filter(r => !only || only.includes(r.name))) {
  const browser = await run.browser.launch()
  const page = await (await browser.newContext({ ...run.ctx, colorScheme: 'dark' })).newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  const shot = async (n, settle = 1300) => { await page.waitForTimeout(settle); await page.screenshot({ path: `${OUT}/${run.name}-${n}.png` }) }
  const phone = run.ctx.isMobile

  await page.goto(BASE)
  // import: group zip (iOS format, media) + demo txt (Android format), through the real worker
  const imported = await page.evaluate(async () => {
    const { importExport } = await import('/src/lib/importer.ts')
    const get = async (u, n) => new File([await (await fetch(u)).blob()], n)
    const t0 = performance.now()
    const a = await importExport(await get('/fixtures/WhatsApp%20Chat%20-%20Weekend%20Squad.zip', 'WhatsApp Chat - Weekend Squad.zip'))
    const b = await importExport(await get('/demo/demo-chat.txt', 'WhatsApp Chat with Yash.txt'))
    return { group: a.messages, demo: b.messages, ms: Math.round(performance.now() - t0) }
  })
  await shot('01-chat-list', 600)

  // ring → story
  await page.getByRole('button', { name: 'Watch the Rewind' }).first().click()
  const story = page.locator('.fixed.inset-0.z-50')
  await story.waitFor()
  await page.keyboard.press('Space') // pause autoplay so screenshots are stable
  await shot('02-story-intro')
  for (let i = 0; i < 2; i++) await page.keyboard.press('ArrowRight')
  await shot('03-story-balance')
  const toId = async id => {
    for (let i = 0; i < 14; i++) {
      const kicker = await page.evaluate(() => [...document.querySelectorAll('.fixed.inset-0.z-50 .uppercase')].pop()?.textContent ?? '')
      if (kicker.toLowerCase().includes(id)) return
      await page.keyboard.press('ArrowRight')
      await page.waitForTimeout(80)
    }
  }
  await toId('personality'); await shot('04-story-archetype')
  await toId('awards'); await shot('05-story-awards')

  // share sheet (portaled above the story)
  await story.getByRole('button', { name: 'Share', exact: true }).click()
  await shot('06-share-sheet', 900)
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
  await story.getByRole('button', { name: 'Close story' }).click()

  // dashboard (story close → dashboard of the same chat)
  await shot('07-dashboard-top', 900)
  await page.evaluate(() => document.querySelector('main .overflow-y-auto')?.scrollBy(0, 900))
  await shot('08-dashboard-mid', 900)
  await page.getByRole('tab', { name: '2026' }).click()
  await page.evaluate(() => document.querySelector('main .overflow-y-auto')?.scrollTo(0, 0))
  await shot('09-dashboard-2026', 1200)

  // reader with OPFS media
  if (phone) await page.getByRole('tab', { name: 'Chat' }).click()
  else await page.getByRole('button', { name: 'Chat', exact: true }).click()
  await page.waitForTimeout(800)
  await page.waitForTimeout(1200)
  // the reader is virtualized: scroll up until media scrolls into view (or give up after ~40 screens)
  let media = 0
  for (let i = 0; i < 40 && !media; i++) {
    media = await page.evaluate(() => [...document.querySelectorAll('main img, main audio')].filter(e => e.getAttribute('src')?.startsWith('blob:')).length)
    if (!media) { await page.evaluate(() => document.querySelector('[data-virtuoso-scroller="true"]')?.scrollBy(0, -700)); await page.waitForTimeout(250) }
  }
  await page.waitForTimeout(600)
  await shot('10-reader')

  // back to list (phone) to see the subdued "seen" ring
  if (phone) { await page.getByRole('button', { name: 'Back to chats' }).click(); await shot('11-list-after', 600) }

  // shared link → receiver view
  const link = await page.evaluate(async () => {
    const { db } = await import('/src/lib/db.ts')
    const { buildStory } = await import('/src/lib/story/model.ts')
    const { storyLink } = await import('/src/lib/shareCard.ts')
    return storyLink(buildStory(await db.chats.get(2), await db.stats.get(2), {}))
  })
  await page.goto(link)
  await page.keyboard.press('Space')
  await shot('12-shared-link')

  const caps = await page.evaluate(() => ({
    opfsSync: 'createSyncAccessHandle' in (globalThis.FileSystemFileHandle?.prototype ?? {}),
    deflateRaw: (() => { try { new DecompressionStream('deflate-raw'); return true } catch { return false } })(),
    recorder: typeof MediaRecorder !== 'undefined' && ['video/mp4', 'video/webm'].filter(m => MediaRecorder.isTypeSupported(m)),
    canShareFiles: !!navigator.canShare,
  }))
  report[run.name] = { imported, mediaInReader: media, linkChars: link.length, caps, errors: errors.slice(0, 5) }
  await browser.close()
}
console.log(JSON.stringify(report, null, 2))
