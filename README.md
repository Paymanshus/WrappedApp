# WrappedApp

Your WhatsApp chats, wrapped. Import an exported chat and get a story you can tap through, a
dashboard of stats, a full reader with search, and share-ready posters and videos.

Everything runs in your browser. Chats, media and stats stay on your device; there is no server.

> Setting this up with an AI coding agent? Point it at [AGENTREADME.md](AGENTREADME.md).

## What it does

- **Rewind**: a tap-through story of the chat (with its own soundtrack), shareable as posters,
  a video or a link
- **Dashboard**: who texts more, when you talk, streaks, signature words, Hall of Fame messages,
  how alike you sound, and more, for all time or any single year
- **Chat**: the whole conversation with media, plus fast search
- **Find**: search with filters (people, dates, photos, links, voice notes, time of day)
- **Ask** (optional): ask questions about the chat using a model you choose, either running on
  your own computer or with your own API key

## Run it on your laptop

You need [Node.js](https://nodejs.org) 22 or newer.

```bash
git clone https://github.com/Paymanshus/WrappedApp.git
cd WrappedApp
npm install
npm run dev
```

Open http://localhost:5173.

## Use it on your phone

To try it on your phone over your home Wi-Fi, start it so other devices can reach it:

```bash
npm run dev -- --host
```

Then open the `Network:` address it prints (for example `http://192.168.1.20:5173`) on your phone.
Some extras (installing as an app, working offline) need HTTPS, so for everyday phone use
it's easiest to host it (below).

## Get a chat out of WhatsApp

In the chat: **⋮ (or the contact name) → More → Export chat**, then choose with or without
media. Open WrappedApp and tap **Import**, or drop the `.zip` / `.txt` onto the page.

## Host it yourself

WrappedApp builds to plain static files, so it runs on any static host:

```bash
npm run build      # outputs to dist/
npm run preview    # check the build locally
```

Upload `dist/` to Vercel, Netlify, Cloudflare Pages, GitHub Pages, or any web server
(nginx, Caddy, `npx serve dist`). Serve it over HTTPS. No environment variables or backend.

## Ask, with a model on your own computer (optional)

Ask and the dashboard's "Dig deeper" recaps can use a free local model through
[Ollama](https://ollama.com):

```bash
ollama pull qwen3.5:9b      # about 6.6 GB; use qwen3.5:4b on machines with 8–16 GB of memory
ollama serve
```

In WrappedApp, open **Ask → Set up a model → Ollama**. Nothing leaves your device.

If WrappedApp is hosted somewhere (not on localhost), allow that site to talk to Ollama:

```bash
OLLAMA_ORIGINS="https://your-site.example" ollama serve
```

You can also use your own key for Claude, OpenAI, Gemini or OpenRouter instead. Keys stay in
your browser and go only to that provider.

## Privacy

- No account, no analytics, no backend. Your data lives in your browser's storage.
- The production build only allows the page to connect to itself, to model servers on your own
  machine, and to the AI providers above. Those are contacted only if you set them up.
- Shared links carry only what's printed on the story cards, never messages.

## Development

```bash
npm run build          # type-check + production build
npm run lint
npm run test:parser    # and test:search, test:insights, test:laugh
```

End-to-end checks use Playwright (`npx playwright install chromium webkit`) against `npm run dev`:
`npm run e2e`, `npm run e2e:find`, `npm run e2e:insights`, `npm run e2e:story`, `npm run e2e:video`.
