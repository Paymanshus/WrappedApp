# WrappedApp — setup notes for agents

Enough to get the project running for a person. Humans: see [README.md](README.md).

## What it is

A client-only web app (Vite + React + TypeScript + Tailwind). No backend, no database server,
no environment variables, no API keys required. Data lives in the browser (IndexedDB + OPFS).

## Setup

Requirements: Node.js 22+, npm.

```bash
npm install
npm run dev            # http://localhost:5173
```

Other targets:

- Phone on the same network: `npm run dev -- --host`, then open the printed Network URL.
- Production: `npm run build` → static files in `dist/`. Serve over HTTPS from any static host.
  `npm run preview` serves the build locally on port 4173.

Verify: `npm run build` and `npm run lint` pass. The app opens to an empty state waiting for an
import; there is no sample data loaded by default.

## Optional: local model for Ask

Ask works without any model configured; it just asks the user to pick one. For a local model:

```bash
ollama pull qwen3.5:9b         # qwen3.5:4b on machines with ≤16 GB memory
ollama serve                   # add OLLAMA_ORIGINS="https://<host>" when the app isn't on localhost
```

The user then selects Ollama under Ask → Set up a model. Cloud providers (Claude, OpenAI, Gemini,
OpenRouter) take the user's own key in the same screen; never write keys into the repo.

## Tests (only if asked)

- Unit: `npm run test:parser`, `test:search`, `test:insights`, `test:laugh`
- End-to-end (Playwright, needs the dev server running and `npx playwright install chromium webkit`):
  run `npm run fixtures` first to generate the group-chat fixture, then `npm run e2e` etc.
  `demo/demo-chat.txt` is the synthetic chat the tests import.

## Where things are

- `src/` app code; `src/workers/` import and search workers; `src/lib/agent/` Ask
- `design_spec.md` UI rules; `ask_spec.md` search and Ask behaviour
- `assets/` media for docs (not used by the app)
