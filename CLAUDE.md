# Strudel Generative Music from Audience Samples

Browser-based generative music system for live performances, built on [Strudel](https://strudel.cc). An operator dashboard drives a four-layer arrangement (drums/chords/bass/melody); audience members influence it live from their phones over a WebSocket bridge; a MIDI controller can drive it too.

## Commands

- `npm install` — install deps (one-time)
- `npm run dev` / `npm start` — run the server (Express + Vite middleware mode, HMR works)
- `npm run build` — production build to `dist/`
- `npm run preview` — preview the production build

**Server listens on port 3000, not Vite's default 5173** (`server.js` wraps Vite in middleware mode). Override with `PORT=3001 npm run dev`.

- Operator dashboard: `http://localhost:3000/`
- Audience phone UI: `http://localhost:3000/audience.html`

## Architecture

- `server.js` — Express + `ws` server. Serves the app (Vite middleware in dev, static `dist/` in prod), hosts the WebSocket bridge at `/ws?role=operator` and `/ws?role=audience`, and exposes `GET /api/network-info` (LAN IP for the dashboard's QR code) and `GET /api/sample-dates` (sample file creation times, used to order renamed samples newest-first). Server changes need a restart; there's no HMR for `server.js`.
- `src/state.js` — single shared state object (tempo, gain, per-layer effects/transpose/octave, pad bank assignments, etc.). Dashboard writes to it, the generative engine reads from it.
- `src/patterns/generative.js` — the generative arrangement engine (random chords/melody/bassline, scales, density).
- `src/ws/protocol.js` — shared WS message/action definitions, imported by both server and browser code (no Node- or DOM-specific APIs allowed here). `RATE_LIMIT_MS = 5000` governs audience action throttling.
- `src/midi/midi.js` — Web MIDI integration. `CC_MAP` / `PAD_MAP` at the top map hardware CC/note numbers to dashboard parameters — hot-reloads on edit, no restart needed.
- `src/samples/` — catalog loading, recorder, pitch-shifting, and the in-browser sample editor for audience recordings. Default recorder names look like `audience_lead_1789044106422` (`isDefaultSampleName()` in `catalog.js`); only renamed samples are auto-assigned to pads.
- `src/pads/chordPads.js` — pure logic for pad banks 3-4 (current chord → 14 pad notes, melody instrument pool). Pad banks: 1-2 recorded one-shots (auto-filled at startup with the 30 newest renamed samples), 3 chord notes on an instrument, 4 chord notes on a pitch-shifted recorded sample. Pad 15 in banks 3-4 changes the instrument/sample; pad 16 always switches bank. `triggerPad()` in `dashboard.js` is the single entry point for MIDI, on-screen, and audience pad presses.
- `src/soundfonts/` — built-in instrument fallbacks used when a sample slot is empty.
- `dashboard.js` / `index.html` / `style.css` — operator UI. Playback runs on the `<strudel-editor>` element's repl, not `globalRepl` from `initStrudel` (whose scheduler idles at the default 0.5 cps). Read the live clock via `activeScheduler()`.
- `audience.js` / `audience.html` / `audience.css` — audience phone UI (4 rate-limited buttons: more energy, calmer, new chords, weird).
- `strudel code/` — original REPL-era scripts, kept as reference only (not imported by the app).
- `planning notes.txt`, `General Idea.txt` — design/roadmap notes, not code.

## Testing changes

Web Audio requires a user gesture, so verifying playback means clicking "Start" in a real (or driven) browser — there's no headless/unit test path for the audio engine. When checking a change:

- Use the browser tool to click through the dashboard, watch the console for `[MIDI]`/`[QR]`/WS errors, and confirm `src/state.js` values update as expected.
- To exercise the audience bridge without a phone, open a second tab at `/audience.html` alongside the operator dashboard — both talk over the same WebSocket server.
- A second `node server.js` on another port conflicts with the first one's Vite HMR port (24678), and its pages reload in a loop. To test alongside the user's running server, run standalone `npx vite` on another port, with a config that proxies `/api` and `/ws` to a test `server.js` instance.
- MIDI hardware and actual audio output can't be verified by an automated browser — MIDI CC/pad mapping and "does it sound right" checks need a human with the physical controller.

## Adding audience samples

Drop recordings in `public/samples/{lead,bass,chord,drum}/`, then regenerate the catalog:

```bash
npx @strudel/sampler public/samples --json > public/strudel.json
```
