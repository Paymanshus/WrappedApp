// Generates a realistic Android-format WhatsApp export for testing.
// node scripts/gen-sample.mjs > demo/demo-chat.txt
const A = 'Pinky', B = 'Yash'
const lines = []
const pad = n => String(n).padStart(2, '0')
const fmt = d => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)}, ${pad(d.getHours())}:${pad(d.getMinutes())}`

const texts = [
  'hey! did you see that?', 'hahahaha no way 😂', 'omg', 'wait what', 'bro that movie was insane',
  'lets get chai tomorrow?', 'im so tired today', 'did you finish the assignment', 'send me the pics!!',
  'lol', 'that reminds me of goa trip', 'coffee > chai and you know it', 'no??', 'yesss',
  'what time works for you', 'running late, 10 mins', 'reached', 'call me when free',
  'happy birthday!!! 🎂🎉', 'thank you so much ❤️', 'did you eat?', 'match tonight?',
  'this song is stuck in my head', 'https://youtu.be/dQw4w9WgXcQ check this', 'lmaooo 😂😂',
  'i cannot believe she said that', 'meeting got cancelled 🙏', 'pizza tonight?', 'im in',
  'good morning ☀️', 'good night 🌙', 'miss you yaar', 'same honestly', 'ok done', 'perfect 👌',
  'wait till you hear this', 'tell me everything', 'NO WAY', 'i told you so', 'fine you win',
  'what should i wear tomorrow', 'the blue one obviously', 'send location', 'on my way 🚗',
]
const media = ['<Media omitted>', 'IMG-2023-WA0012.jpg (file attached)', '<Media omitted>']

let d = new Date(2021, 2, 14, 19, 4)
const end = new Date(2025, 10, 20)
lines.push(`${fmt(d)} - Messages and calls are end-to-end encrypted. No one outside of this chat can read or listen to them.`)
lines.push(`${fmt(d)} - ${A}: hey! this yash? got your number from rohan`)
lines.push(`${fmt(new Date(+d + 40 * 60000))} - ${B}: yes! hi pinky 👋`)

let seed = 42
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31

while (d < end) {
  // gap to next conversation: mostly hours, sometimes days
  const r = rnd()
  const gapH = r < 0.55 ? 2 + rnd() * 10 : r < 0.9 ? 12 + rnd() * 40 : 60 + rnd() * 200
  d = new Date(+d + gapH * 3600_000)
  if (d.getHours() < 8) d.setHours(8 + Math.floor(rnd() * 4))
  // seasonality: quieter mid-2024 drought
  if (d.getFullYear() === 2024 && d.getMonth() >= 4 && d.getMonth() <= 6 && rnd() < 0.8) { d = new Date(+d + 5 * 86400_000); continue }
  // a burst conversation
  const n = 2 + Math.floor(rnd() * (rnd() < 0.08 ? 60 : 14))
  let who = rnd() < 0.55 ? A : B
  for (let i = 0; i < n && d < end; i++) {
    d = new Date(+d + (30 + rnd() * 60000 * 8))
    const t = rnd() < 0.06 ? media[Math.floor(rnd() * media.length)] : texts[Math.floor(rnd() * texts.length)]
    lines.push(`${fmt(d)} - ${who}: ${t}`)
    if (rnd() < 0.65) who = who === A ? B : A   // sometimes double-texts
  }
}
console.log(lines.join('\n'))
