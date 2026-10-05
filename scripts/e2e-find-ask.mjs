// Find + Ask + fixes, end to end on the dev server:
//  • Find: search, filters, timeline, context, open-in-chat (reader lands on the message)
//  • Ask: settings → Ollama → a real question answered with citations (needs `ollama serve` + a
//    tool-capable model; set ASK_MODEL, default qwen3:4b; SKIP_ASK=1 to skip)
//  • Story soundtrack starts with the story and re-seeks on every card change
//  • Repeated export blocks are repaired in already-imported chats
//  • "Which one is you?" finds people beyond the top senders
//   node scripts/e2e-find-ask.mjs [baseUrl]
import { chromium, webkit } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.argv[2] ?? 'http://localhost:5173'
const OUT = process.env.OUT ?? 'screens'
const MODEL = process.env.ASK_MODEL ?? 'qwen3.5:9b'
mkdirSync(OUT, { recursive: true })

const runs = [
  { name: 'desktop-chromium', browser: chromium, ctx: { viewport: { width: 1440, height: 900 } }, ask: !process.env.SKIP_ASK },
  { name: 'phone-chromium', browser: chromium, ctx: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } },
  { name: 'phone-webkit', browser: webkit, ctx: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } },
]
const only = process.env.ONLY?.split(',')
const ok = (cond, msg) => { if (!cond) throw new Error(`FAIL: ${msg}`); console.log(`  ✓ ${msg}`) }

