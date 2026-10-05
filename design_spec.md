# Design Spec — WrappedApp

## Feel
Chat-native, kinetic, warm-dark, confident. **The chrome feels like WhatsApp; the Rewind speaks like Wrapped.**
Lists, headers, bubbles and the reader stay close to native WhatsApp (dark theme, system font, teal/green).
Story cards get a voice: condensed display type, oversized numbers, and motion built *only* from chat
primitives (bubbles, ticks, typing dots, status rings, the dot "doodle" lattice). Never alien: no
gradients-as-decoration, no new brand colors, no cartoon art.

## Tokens
Defined in `src/index.css` `@theme` (Tailwind v4 → `bg-*`/`text-*` utilities). Canvas/SVG mirror them in
`lib/story/scene.ts` `SC` and `lib/story/canvas.ts` `C` — **change all three together**.
- Surfaces: `app #111B21` (lists) · `chatbg #0B141A` (chat, story, dashboard) · `panel #202C33` · `panel-2 #2A3942` · `stroke #222E35`
- Ink: `ink #E9EDEF` · `ink-2 #8696A0` (secondary) · `ink-3 #667781` (meta)
- Brand: `wa #00A884` (actions, fills) · `wa-bright #25D366` (headlines, highlights, glow) · `bubble-out #005C4B` · mint `#86efac` (scene accents only)
- Signals: `read #53BDEB` (read ticks; also a share-poster field) · `coral #FB7185` (the hot accent: silences, alerts, a share-poster field)
- Deep teal `#075E54` — story-ring gradient stop and the Personality poster field only
- Identity (people/series): validated categorical `cat-1…5` = `#00A884 #8b5cf6 #d97706 #0284c7 #e11d48`, fixed order, never cycled past 5 → fold into "Everyone else" `#667781`.
  Users may override per person from 10 `SWATCHES` (`lib/colors.ts`: those 5 + `#65a30d #db2777 #c026d3 #0891b2 #ea580c`).
  No 6th color passes all-pairs CVD against the 5, so the picker warns on the 11 known clash pairs (validator,
  dark, all pairs) and offers a fix. Colors resolve from all-time rank so year views never repaint a person.
- Type — UI: system stack (`--font-sans`), 11.5–15px, weights 400/500/600. Display: **Archivo Display**
  (condensed 75%, 800; `lib/fonts.ts`) for story headlines, stat-tile values and the personality title only.
- Story design space: 1080×1920; DOM uses `--u` = `max(100cqw/1080, 100cqh/1920)` (SVG "slice").
  Kicker 32u caps +0.25em · headline 104–210u · body 44u/1.45 · viz labels 34u · text width ≤ 900u.
- Radii: bubbles `rounded-lg` + tail · sections `rounded-2xl` · hero/sheets `rounded-3xl` · chips/pills `rounded-full`
- Glow: `.glow-green` (box) / `.text-glow` (headline) — at most one glowing element per view.
- Motion (index.css, all CSS so content never depends on rAF): `a-rise` .55s expo-out · `a-pop` .65s back ·
  `a-wipe` .5s in-out bubble mask (card change) · `a-fill` .9s outline→fill (headline, .35s delay) ·
  `a-grow`/`a-grow-y` bars · `a-reveal` scroll-driven. Story card 7.5s live (16 beats), 3.75s in video (8 beats); scenes settle by 4.2s.

## Components (extend these first)
- `Sidebar` — components/Sidebar.tsx — chat list, import, storage meter; full-width on phones
- `StoryRing` — components/StoryRing.tsx — avatar ring: processing (spinning arc) / new (animated conic) / seen (40%)
- `Story` + `CardView` — components/Story.tsx — 9:16 player: autoplay, tap/hold, bubble-wipe, scene layer
- Scenes — lib/story/scene.ts — `stream mosaic balance lengths clock ticks calendar spike reactions marquee status ripples`
- Share posters — lib/story/posters.ts + components/PosterSheet.tsx — end-of-story swipe carousel of 5 highlight images
- `drawCard`/`drawTransition` — lib/story/canvas.ts — same anatomy on canvas (PNG + MP4 frames)
- `StoryModel` — lib/story/model.ts — all copy + scene data; also the `#r=` share-link payload
- `ShareButton` → `PosterSheet` — the share hub: swipe posters (share one / all as .zip), make video, copy link
- `Dashboard` — year chips, personality hero, stat tiles, awards, charts; `Section`/`StatTile` in charts.tsx
- Charts — charts.tsx — `MonthlyTimeline` `YearlyBars` `HourHeatmap` (transposes <640px) `Leaderboard` `Duel` `WordColumns` `EmojiPodium`
- `Reader` — components/Reader.tsx — virtualized (react-virtuoso), newest at bottom; search → results list → jump + ↑/↓ stepper
- `PeopleSheet` — components/PeopleSheet.tsx — who is you (right-hand bubbles) + per-person color swatches with clash warnings; search for big groups
- `WhoBar`/`WhoSheet` — components/WhoSheet.tsx — "Which one is you?": top senders as chips + searchable everyone sheet
- `Find` — components/Find.tsx — query bar, `FilterChip` row, summary (count · days · sort), "When it came up" month bars (tap = filter), who-says-it split, hit rows (context / open in chat), media grid
- `FilterChip` + `Option` + `PanelTitle` — components/FilterChip.tsx — pill → dropdown (md+) / bottom sheet (phones); checkbox/radio rows
- `AskPanel` — components/AskPanel.tsx — question bubble (bubble-out), collapsible steps trail, streamed answer (light markdown), citation chips `Name · 12 Mar 25`, sources, usage + privacy line
- `AskSettings` + `ModelPicker` — components/AskSettings.tsx — provider cards (Laptop = local, Cloud = remote), key, server, live model list
- Insights — components/Insights.tsx — `HallOfFame` (tabbed quote cards: laughs / openers / rants / longest), `TelepathySection` (score tile + jinx chips + example pairs), `VocabularySection` (match % + line, shared-word twin bars, adoption list, per-word trend lines)
- `DigDeeper` — components/DigDeeper.tsx — dashed-border opt-in section: tone check (on device), AI recap cards (`DigCard`), Ask shortcuts
- `Fx` — components/Fx.tsx — Fluent 3D illustration (expression tier); names in lib/story/fx.ts

