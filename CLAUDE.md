# Strudel Generative Music from Audience Samples

Browser-based generative music system for live performances, built on [Strudel](https://strudel.cc). An operator dashboard drives a four-layer arrangement (drums/chords/bass/melody). Audience members influence it live from their phones over a WebSocket bridge and record their voices as instruments and pad sounds. Performers play MIDI pad controllers (M-VAVE SMC-PAD). There are four pages: the dashboard, the audience phone page, a read-only pad display, and a Host Messages page. User-facing docs are in `README.md`; change history is in `CHANGELOG.md`.

## Commands

- `npm install` — install deps (one-time)
- `npm run dev` / `npm start` — run the server (Express + Vite middleware mode, HMR works)
- `npm run build` — production build to `dist/`
- `npm run preview` — preview the production build

**Server listens on port 3000, not Vite's default 5173** (`server.js` wraps Vite in middleware mode). Override with `PORT=3001 npm run dev`.

- Operator dashboard: `http://localhost:3000/`
- Audience phone UI: `http://localhost:3000/audience.html`
- Pad display (second screen): `http://localhost:3000/pads.html`
- Host Messages (recorded announcements on the MIDI pads): `http://localhost:3000/host.html`

## Architecture

- `server.js` — Express + `ws` server. Serves the app (Vite middleware in dev, static `dist/` in prod), hosts the WebSocket bridge at `/ws?role=operator`, `/ws?role=audience`, and `/ws?role=display` (read-only pad screens; not counted as audience). It caches the last `SYNC_PADS` so late joiners get the current pad layout. It also exposes `GET /api/network-info` (LAN IP for the dashboard's QR code), `GET /api/sample-dates` (sample file creation times, used to order renamed samples newest-first), `GET /api/host-messages`, and the sample endpoints described under `src/samples/`. Server changes need a restart; there's no HMR for `server.js`.
- `src/state.js` — single shared state object (tempo, gain, per-layer effects/transpose/octave, pad bank assignments, etc.). Dashboard writes to it, the generative engine reads from it.
- `src/patterns/generative.js` — the generative arrangement engine (random chords/melody/bassline, scales, density).
- `src/ws/protocol.js` — shared WS message/action definitions, imported by both server and browser code (no Node- or DOM-specific APIs allowed here). `RATE_LIMIT_MS = 5000` governs audience action throttling. Audience access is two operator switches, `{ all, music }` (`isActionAllowed()`: music = every non-pad action). The server owns this state (`SET_ACCESS` in, `ACCESS_UPDATE` out to phones and dashboards) and enforces it, and phones hide switched-off pages.
- `src/midi/midi.js` — Web MIDI integration. `CC_MAP` / `PAD_MAP` at the top map hardware CC/note numbers to dashboard parameters — hot-reloads on edit, no restart needed.
- `src/samples/` — catalog loading, recorder, pitch-shifting, and the in-browser sample editor for audience recordings. `layers.js` is the single list of recording types (`audience_lead|bass|chord|drum|lines|effects`), shared by server and browser; add a type there, never as a hardcoded list. Lines/Effects recordings map to pad banks 1/2 (`LAYER_PAD_BANKS`) and are pushed onto pad 1 when recorded. Default recorder names look like `audience_lead_1789044106422` (`isDefaultSampleName()` in `catalog.js`); only renamed samples are auto-assigned to pads at startup. Server sample endpoints (`/upload-sample`, `/replace-sample`, `/rename-sample`, `/delete-sample`) are reachable from the venue Wi-Fi, so request filenames go through `isSafeSampleFilename()` and layers must be in `SAMPLE_LAYER_KEYS`.
- `src/pads/chordPads.js` — pure logic for pad banks 3-4 (current chord → 13 pad notes, melody instrument pool, pad-14 chord choice: `state.notePadChord`, null = Auto/follow the music, otherwise a chord from the current key's `chordPool`). Pad banks (`PAD_BANK_NAMES` in `dashboard.js`): 1 Lines and 2 Effects (recorded one-shots, auto-filled at startup with the 30 newest renamed samples), 3 Notes (chord notes on an instrument), 4 Sample Notes (chord notes on a pitch-shifted recorded sample). Pad 14 in banks 3-4 steps the chord (Auto → key's chords → Auto), pad 15 changes the instrument/sample; pad 16 switches to the next bank in `state.enabledPadBanks` (operator-toggleable, at least one on, persisted in localStorage). `triggerPad(pad, source)` in `dashboard.js` is the single entry point for MIDI, on-screen, and audience pad presses; `source` ('performer' | 'audience') picks the volume (`state.performerPadGain` / `state.audiencePadGain`). `state.gain` is the generated music's volume only.
- `src/soundfonts/` — built-in instrument fallbacks used when a sample slot is empty. `strudel-instruments.js` only feeds the track dropdowns. Its melodic lists were trimmed to instruments that make sound within ~1.5 s of first use, measured by playing each on the lead track and metering the output. Many sampled instruments download from GitHub on first play and were slow or silent; drum kits weren't tested yet.
- `dashboard.js` / `index.html` / `style.css` — operator UI. Playback runs on the `<strudel-editor>` element's repl, not `globalRepl` from `initStrudel` (whose scheduler idles at the default 0.5 cps). Read the live clock via `activeScheduler()`. The editor's package bundles its **own copy of the audio engine with a separate sound registry**, so a sound registered only through `@strudel/web` (e.g. `samples()` imported from it) is "not found" in tracks. Register local recordings via `registerAudienceSamples()` in `src/samples/register.js`, which loads them into both engines.
- `pads.html` / `pads.js` — read-only mirror of the Sample Pad Assignments tab for a second window/screen, fed by `SYNC_PADS` over `role=display`. Every page instance runs its own engine, so additional *dashboard* windows don't mirror each other; separate views must go through the WebSocket bridge like this. Grid rendering is shared via `src/pads/padGrid.js`.
- `host.html` / `host.js` — Host Messages page: plays `public/host-messages/*` in filename-number order (listed by `GET /api/host-messages`, served from the folder by `/host-messages/`). Any pad plays the next message only when idle; pad 13 = stop and play the previous one, pad 16 = stop and play the next one. While started it claims the MIDI pads via `src/midi/hostClaim.js` (BroadcastChannel heartbeat; lapses about 3 s after the window disappears), and `midi.js` then ignores note-ons, while knobs still work.
- `audience.js` / `audience.html` / `audience.css` — audience phone UI: pages of rate-limited music-control buttons, then pad pages (pads 1-15; pad 16 is performer-only).
- `strudel code/`, `compositions/` — original REPL-era scripts, kept as reference only (not imported by the app).
- `docs/` — Strudel reference notes (functions, sounds, theory); useful when writing pattern code.
- `planning notes.txt`, `design notes.txt`, `General Idea.txt` — design/roadmap notes, not code.

## Testing changes

Web Audio requires a user gesture, so verifying playback means clicking "Start" in a real (or driven) browser — there's no headless/unit test path for the audio engine. When checking a change:

- Use the browser tool to click through the dashboard, watch the console for `[MIDI]`/`[QR]`/WS errors, and confirm `src/state.js` values update as expected.
- To exercise the audience bridge without a phone, open a second tab at `/audience.html` alongside the operator dashboard — both talk over the same WebSocket server.
- A second `node server.js` on another port conflicts with the first one's Vite HMR port (24678), and its pages reload in a loop. To test alongside the user's running server, run standalone `npx vite` on another port, with a config that proxies `/api`, `/ws`, and the sample endpoints (`/upload-sample`, `/replace-sample`, `/rename-sample`, `/delete-sample`) to a test `server.js` instance. Both servers share `public/samples`, so test recordings land in the user's real library: snapshot it first and delete test takes afterwards.
- MIDI hardware and actual audio output can't be verified by an automated browser — MIDI CC/pad mapping and "does it sound right" checks need a human with the physical controller. The Claude Code browser pane denies Web MIDI, so drive pads through the on-screen pads/buttons, which share the MIDI code path (`triggerPad()`, and `handlePad()` in `host.js`).
- To check that something actually makes sound without blasting the speakers, patch `AudioNode.prototype.connect` before Start, so anything connected to `ctx.destination` goes into an `AnalyserNode` followed by a zero gain, then read the peak level. Start from silence: notes already scheduled ahead keep sounding briefly after a change.
- Don't leave a dashboard open in the browser pane against the user's server: it joins as a second operator and its pad layout overwrites what phones and the pad display show. Point the pane at `pads.html` (read-only) instead.

## Audience recordings and the catalog

Recordings are flat files in `public/samples/` (the `lead/bass/chord/drum` subfolders are legacy and unused). `public/strudel.json` is maintained by `server.js` (`syncStrudelCatalog()`): one array per recording type from `layers.js`, plus a sound-name entry per file. A file only shows up in the app if it's in one of those arrays, which the upload endpoint does. **Never regenerate the catalog with `npx @strudel/sampler`**: it drops the per-type arrays (so Lines/Effects categories are lost). The user commits recordings and the catalog to git.

## Docs to keep in sync

- `README.md`: the user guide (written for a non-developer).
- `CHANGELOG.md`: add an entry for every user-visible change.
- `midi-controls-mapping.txt`: the MIDI mapping.
- `audience sampling instructions.txt`: the recording guide.
- `removed instruments.txt`: why instruments were taken out of the dropdowns.

`planning notes.txt`, `design notes.txt`, `General Idea.txt`, `cursor_piano_roll_dashboard_issue.md` and the time-signature note are historical; leave them as they are.

## Known quirks

- In `PAD_MAP` (`src/midi/midi.js`), note-bank-1 pads 14–16 send `pitch:*` actions that `handleAction()` no longer handles, so they do nothing; global transpose was removed in favour of per-track pitch. Encoder CC 4 and the Left/Right buttons (CC 25/26) are unmapped.
- The dashboard tab hint says "Ctrl+1 / Ctrl+2", but Ctrl+3 (Audience Portal) works too.
- `.claude/launch.json` starts `npm run dev` on port 3000 for Claude Code's browser preview. If the user's own server already holds the port, attach to it rather than starting a second one.
