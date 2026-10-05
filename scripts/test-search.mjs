// Search engine test: ranking, spellings, operators, filters.
//   node scripts/test-search.mjs
import { build } from 'rolldown'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const dir = mkdtempSync(join(tmpdir(), 'wa-search-'))
const file = join(dir, 'engine.mjs')
await build({ input: 'src/lib/search/engine.ts', output: { file, format: 'esm' }, logLevel: 'silent' })
const { ChatIndex, search, parseQuery, tokenize, DEFAULT_OPTIONS } = await import(pathToFileURL(file).href)
rmSync(dir, { recursive: true, force: true })

let id = 0
const at = (y, mo, d, h = 12) => new Date(y, mo - 1, d, h).getTime()
const doc = (ts, sender, text, type = 'text') => ({ id: ++id, chatId: 1, ts, sender, text, type })
const docs = [
  doc(at(2024, 1, 5), 'Ana', 'Goa trip in March?'),
  doc(at(2024, 1, 5, 13), 'Ben', 'yes goa! book the flights'),
  doc(at(2024, 2, 1), 'Ana', 'achha fine, I booked the Goan villa'),
  doc(at(2024, 6, 1, 2), 'Ben', 'cant sleep, thinking about the trip'),
  doc(at(2025, 1, 1), 'Ana', 'happy new year 🎉'),
  doc(at(2025, 1, 2), 'Ben', '', 'image'),
  doc(at(2025, 1, 3), 'Ben', 'see https://example.com/goa'),
  doc(at(2025, 1, 4), '', 'Ana added Cy', 'system'),
  doc(at(2025, 1, 5), 'Cy', 'acha ok'),
  doc(at(2025, 2, 5), 'Ana', "don't forget the trip photos"),
]
const ix = new ChatIndex(docs)
const S = (text, filters = {}, options = {}) => search([ix], { text, filters, options: { ...DEFAULT_OPTIONS, ...options }, limit: 50, you: 'Ana' })
const texts = r => r.hits.map(h => h.doc.text)

assert.deepEqual(tokenize("Don't GOÂ 🎉"), ['dont', 'goa', '🎉'], 'tokens fold case/accents/apostrophes, keep emoji')
assert.equal(S('goa').total, 4, 'exact + prefix (Goan) + link')
assert.ok(texts(S('goa'))[0].toLowerCase().includes('goa'), 'exact spellings rank first')
assert.ok(texts(S('goa', {}, { whole: true })).every(t => !/goan/i.test(t)), 'whole words: no prefix')
assert.equal(S('achha').total, 2, 'typo-tolerant: achha ≈ acha')
assert.equal(S('achha', {}, { fuzzy: false }).total, 1, 'fuzzy off')
assert.equal(S('goa trip').total, 1, 'all words')
assert.equal(S('goa trip', {}, { match: 'any' }).total, 6, 'any word')
assert.equal(S('"book the flights"').total, 1, 'phrase')
assert.equal(S('goa -flights').total, 3, 'exclude')
assert.equal(S('from:ben').total, 4, 'from: with no words lists everything they sent (system lines excluded)')
assert.equal(S('trip from:me').total, 2, 'from:me resolves to you')
assert.equal(S('has:link').total, 1, 'has:link')
assert.equal(S('has:photo').total, 1, 'has:photo')
assert.equal(S('during:2025').total, 5, 'during:year')
assert.equal(S('before:2024-02').total, 2, 'before:month')
assert.equal(S('is:question').total, 1, 'is:question')
assert.equal(S('dont').total, 1, "apostrophes: dont = don't")
assert.equal(S('🎉').total, 1, 'emoji search')
assert.equal(S('', { hours: [0, 5] }).total, 1, 'late night window')
assert.equal(S('', { kinds: ['photo', 'link'] }).total, 2, 'types: any of')
assert.equal(S('', { system: true }).total, docs.length, 'system lines on request')
assert.deepEqual(S('', {}, { sort: 'oldest' }).hits[0].doc.text, 'Goa trip in March?', 'oldest first')
assert.equal(S('goa').months.length, 13, 'month histogram fills gaps')
assert.deepEqual(parseQuery('from:"Ana B" -x "a b" c').people, ['ana b'])
console.log(`search: ${docs.length} docs, all assertions passed`)
