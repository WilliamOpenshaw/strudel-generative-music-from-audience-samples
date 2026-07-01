# strudel-generative-music-from-audience-samples

An interactive, algorithmic music generator built with Strudel. Uses generative JavaScript functions and audience-submitted samples to build dynamic chords, melodies, basslines, and beats for live interactive performances.

## Quick start

```bash
npm install
npm run dev
```

Open the local URL (usually `http://localhost:5173`), click **Start**, then adjust gain, speed, and CPM.

## Project layout

| Path | Purpose |
|------|---------|
| `dashboard.js` | Operator dashboard — controls + Strudel transport |
| `src/state.js` | Shared performance state (dashboard ↔ patterns) |
| `src/patterns/generative.js` | Port target for `strudel code/generative v0.0.12.js` |
| `strudel code/` | Original REPL-oriented generative scripts |
| `planning notes.txt` | Architecture notes + ordered feature roadmap |
| `General Idea.txt` | Project vision |

## Roadmap

The full build order (20 features across 6 phases) and npm packages to add at each stage are in **`planning notes.txt`** at the bottom of the file.

High-level phases:

1. Foundation — Vite + dashboard + shared state
2. Generative engine — port v0.0.12 arrangement
3. Audience samples — load and map to lead/bass/chords
4. MIDI — two m-vave SMC-PAD controllers for improv players
5. Strudel REPL embed — pianoroll + live coding
6. Audience phone UI — ~4 buttons with guardrails

## Licensing

Strudel is [AGPLv3](https://www.gnu.org/licenses/agpl-3.0.html). If you deploy this publicly, you must make your source available under compatible terms.