## Rewind card anatomy (DOM and canvas must agree)
1. Background pattern (static per scene): dots lattice · diagonal stripes · concentric rings around the hero.
2. Hero zone y 230–950 (centre 540,590): the card's scene, optionally a Fx illustration in the scene's slot.
   Keep important marks within x 150–930: phones are taller than 9:16 and crop ~95 units per side.
3. Text zone from y 1010 (300 when a card has no hero): kicker → headline (outline, then fill) → body → viz.
4. Chrome: progress segments, WrappedApp mark, chat title; footer line on exports only.
New scene = pure `(card, t, time) → Prim[]`, built from `bubble() rrect() arc() typingDots()`; add its
key to `SceneKey`, pick a background + optional Fx slot, add any numbers to `SceneData` (0–100 ints).

## Share posters (Wrapped-style, louder than the story)
Five 1080×1920 one-pagers from `StoryModel.summary`: overview (wa-bright, dots) · personality (teal, rings) ·
top 5s (coral, stripes) · head-to-head / group awards (violet, bubble field) · body clock (read-blue, spiral).
Solid fields, never gradients; echo-outlined display numbers; white chat-bubble tiles with dark ink; grain overlay.
Only the top facts — never message text. This is the default share screen (story header, last card, dashboard, shared links); individual story
cards aren't exported separately — people can screenshot them. Exports carry no footer line.

## Iconography (three tiers, never mixed in one role)
Phosphor = interface chrome · Fluent 3D (`Fx`) = expressive beats · the user's own emoji = data only.
No raw emoji in UI copy or chrome.

## Patterns
- "You" = the exporter: detected (saved name → "You deleted/sent…" lines → 1:1 title is the other person),
  else a one-tap "Which one is you?" bar in the reader; corrections are remembered for future imports.
- Phones: list ↔ detail with back arrow; detail tabs (Rewind · Chat · Find · Ask) as WhatsApp underline tabs. md+: sidebar + panel.
- Find/Ask → reader: "Open in chat" switches chat if needed and lands centred on the message with a 2.2s `ring-wa-bright` flash.
- Ask is honest about data: every answer ends with model · tokens · cost (when known) · what left the device. Citations render only for messages the tools actually returned.
- Two tiers of insight. Free tier (Rewind, dashboard sections) = deterministic stats, zero setup, never a model.
  Opt-in tier = **Dig deeper** only: each item names what it runs (Laptop icon = on this device, Cloud = your model),
  how much it sends, and runs only on tap; results persist in `db.insights` (stale-flagged if the chat changes).
- Story sound: on by default, speaker toggle in the story header (remembered); pauses with hold/tap-pause.
- Empty states: an Fx illustration + one sentence + one action. Errors say what happened and how to fix.
- Processing: placeholder row + spinning ring, progress text in the preview line. No blocking spinners.
- Overlays (story, share sheet) make the background `inert`; sheets are bottom sheets on phones.
- Copy: sentence case, plain verbs, "WrappedApp" (one word; marks split "Wrapped" ink + "App" wa-bright); name WhatsApp only as the export source.

## Accessibility
Contrast ≥ 4.5:1 body / 3:1 large on `chatbg`; identity never by color alone (labels + legend); focus
visible on all controls; touch targets ≥ 40px; `prefers-reduced-motion` stops loops, entrances and scenes
render their settled frame; charts keep the "All the numbers" table fallback.

## Rules
- Read this spec before UI work. Reuse/extend a component above; new ones go into the inventory in the same change.
- No new color, font, size scale or motion curve outside Tokens without recording it here.
- Story visuals change in **both** renderers (Story.tsx + canvas.ts) and stay verified with `scripts/e2e-story.mjs`
  (DOM-vs-canvas pairs) and `scripts/e2e-video.mjs`.
- Deviations need the user's ok; spec and code never disagree silently.

## Known drift
- UI text sizes are ad-hoc `text-[12.5px]`-style literals rather than a named scale (canonical: 11.5/12.5/13/14/15).
- Recharts/heatmap colors are hex literals in charts.tsx (canonical: the tokens above).
- Light theme (plan lane 9) not built; all tokens are dark-only today.
