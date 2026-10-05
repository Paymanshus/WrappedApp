// Parser regression test for real-world iOS export quirks (found on a 133k-message export).
//   node scripts/test-parser.mjs
import { build } from 'rolldown'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const dir = mkdtempSync(join(tmpdir(), 'wa-parser-'))
const file = join(dir, 'parse.mjs')
await build({ input: 'src/lib/parser/parseTxt.ts', output: { file, format: 'esm' }, logLevel: 'silent' })
const { parseTxt } = await import(pathToFileURL(file).href)
rmSync(dir, { recursive: true, force: true })

const L = '‎'
const chat = [
  `[03/10/25, 09:00:00] Ana: ${L}Messages and calls are end-to-end encrypted.`,
  `[03/10/25, 09:01:00] Ana: hello there`,
  `[03/10/25, 09:02:00] Ben: look at this ${L}image omitted`,
  `[03/10/25, 09:03:00] Ben: ${L}Trip plan.pdf • 3 pages ${L}document omitted`,
  `[03/10/25, 09:04:00] Ana: ${L}You received a view once message. For added privacy, you can only open it on your phone.`,
  `[03/10/25, 09:05:00] Ben:`,
  `first line after a line break`,
  `second line`,
  `[03/10/25, 09:06:00] Ana: fixed the typo ${L}<This message was edited>`,
  `[03/10/25, 09:07:00] Ben: ${L}Voice call, ${L}12 min`,
  `[03/10/25, 09:08:00] Ana: ${L}image omitted`,
  `[03/10/25, 09:09:00] Ana changed the group description:`,
  `new description text`,
].join('\r\n')

const m = parseTxt(chat)
const at = i => ({ sender: m[i].sender, type: m[i].type, text: m[i].text })

assert.deepEqual(at(0), { sender: '', type: 'system', text: 'Messages and calls are end-to-end encrypted.' }, 'iOS LRM system line')
assert.deepEqual(at(1), { sender: 'Ana', type: 'text', text: 'hello there' })
assert.deepEqual(at(2), { sender: 'Ben', type: 'image', text: 'look at this' }, 'captioned image keeps caption')
assert.deepEqual(at(3), { sender: 'Ben', type: 'doc', text: 'Trip plan.pdf' }, 'document with page count')
assert.deepEqual(at(4), { sender: 'Ana', type: 'image', text: '' }, 'view-once is media from the sender')
assert.deepEqual(at(5), { sender: 'Ben', type: 'text', text: 'first line after a line break\nsecond line' }, '"Name:" then newline')
assert.deepEqual(at(6), { sender: 'Ana', type: 'text', text: 'fixed the typo' }, 'edited marker stripped')
assert.equal(at(7).type, 'system', 'calls stay system lines')
assert.deepEqual(at(8), { sender: 'Ana', type: 'image', text: '' }, 'plain omitted media')
assert.equal(at(9).type, 'system', 'unknown "X changed …:" is not a sender')

// repeated block (iOS export glitch): a stretch of the chat appears twice → kept once
const block = [
  `[04/10/25, 10:00:01] Ana: one`,
  `[04/10/25, 10:00:02] Ben: two`,
  `[04/10/25, 10:00:03] Ana: three`,
]
const rep = parseTxt([...block, `[04/10/25, 10:00:04] Ben: four`, ...block].join('\n'))
assert.equal(rep.length, 4, 'repeated block with seconds is dropped')
// minute-resolution (Android): an isolated repeat is a real double text; a 3+ run is a repeated block
const and = (t, s, x) => `04/10/2025, ${t} - ${s}: ${x}`
const a1 = parseTxt([and('10:00', 'Ana', 'ok'), and('10:00', 'Ana', 'ok')].join('\n'))
assert.equal(a1.length, 2, 'same-minute "ok" twice survives without seconds')
const ablock = [and('10:00', 'Ana', 'a'), and('10:01', 'Ben', 'b'), and('10:02', 'Ana', 'c')]
assert.equal(parseTxt([...ablock, ...ablock].join('\n')).length, 3, 'repeated run without seconds is dropped')
console.log(`parser: ${m.length} records, all assertions passed`)
