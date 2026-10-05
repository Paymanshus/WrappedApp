// Laugh detector test.  node scripts/test-laugh.mjs
import { build } from 'rolldown'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const dir = mkdtempSync(join(tmpdir(), 'wa-laugh-'))
const file = join(dir, 'laugh.mjs')
await build({ input: 'src/lib/laugh.ts', output: { file, format: 'esm' }, logLevel: 'silent' })
const { isLaugh } = await import(pathToFileURL(file).href)
rmSync(dir, { recursive: true, force: true })

const yes = ['haha', 'hahah', 'hahaha', 'hahahaha', 'hahahahahahhaha', 'HAHAHAHA', 'ahahaha', 'okay hahah fine', 'hahaa',
  'hehe', 'hehehe', 'hihi', 'jajaja', 'lol', 'LOOOL', 'lolol', 'lmao', 'lmaoooo', 'lmfao', 'rofl', 'kek', 'xD', 'xDD',
  'that was 😂', '🤣', '😆', '😹', 'im dead 💀', 'HAHAHAHAHA what']
const no = ['aha', 'aha!', 'hah', 'ha', 'hahn', 'harsh', 'have a look', 'hello', 'lolita', 'please', 'xdx', 'he said', 'i am crying 😭', 'chai?']
for (const s of yes) assert.equal(isLaugh(s), true, `should count: ${s}`)
for (const s of no) assert.equal(isLaugh(s), false, `should not count: ${s}`)
console.log(`laugh: ${yes.length} laughs and ${no.length} non-laughs classified correctly`)
