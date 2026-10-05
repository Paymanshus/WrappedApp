// Test fixture: an iOS-format GROUP export zip with real media entries, spanning 2024–2026.
// Exercises: iOS header/LRM system lines, <attached:> media, stored + deflated zip entries,
// group awards (5 members with distinct habits), and the year filter.
// node scripts/gen-fixture-group.mjs  →  fixtures/WhatsApp Chat - Weekend Squad.zip
import { zipSync, strToU8 } from 'fflate'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const LRM = '‎'
const pad = n => String(n).padStart(2, '0')
const fmt = d => `[${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)}, ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}]`
let seed = 7
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31
const pick = a => a[Math.floor(rnd() * a.length)]

const members = {
  Rohan: { weight: 0.36, texts: ['bro', 'who is in for saturday', 'lets gooo', 'booking the turf', 'come on guys reply', 'ok fine', 'hahaha', 'same', 'on my way', 'lmaooo'], night: 0.1 },
  Meera: { weight: 0.2, texts: ['Okay so I have been thinking about the trip and honestly I think we should do the hills instead of the beach because it will be cooler and cheaper and nobody wants to get sunburnt again like last year', 'Long story short: the restaurant was closed, we walked for an hour, found a tiny place with the best biryani of my life, and I am still thinking about it', 'Can everyone please confirm by tonight so I can book the tickets before the prices go up again, I am begging'], night: 0.05 },
  Kabir: { weight: 0.2, texts: ['cant sleep', 'anyone up', 'this song at 2am hits different', 'voice note incoming', 'lol', 'gn'], night: 0.7 },
  Zoya: { weight: 0.19, texts: ['😂😂😂', 'omg 🔥🔥', 'yesss 🙌', 'love this ❤️', 'noooo 😭', 'party 🎉🎉', 'cute 🥹'], night: 0.15 },
  Dev: { weight: 0.05, texts: ['👍', 'ok', 'in'], night: 0.05 },
}
const names = Object.keys(members)
const choose = () => { let r = rnd(), acc = 0; for (const n of names) { acc += members[n].weight; if (r < acc) return n } return 'Rohan' }

const lines = []
const media = {}
const photos = ['party', 'trophy', 'sun', 'fire', 'camera', 'hearts']
let d = new Date(2024, 0, 6, 18, 2, 11)
lines.push(`${fmt(d)} Weekend Squad: ${LRM}Messages and calls are end-to-end encrypted. Only people in this chat can read, listen to, or share them.`)
lines.push(`${fmt(d)} Rohan: ${LRM}Rohan created group “Weekend Squad”`)
let n = 0
const end = new Date(2026, 8, 28)
while (d < end) {
  d = new Date(+d + (3 + rnd() * 40) * 3600_000)
  const burst = 3 + Math.floor(rnd() * (rnd() < 0.1 ? 50 : 12))
  for (let i = 0; i < burst && d < end; i++) {
    const who = choose()
    d = new Date(+d + (20 + rnd() * 600) * 1000)
    const m = members[who]
    if (rnd() < m.night) d.setHours(23 + Math.floor(rnd() * 3) % 24)
    const r = rnd()
    if (who === 'Kabir' && r < 0.12) {
      const fn = `${pad(++n).padStart(8, '0')}-AUDIO-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}.opus`
      media[fn] = [new Uint8Array(2048).map(() => Math.floor(rnd() * 256)), { level: 0 }]
      lines.push(`${LRM}${fmt(d)} ${who}: ${LRM}<attached: ${fn}>`)
    } else if (r < 0.03) {
      const fn = `${pad(++n).padStart(8, '0')}-PHOTO-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}.jpg`
      media[fn] = [readFileSync(`public/fx/${pick(photos)}.png`), { level: 0 }]
      lines.push(`${LRM}${fmt(d)} ${who}: ${LRM}<attached: ${fn}>`)
    } else if (r < 0.035) {
      lines.push(`${fmt(d)} ${who}: ${LRM}This message was deleted.`)
    } else {
      lines.push(`${fmt(d)} ${who}: ${pick(m.texts)}`)
    }
  }
}

mkdirSync('fixtures', { recursive: true })
const zip = zipSync({ '_chat.txt': [strToU8(lines.join('\n')), { level: 6 }], ...media })
writeFileSync('fixtures/WhatsApp Chat - Weekend Squad.zip', zip)
console.log(`${lines.length} lines, ${Object.keys(media).length} media files, ${(zip.length / 1024).toFixed(0)} KB`)
