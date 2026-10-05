// Story card audit: for every card, screenshot the live DOM card and render the canvas
// export of the same card, so the two renderers can be compared side by side.
//   npm run dev   (in another terminal)
//   OUT=screens [VIEWPORT=390x844] [ENGINE=webkit] node scripts/e2e-story.mjs [group|demo]
import { chromium, webkit } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
const OUT = process.env.OUT ?? 'screens'
const which = process.argv[2] ?? 'group'
const engine = process.env.ENGINE === 'webkit' ? webkit : chromium
mkdirSync(OUT, { recursive: true })
const b = await engine.launch()
const [vw, vh] = (process.env.VIEWPORT ?? '1280x1000').split('x').map(Number)
const page = await (await b.newContext({ viewport: { width: vw, height: vh }, isMobile: vw < 768, hasTouch: vw < 768, deviceScaleFactor: vw < 768 ? 2 : 1 })).newPage()
const errors = []
page.on('pageerror', e => errors.push(String(e)))
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
await page.goto('http://localhost:5173')
const src = which === 'demo' ? ['/demo/demo-chat.txt', 'WhatsApp Chat with Yash.txt'] : ['/fixtures/WhatsApp%20Chat%20-%20Weekend%20Squad.zip', 'WhatsApp Chat - Weekend Squad.zip']
const n = await page.evaluate(async ([u, name]) => {
  const { importExport } = await import('/src/lib/importer.ts')
  await importExport(new File([await (await fetch(u)).blob()], name))
  const { db } = await import('/src/lib/db.ts')
  return (await db.chats.toArray()).length
}, src)
await page.getByRole('button', { name: 'Watch the Rewind' }).first().click()
const frame = page.locator('.fixed.inset-0.z-50 [style*="container-type"]')
await frame.waitFor()
const count = await page.evaluate(() => document.querySelectorAll('.fixed.inset-0.z-50 .h-\\[3px\\]').length)
for (let i = 0; i < count; i++) {
  await page.waitForTimeout(3400)
  await frame.screenshot({ path: `${OUT}/story-${which}-${String(i).padStart(2, '0')}-dom.png` })
  const png = await page.evaluate(async i => {
    const { db } = await import('/src/lib/db.ts')
    const { buildStory } = await import('/src/lib/story/model.ts')
    const { renderCardBlob } = await import('/src/lib/story/canvas.ts')
    const chats = await db.chats.orderBy('lastTs').reverse().toArray()
    const m = buildStory(chats[0], await db.stats.get(chats[0].id), {})
    const blob = await renderCardBlob(m, i)
    return [...new Uint8Array(await blob.arrayBuffer())]
  }, i)
  writeFileSync(`${OUT}/story-${which}-${String(i).padStart(2, '0')}-canvas.png`, Buffer.from(png))
  await page.keyboard.press('ArrowRight')
}
console.log(JSON.stringify({ cards: count, chats: n, errors: errors.slice(0, 5) }))
await b.close()
