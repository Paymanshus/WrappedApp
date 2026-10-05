// Screenshots of the demo chat for assets/ (README images, store listings…). Demo data only.
//   npm run dev   (in another terminal)
//   node scripts/capture-assets.mjs [baseUrl]
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.argv[2] ?? 'http://localhost:5173'
const OUT = process.env.OUT ?? 'assets/screenshots'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
for (const [kind, ctx] of [
  ['phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }],
  ['desktop', { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 }],
]) {
  const page = await (await browser.newContext({ ...ctx, colorScheme: 'dark' })).newPage()
  const shot = async (name, settle = 1200) => { await page.waitForTimeout(settle); await page.screenshot({ path: `${OUT}/${kind}-${name}.png` }) }
  const phone = kind === 'phone'
  const tab = name => (phone ? page.getByRole('tab', { name }) : page.locator('header').getByRole('button', { name, exact: true }))

  await page.goto(BASE)
  await shot('empty', 600)
  await page.evaluate(async () => {
    const { importExport } = await import('/src/lib/importer.ts')
    const r = await importExport(new File([await (await fetch('/demo/demo-chat.txt')).blob()], 'WhatsApp Chat with Yash.txt'))
    const { setYou } = await import('/src/lib/people.ts')
    await setYou(r.chatId, 'Pinky')
  })
  if (phone) await shot('chats', 800)

  // story
  await page.getByRole('button', { name: 'Watch the Rewind' }).first().click()
  await page.locator('.fixed.inset-0.z-50').waitFor()
  // let each card's scene play out, then pause for a still frame
  const still = async name => { await page.waitForTimeout(3200); await page.keyboard.press('Space'); await shot(name, 400); await page.keyboard.press('Space') }
  await still('story-intro')
  for (const n of [2, 3]) { await page.keyboard.press('ArrowRight'); await still(`story-${n}`) }
  await page.keyboard.press('Escape')

  // dashboard, chat, find
  const row = page.getByText('Yash', { exact: true }).first()
  if (await row.isVisible()) await row.click()   // phones land on the chat after the story already
  await shot('dashboard', 1500)
  const hall = page.locator('section', { has: page.getByRole('heading', { name: 'Hall of Fame', exact: true }) })
  await hall.scrollIntoViewIfNeeded(); await shot('hall-of-fame', 900)
  const vocab = page.locator('section', { has: page.getByRole('heading', { name: 'How alike you sound' }) })
  await vocab.scrollIntoViewIfNeeded(); await shot('vocabulary', 1500)
  await tab('Chat').click(); await shot('chat', 1200)
  await tab('Find').click()
  await page.getByLabel('Search messages').fill('chai')
  await shot('find', 1200)
  await page.close()
}
await browser.close()
console.log(`saved to ${OUT}/`)