for (const run of runs.filter(r => !only || only.includes(r.name))) {
  console.log(run.name)
  const browser = await run.browser.launch()
  const page = await (await browser.newContext({ ...run.ctx, colorScheme: 'dark' })).newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  page.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text()) })
  const shot = async n => { await page.waitForTimeout(500); await page.screenshot({ path: `${OUT}/${run.name}-fa-${n}.png` }) }
  const phone = !!run.ctx.isMobile
  const tab = name => (phone ? page.getByRole('tab', { name }) : page.locator('header').getByRole('button', { name, exact: true }))

  // soundtrack probe: count buffer-source starts and their offsets
  await page.addInitScript(() => {
    window.__starts = []
    const orig = AudioBufferSourceNode.prototype.start
    AudioBufferSourceNode.prototype.start = function (when, offset, dur) {
      if (!(this.context instanceof OfflineAudioContext)) window.__starts.push(offset ?? 0)   // live playback only, not the offline render
      return orig.call(this, when, offset, dur)
    }
  })
  await page.goto(BASE)
  const ids = await page.evaluate(async () => {
    const { importExport } = await import('/src/lib/importer.ts')
    const get = async (u, n) => new File([await (await fetch(u)).blob()], n)
    const a = await importExport(await get('/fixtures/WhatsApp%20Chat%20-%20Weekend%20Squad.zip', 'WhatsApp Chat - Weekend Squad.zip'))
    const b = await importExport(await get('/demo/demo-chat.txt', 'WhatsApp Chat with Yash.txt'))
    return { group: a.chatId, demo: b.chatId, demoCount: b.messages }
  })

  // ---- repair: fake an old import with a repeated block, then open it ----
  const before = await page.evaluate(async ({ demo }) => {
    const { db } = await import('/src/lib/db.ts')
    const rows = await db.messages.where('chatId').equals(demo).limit(400).toArray()
    await db.messages.bulkAdd(rows.slice(100, 400).map(({ id: _id, ...r }) => r))
    await db.chats.update(demo, { dataV: 0 })
    return db.messages.where('chatId').equals(demo).count()
  }, ids)

  // ---- open the demo chat ----
  await page.getByText('Yash', { exact: true }).first().click()
  await page.waitForTimeout(1500)
  const after = await page.evaluate(async ({ demo }) => (await import('/src/lib/db.ts')).db.messages.where('chatId').equals(demo).count(), ids)
  ok(after === before - 300, `repair removed the repeated block (${before} → ${after})`)

  // ---- Find ----
  await tab('Find').click()
  await page.getByLabel('Search messages').fill('birthday')
  await page.getByText(/messages? on \d+ days?/).waitFor()
  const total = await page.locator('text=/^\\d[\\d,]* messages?/').first().textContent()
  ok(/\d/.test(total), `Find shows a total (${total.trim()})`)
  ok(await page.getByText('When it came up').isVisible(), 'timeline shows')
  await shot('01-find-results')
  await page.getByRole('button', { name: 'People', exact: true }).click()
  await page.getByRole('checkbox', { name: /Yash/ }).click()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
  ok(await page.getByRole('button', { name: 'Yash', exact: true }).isVisible(), 'people filter chip shows the name')
  await page.getByRole('button', { name: 'Context' }).first().click()
  await shot('02-find-filtered-context')
  await page.getByRole('button', { name: 'Open in chat' }).first().click()
  await page.waitForTimeout(900)
  const flashed = await page.locator('.ring-wa-bright').count()
  ok(flashed === 1, 'Open in chat lands on the message (flashed)')
  await shot('03-reader-focus')

  // browse: photos grid from the group, typo tolerance, operators
  await tab('Find').click()
  await page.getByRole('button', { name: 'Clear all' }).click()
  await page.getByLabel('Search messages').fill('birthdya')
  await page.getByText(/messages? on \d+ days?/).waitFor()
  ok(await page.locator('mark').count() > 0, 'typo "birthdya" still finds and highlights birthday')
  await page.getByLabel('Search messages').fill('has:link from:pinky')
  await page.waitForTimeout(600)
  ok(await page.getByText(/messages? on \d+ days?/).isVisible(), 'operators has:/from: work')
  await page.getByRole('button', { name: 'Clear all' }).click()
  await page.getByRole('button', { name: 'Late-night texts' }).click()
  await page.waitForTimeout(600)
  await shot('04-find-browse')

  // ---- group: who is you, beyond the top senders ----
  await page.evaluate(async ({ group }) => {
    localStorage.removeItem('wrappedapp-me')
    await (await import('/src/lib/db.ts')).db.chats.update(group, { you: null, youSource: undefined })
  }, ids)
  if (phone) await page.getByRole('button', { name: 'Back to chats' }).click()
  await page.getByText('Weekend Squad', { exact: true }).first().click()
  await tab('Chat').click()
  const bar = page.getByText('Which one is you?')
  if (await bar.waitFor({ timeout: 4000 }).then(() => true, () => false)) {
    await page.getByRole('button', { name: 'Not listed? Find me' }).click()
    const sheet = page.getByRole('dialog', { name: 'Which one is you?' })
    const everyone = await sheet.getByRole('listitem').count()
    ok(everyone >= 4, `"Find me" lists everyone (${everyone})`)
    await shot('05-who-sheet')
    const last = sheet.getByRole('listitem').last()
    const name = (await last.locator('.truncate').textContent()).trim()
    await last.click()
    await page.waitForTimeout(500)
    ok(!(await bar.isVisible()), `picked ${name}; bar gone`)
  } else console.log('  · group already knows who you are')

  // ---- story soundtrack ----
  await page.getByRole('button', { name: 'Play the Rewind' }).click()
  await page.locator('.fixed.inset-0.z-50').waitFor()
  await page.waitForFunction(() => window.__starts.length >= 1, null, { timeout: 8000 })
  const s1 = await page.evaluate(() => window.__starts.slice())
  ok(s1.length >= 1, `soundtrack starts with the story (card 1 from ${s1[0].toFixed(2)}s)`)
  await page.waitForTimeout(1500)  // next card prefetched by now
  const n1 = await page.evaluate(() => window.__starts.length)
  await page.keyboard.press('ArrowRight')
  await page.waitForFunction(n => window.__starts.length > n, n1, { timeout: 4000 })
  const s2 = await page.evaluate(() => window.__starts.slice())
  ok(s2[s2.length - 1] < 0.05, `next card starts from its whoosh (${s2[s2.length - 1].toFixed(2)}s into its stretch)`)
  await page.getByRole('button', { name: 'Mute soundtrack' }).click()
  ok(await page.getByRole('button', { name: 'Play soundtrack' }).isVisible(), 'mute toggle')
  await page.getByRole('button', { name: 'Play soundtrack' }).click()
  await page.keyboard.press('Escape')

  // ---- Ask with a local model ----
  if (run.ask) {
    if (phone) await page.getByRole('button', { name: 'Back to chats' }).click()
    await page.getByText('Yash', { exact: true }).first().click()
    await tab('Ask').click()
    await shot('06-ask-home')
    await page.getByRole('button', { name: 'Set up a model' }).click()
    const dlg = page.getByRole('dialog', { name: 'Ask settings' })
    await dlg.getByRole('radio', { name: /Ollama/ }).first().click()
    await dlg.getByText(/Connected · \d+ models/).first().waitFor({ timeout: 15000 })
    await dlg.locator('input[list]').first().fill(MODEL)
    await shot('07-ask-settings')
    await dlg.getByRole('button', { name: 'Done' }).click()
    const q = 'When did Yash say she was tired the most? Which month?'
    await page.getByLabel('Ask a question').fill(q)
    await page.getByRole('button', { name: 'Send question' }).click()
    await page.waitForTimeout(4000)
    await shot('08-ask-working')
    await page.getByText(/no message text left this device|shared with/).waitFor({ timeout: 300000 })
    const steps = await page.getByRole('button', { name: /^\d+ steps?$/ }).first().textContent().catch(() => '0 steps')
    const trail = await page.getByRole('button', { name: /^\d+ (sources?|messages it read|message it read)$/ }).first().textContent().catch(() => 'none')
    ok(/^[1-9]/.test(steps.trim()), `Ask answered with ${MODEL} after ${steps.trim()}; trail: ${trail.trim()}`)
    ok(await page.getByText('no message text left this device').isVisible(), 'local model: nothing left the device')
    await page.getByRole('button', { name: /^\d+ steps?$/ }).first().click()
    await page.getByRole('button', { name: /^\d+ (sources?|messages? it read)$/ }).first().click().catch(() => {})
    await shot('09-ask-answer')
  }

  ok(!errors.length, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`)
  await browser.close()
}
