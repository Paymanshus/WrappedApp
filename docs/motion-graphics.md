# How the Rewind's motion graphics work

Everything is drawn by code: no video files, no animation files, no server. The same code
paints the live story, the PNG exports, the posters and every frame of the MP4.

## 1. One scene engine, two renderers
`src/lib/story/scene.ts`. Each card's hero animation is a **pure function**:
`(card data, t = seconds since the card appeared, time = ambient clock) → list of shapes`.
Shapes are tiny vector primitives (path, circle, text, group with translate/rotate/scale),
laid out in a fixed **1080×1920** design space.

- **Live story** → `toSvg()` turns the list into an `<svg>` string; the player re-renders it
  every animation frame (`requestAnimationFrame`).
- **Exports** → `drawPrims()` draws the same list onto a `<canvas>` with `Path2D`.

Because both read the same function at the same `t`, the shared video matches what you watched.

## 2. Built from chat primitives, animated like Wrapped
Scenes reuse WhatsApp's own shapes: `bubble()` (with the corner tail), read ticks, typing dots,
status-ring arcs, the dot "doodle" lattice. Motion comes from a few easing curves
(`eo` ease-out, `back` overshoot, `seg(t, start, dur)` to stagger): bubbles pop in, bars sweep
around a clock, strokes "draw" via dash offsets, rings rotate. Twelve scenes:
stream · mosaic · balance · lengths · clock · ticks · calendar · spike · reactions · marquee · status · ripples.

## 3. Card layout = same anatomy everywhere
Hero zone (y 230–950) holds the scene and an optional Fluent 3D illustration; the text zone
starts at y 1010 (kicker → condensed outline→fill headline → body → small viz). In the DOM a CSS
unit `--u = max(100cqw/1080, 100cqh/1920)` maps the design space onto any screen with the same
"slice" fit the SVG uses, so DOM text and canvas text land in the same places.

## 4. CSS for entrances, JS only where it must
Text and UI entrances are CSS keyframes (`a-rise`, `a-pop`, `a-wipe` bubble mask between cards,
`a-fill` headline fill), which run on the compositor and can't get stuck. JS animation is limited
to the scene frames and number count-ups (with a timer fallback).

## 5. The type
Archivo (OFL), registered in `src/lib/fonts.ts` as "Archivo Display" with a fixed condensed width
through `FontFace`, because Safari's canvas ignores `fontStretch`. Same letterforms in DOM, SVG and canvas.

## 6. Video
`src/lib/shareCard.ts`. A timeline maps each second to (card, t): 3.75 s per card (8 beats), a 0.5 s
bubble-wipe between cards, a one-bar tail. For each frame at 30 fps it calls `drawCard()` on a canvas and hands the
frame to **Mediabunny**, which feeds the browser's hardware **WebCodecs** H.264 encoder and writes an MP4.
Frame-by-frame means it isn't real time: a ~47 s video with sound renders in about 15 s on a laptop, on
the user's device, at zero server cost. Fallback for browsers without WebCodecs: `MediaRecorder` in real time.

## 7. Soundtrack (synced, code-generated)
`src/lib/story/soundtrack.ts`. No samples or licensed music: every sound is synthesized with the Web
Audio API in an `OfflineAudioContext` (~1 s to render a 47 s track). The video runs on a **128 BPM grid**:
one card = 8 beats (3.75 s), so every bubble-wipe lands on a downbeat. A lo-fi pop bed (pads, bass,
drums that drop in on card 2) plays under **sync hits**: a whoosh on each wipe, plus each scene's own cues
(`cuesFor()` in scene.ts — pops as bubbles appear, ticks, the read-receipt chime, risers under count-ups),
declared next to the scene's animation so sound and picture share one timeline. Mediabunny muxes it as AAC
(Opus fallback) in 1 s chunks interleaved with the frames. Chrome's AAC encoder adds ~44 ms of priming
that the MP4 doesn't trim, so the app measures it once (encode a click, decode, find it) and shifts the
audio — measured sync error: 0 ms in Chrome and Safari's engine.

The live story plays the same score with 16-beat cards (7.5 s), rendered **one card at a time**
(`lib/story/liveSound.ts`, ~70 ms each in a headless browser): the current card first, the next two
prefetched. Every card change (tap, autoplay) starts that card's stretch 0.12 s before its downbeat
so the whoosh lands with the wipe; hold-to-pause suspends the audio clock. The score is a pure
function of absolute time, so a card rendered alone matches the full track.

## 8. Posters
`src/lib/story/posters.ts`. Static 1080×1920 canvases from `StoryModel.summary` (top facts only):
solid token-colored fields, echo-outlined numbers, chat-bubble tiles, patterns, and a film grain
made from a seeded noise tile with `overlay` blending.

## Checking it
`npm run e2e:story` screenshots every live card next to its canvas export; `npm run e2e:video`
encodes, decodes and samples the MP4. See `design_spec.md` → Rewind card anatomy for the rules.
