// Insights test: Hall of Fame, Telepathy, shared vocabulary, tone cues.
//   node scripts/test-insights.mjs
import { build } from 'rolldown'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const dir = mkdtempSync(join(tmpdir(), 'wa-insights-'))
await build({ input: { i: 'src/lib/insights.ts', t: 'src/lib/tone.ts' }, output: { dir, format: 'esm' }, logLevel: 'silent' })
const { hallOfFame, telepathy, vocabulary } = await import(pathToFileURL(join(dir, 'i.js')).href)
const { analyzeTone, verdict } = await import(pathToFileURL(join(dir, 't.js')).href)
rmSync(dir, { recursive: true, force: true })
const vader = createRequire(import.meta.url)('vader-sentiment')

let id = 0, t = new Date(2024, 0, 1, 10).getTime()
const msgs = []
const say = (sender, text, gapSec = 30, type = 'text') => { t += gapSec * 1000; msgs.push({ id: ++id, chatId: 1, ts: t, sender, text, type }) }

// a joke that lands, with two laughers
say('Ana', 'why did the chai cross the road')
say('Ben', 'HAHAHAHAHA', 20); say('Cy', 'lmaooo 😂😂', 10)
// a rant
for (let i = 0; i < 6; i++) say('Ben', 'and another thing about the landlord who never fixes anything at all in this flat ugh', 40)
// telepathy: silence, then both write within seconds
say('Ana', 'hey are you up', 3600); say('Ben', 'hey are you up', 4)
say('Cy', 'yaar', 3600); say('Ana', 'hello?', 5)
// vocabulary: Ana says "scene" first, Ben picks it up two months later
for (let i = 0; i < 6; i++) say('Ana', 'what is the scene tonight', 600)
t += 60 * 86400_000
for (let i = 0; i < 6; i++) say('Ben', 'scene is sorted', 600)
for (let i = 0; i < 6; i++) say('Ana', 'scene', 600)

const hall = hallOfFame(msgs)
const joke = hall.find(h => h.kind === 'laughs')
assert.equal(joke?.text, 'why did the chai cross the road', 'joke credited with the laughs after it')
assert.equal(joke.people, 2, 'two people laughed')
assert.ok(hall.some(h => h.kind === 'rant' && h.sender === 'Ben' && h.count === 6), 'rant: six back-to-back messages')

const tp = telepathy(msgs)
assert.equal(tp.jinx, 1, 'jinx: same text within seconds')
assert.ok(tp.together >= 2, 'both broke the silence within seconds')
assert.equal(tp.jinxWords[0][0], 'hey are you up')

const v = vocabulary(msgs, ['Ana', 'Ben', 'Cy'])
assert.ok(v.shared.some(s => s.word === 'scene'), 'shared word')
const adopt = v.adopted.find(a => a.word === 'scene')
assert.equal(adopt?.from, 'Ana'); assert.equal(adopt?.to, 'Ben')

const score = s => vader.SentimentIntensityAnalyzer.polarity_scores(s).compound
const tone = analyzeTone([
  { id: 1, ts: 1, sender: 'A', text: 'I love this so much ❤️', type: 'text' },
  { id: 2, ts: 2, sender: 'B', text: 'great, another monday 🙄', type: 'text' },
  { id: 3, ts: 3, sender: 'A', text: 'WHY IS THIS HAPPENING!!!', type: 'text' },
  { id: 4, ts: 4, sender: 'B', text: 'ok', type: 'text' },
  { id: 5, ts: 5, sender: 'A', text: 'bahut bekar din tha', type: 'text' },
], score)
assert.equal(tone.total.sarcasm, 1, 'eye-roll next to praise reads as sarcasm')
assert.equal(tone.total.chaos, 1, 'caps + !!! read as chaos')
assert.equal(tone.total.neg, 1, 'Hinglish "bekar" (→ bad) scores negative')
assert.equal(analyzeTone([{ id: 1, ts: 1, sender: 'A', text: 'bahut bekar din tha', type: 'text' }], score).total.neg, 1)
assert.ok(verdict(tone.total).title.length > 0)
console.log(`insights: hall ${hall.length}, telepathy ${tp.together}+${tp.jinx}, shared ${v.shared.length}, tone ok — all assertions passed`)
