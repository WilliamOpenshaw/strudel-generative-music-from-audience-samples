# Changelog

All notable changes to this project, newest first. Dates are commit dates. Early versions follow the version numbers used in commit messages; `package.json` is at `0.1.0`.

---

## 2026-10-04 — Show prep (PR #2)

### Added
- **Host Messages page** (`host.html`): plays numbered recordings from `public/host-messages/` in order from the MIDI pads, for the top of the show. Any pad plays the next message when nothing is playing. Pad 16 (skip) and pad 13 (back) work at any time. Shows "Now playing" and "Next up" with file names, and has on-screen buttons as a backup. While started it takes over the MIDI pads, so the dashboard ignores them; knobs keep working.
- **Lines and Effects recording types:** a new take goes straight onto pad 1 of the Lines or Effects bank, and the other pads move down one. On startup, each bank fills with its own type first.
- **🗣️ Regenerate all (Lines)** and **💥 Regenerate all (Effects)** buttons, which use recordings from those pad banks as track instruments.
- **🗑️ Delete** in Edit Sample, with a confirmation. It removes the recording from pads and resets any track using it.
- **Audience switches** on the dashboard: "Audience controls" (everything on or off) and "Music controls" (only the music-changing buttons). The server enforces them, and phones hide pages that are switched off or show a "paused" message.
- **Separate volumes** for the generated music, MIDI/on-screen pads, and audience pads.
- **Named pad banks** (Lines, Effects, Notes, Sample Notes) that can be turned on and off, so pad 16 skips banks that are off. The choice is remembered in the browser.
- **Pad 14 in Notes / Sample Notes picks the chord:** Auto (follow the music), then each chord in the current key.
- **🎙️ Regenerate all (recordings)** and **🎹 Regenerate all (built-in)** buttons. Regenerate all also picks a random time signature.
- **Phone page:** a green/red tint shows when that phone can press again, and a message shows while it reconnects.
- **`removed instruments.txt`:** the instruments taken out of the dropdowns, and why.

### Changed
- **Random densities:** the regenerate buttons pick melody and bass densities from 4, 8 and 16, and drums from 4 and 8. The manual density buttons still allow any value up to 128.
- **Faster instruments only:** removed 117 built-in instruments that were silent or took over 1.5 s to start. Most download their samples from GitHub on first use. The Notes bank default is now Electric Piano 1 instead of GM Piano.
- **Compact pad display:** the Sample Pad Assignments header is now one row, and the pop-out window fits all 16 pads to any screen size without scrolling.
- **Phone page tidy-up:** pad 16 (bank switching) is removed, empty pads are disabled, and the footer shows the real 5 s limit.
- **Lock buttons replaced:** the four per-action lock buttons (and an older, unconnected lock panel) are gone, in favour of the two audience switches.

### Fixed
- **Sample editor rename:** renaming now updates pads and track instruments; before, they kept pointing at the old file name.
- **Sample editor browsing:** rapid arrow clicks no longer leave the editor showing one sample while acting on another, and the dropdown always matches the loaded file.
- **Sample editor errors:** a taken name shows "Name taken!", and an out-of-date server gets a "restart the server" message.
- **Security:** the sample endpoints (reachable from the venue Wi-Fi) only accept plain file names inside the samples folder. Uploads only accept known recording types.
- **Rename overwrite:** renaming a recording to a name that's already taken no longer overwrites the other recording.
- **Stale catalog entries:** entries for files that no longer exist are cleaned up automatically.
- **Pads after Apply & Save:** pads now play the edited audio instead of a cached copy.
- **Rate limit on busy Wi-Fi:** the server allows half a second of network delay, so on-time phone presses aren't silently dropped.

---

## 2026-10-01 — Pad banks, pad display and playback fixes (PR #1 and "recent changes")

### Added
- **Four pad banks:** two banks of recorded one-shots, auto-filled with the newest renamed recordings, plus two chord-note banks. Notes plays the current chord on an instrument; Sample Notes plays it on a pitch-shifted recording. The pads follow the chord that is audible right now, including at different speeds.
- **Pad display pop-out** (`pads.html`): a read-only mirror of the Sample Pad Assignments tab for a second screen. Phones and late-opened windows get the current pad layout immediately.
- **Sample file dates endpoint:** `GET /api/sample-dates`, so "newest" works across renames.

### Changed
- **Random densities:** limited to powers of two, so tracks stay in time with each other.
- **MIDI device count:** the badge counts only connected devices, updates on plug and unplug, and lists their names on hover.
- **README fixes:** the port is 3000, not 5173, and the audience rate limit is 5 s.

### Fixed
- **Duplicate quarter-speed playback:** the whole arrangement also played a second time at quarter speed. The generated code's `.play()` started it on Strudel's idle global player as well.
- **Silent recordings in tracks:** recordings set as a track instrument never played. They were only registered with one of the page's two audio engines.

---

## 2026-08-22 – 2026-09-19 — Dashboard expansion (v0.1.x)

- **Recording in the dashboard:** a Sample Recording panel saves microphone recordings straight into `public/samples`, with a sample editor for trim, fades, ADSR, pitch analysis and tuning to C, and renaming.
- **Pad banks for one-shots:** two banks of 15 assignable one-shot pads, with pad 16 switching banks on screen and on MIDI.
- **Phone pad labels:** audience phones show each pad's sample name, plus an info bar with feedback on actions and cooldowns.
- **Regenerate all randomizes more:** instruments, chord style, progression length, scale/mode and note density. 🎙️ buttons pick a random recording for a track.
- **Track pitch replaces global transpose:** per-track Pitch controls (step and octave) replaced the global transpose.
- **Renames update live:** renaming a recording updates instrument and pad assignments without a refresh.
- **General MIDI soundfonts and a reworked MIDI mapping:** see `midi-controls-mapping.txt`. The Audience Portal tab projects the Wi-Fi details and the join QR code.

## 2026-07-11 — v0.1.1
- **Audience phone page** (`audience.html`): rate-limited buttons for the audience, connected through the server's WebSocket bridge (roadmap phase 6).
- **Chord changes:** reworked chord generation.

## 2026-07-05 — v0.1.0
- **Drums working:** the drum layer works in the generated arrangement.

## 2026-07-01 — v0.0.13 – v0.0.17
- **Foundation (phases 1–2):** a Vite dashboard, shared state (`src/state.js`) and the generative engine (`src/patterns/generative.js`).
- **Audience sample catalog (phase 3):** `public/strudel.json`, plus the first MIDI module.
- **MIDI controller support (phase 4):** for the M-VAVE SMC-PAD.
- **Live code editor and piano roll (phase 5):** the embedded Strudel editor.

## 2026-06-23 – 2026-06-24 — Initial commits
- **Project start:** early composition scripts, design notes, and the Strudel reference docs in `docs/`.
