// What counts as a laugh. A message is a "laugh" if any word in it is a laugh token or it
// contains a laughing emoji. Rules, per lowercased run of letters:
//   • ha-runs: only h/a, ≥4 letters, ≥2 h and ≥2 a → haha, hahah, HAHAHAHA, ahahah,
//     hahahahahahhaha (keyboard smash). Not "aha" (realisation) or "hah" (sarcasm).
//   • he/hi/ja/je repeats ×2+ → hehe, hihihi, jajaja, jejeje
//   • lol family → lol, lool, lolol, lolll · lmao/lmfao/lmaooo · rofl · kek · xd/xdd
//   • emoji: 😂 🤣 😆 😹 💀 ("I'm dead"). 😭 is left out: it is too often actually sad.

const EMOJI = /[\u{1F602}\u{1F923}\u{1F606}\u{1F639}\u{1F480}]/u

function laughWord(w: string): boolean {
  if (/^[ha]+$/.test(w)) {
    if (w.length < 4) return false
    let h = 0, a = 0
    for (const ch of w) {
      if (ch === 'h') h++
      else a++
    }
    return h >= 2 && a >= 2
  }
  return /^(?:he){2,}h?$|^(?:hi){2,}h?$|^(?:ja){2,}j?$|^(?:je){2,}j?$/.test(w)
    || /^l+o+l+(?:o+l+)*$/.test(w)
    || /^l+m+f*a+o+$/.test(w)
    || /^ro+fl+$/.test(w)
    || /^ke+k$/.test(w)
    || /^x+d+$/.test(w)
}

export function isLaugh(text: string): boolean {
  if (EMOJI.test(text)) return true
  for (const w of text.toLowerCase().split(/[^a-z]+/)) if (w && laughWord(w)) return true
  return false
}
