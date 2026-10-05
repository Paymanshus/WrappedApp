// Dashboard insights + Dig deeper, end to end on the dev server:
//  • Hall of Fame / How alike you sound / Telepathy render from stats; "Open in chat" lands on the message
//  • Dig deeper does nothing until tapped; the tone check runs on-device and is saved
//  • an AI recap through Ollama (ASK_MODEL, default qwen3:4b; SKIP_AI=1 to skip)
//   node scripts/e2e-insights.mjs [baseUrl]
import { chromium, webkit } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.argv[2] ?? 'http://localhost:5173'
const OUT = process.env.OUT ?? 'screens'
const MODEL = process.env.ASK_MODEL ?? 'qwen3.5:9b'
mkdirSync(OUT, { recursive: true })
const runs = [
  { name: 'desktop-chromium', browser: chromium, ctx: { viewport: { width: 1440, height: 900 } }, ai: !process.env.SKIP_AI },
  { name: 'phone-webkit', browser: webkit, ctx: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } },
]
const only = process.env.ONLY?.split(',')
const ok = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`  ✓ ${m}`) }

for (const run of runs.filter(r => !only || only.includes(r.name))) {
  console.log(run.name)
  const browser = await run.browser.launch()
  const ctx = await browser.newContext({ ...run.ctx, colorScheme: 'dark' })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  const requests = []
  page.on('request', r => { if (!r.url().startsWith(BASE) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) requests.push(r.url()) })
  const shot = async (n, el) => { await page.waitForTimeout(500); await (el ?? page).screenshot({ path: `${OUT}/${run.name}-ins-${n}.png` }) }

  await page.goto(BASE)
  await page.evaluate(async () => {
    const { importExport } = await import('/src/lib/importer.ts')
    await importExport(new File([await (await fetch('/demo/demo-chat.txt')).blob()], 'WhatsApp Chat with Yash.txt'))
  })
  await page.getByText('Yash', { exact: true }).first().click()

  const hall = page.locator('section', { has: page.getByRole('heading', { name: 'Hall of Fame', exact: true }) })
  await hall.scrollIntoViewIfNeeded()
  ok(await hall.isVisible(), 'Hall of Fame renders')
  await shot('01-hall', hall)
  const vocab = page.locator('section', { has: page.getByRole('heading', { name: 'How alike you sound' }) })
  await vocab.scrollIntoViewIfNeeded()
  ok(await vocab.getByText(/\d+%/).first().isVisible(), 'vocabulary match renders')
  await shot('02-vocab', vocab)
  const tele = page.locator('section', { has: page.getByRole('heading', { name: 'Telepathy' }) })
  await tele.scrollIntoViewIfNeeded()
  ok(await tele.getByText('Telepathy score').isVisible(), 'telepathy renders')
  await shot('03-telepathy', tele)

  // Dig deeper: nothing ran by itself
  const dig = page.locator('section', { has: page.getByRole('heading', { name: 'Dig deeper' }) })
  await dig.scrollIntoViewIfNeeded()
  const before = await page.evaluate(async () => (await import('/src/lib/db.ts')).db.insights.count())
  ok(before === 0 && requests.length === 0, 'Dig deeper idle: no insights computed, no outside requests')
  await shot('04-dig-idle', dig)
  await dig.getByRole('button', { name: 'Check the tone' }).click()
  await dig.getByText('The tone of this chat').waitFor({ timeout: 60000 })
  ok(true, `tone check ran on-device: ${(await dig.locator('.font-display').first().textContent()).trim()}`)
  await shot('05-tone', dig)

  // open a Hall of Fame quote in the chat
  await hall.scrollIntoViewIfNeeded()
  await hall.getByRole('button', { name: 'Open in chat' }).first().click()
  await page.waitForTimeout(900)
  ok(await page.locator('.ring-wa-bright').count() === 1, 'Hall of Fame → Open in chat lands on the message')

  if (run.ai) {
    await page.evaluate(m => localStorage.setItem('wrappedapp-ask', JSON.stringify({ answer: { provider: 'ollama', model: m }, reader: null, baseUrls: {}, remember: true })), MODEL)
    await page.reload()
    await page.getByText('Yash', { exact: true }).first().click()
    const card = page.locator('div.flex.flex-col.rounded-xl', { hasText: 'How it all started' })
    await card.scrollIntoViewIfNeeded()
    ok(await card.getByText(/stays on this device/).isVisible(), 'recap card says it stays on this device (Ollama)')
    await card.getByRole('button', { name: 'Explore' }).click()
    await card.getByRole('button', { name: 'Redo' }).waitFor({ timeout: 300000 })
    const text = (await card.locator('.whitespace-pre-wrap').textContent()).trim()
    ok(text.length > 40, `AI recap written with ${MODEL} (${text.length} chars)`)
    await shot('06-recap', card)
  }
  ok(!errors.length, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`)
  await browser.close()
}
