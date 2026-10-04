# Strudel Generative Music from Audience Samples

An interactive, algorithmic music generator built with [Strudel](https://strudel.cc) for live performances. It generates chords, melodies, basslines and beats, and lets the audience shape the music from their phones and record their own voices as instruments and pad sounds. Performers play along on MIDI pad controllers (M-VAVE SMC-PAD).

The project runs as a small local web server with four pages:

| Page | Address | Who uses it |
|------|---------|-------------|
| **Dashboard** | `http://localhost:3000/` | The operator: music, recordings, pads, audience settings |
| **Audience page** | `http://<your-ip>:3000/audience.html` | Audience phones, over the venue Wi-Fi |
| **Pad display** | `http://localhost:3000/pads.html` | A read-only view of the pads for a second screen |
| **Host Messages** | `http://localhost:3000/host.html` | Plays recorded host announcements from the MIDI pads |

See [CHANGELOG.md](CHANGELOG.md) for what has changed and when.

---

## Prerequisites

Before you can run this project, you need **Node.js** installed on your computer. Node.js includes `npm` (Node Package Manager), which is used to install the project's dependencies and run it locally.

### Installing Node.js (if you don't have it)

1. Go to [https://nodejs.org](https://nodejs.org)
2. Download the **LTS** (Long Term Support) version — this is the most stable
3. Run the installer and follow the prompts (the defaults are fine)
4. To verify it installed correctly, open a terminal and type:
   ```
   node --version
   npm --version
   ```
   Both should print a version number (e.g. `v20.x.x` and `10.x.x`).

> **What is a terminal?**
> - **Windows**: Press `Win + R`, type `cmd`, and hit Enter. Or search for "PowerShell" in the Start menu. If you're using VS Code, press `` Ctrl + ` `` to open the built-in terminal.
> - **Mac**: Open the "Terminal" app (search for it in Spotlight with `Cmd + Space`).

Use **Chrome** or **Edge**. They support Web MIDI and have the most reliable Web Audio.

---

## Getting Started (First-Time Setup)

These steps only need to be done **once** when you first clone or download the project.

### Step 1: Open the project folder in your terminal

Navigate to the folder where this project lives. For example, if you cloned it to your Documents folder:

```bash
cd C:\Users\YourName\Documents\GitHub\strudel-generative-music-from-audience-samples
```

> **Tip**: In VS Code, you can open the folder with `File > Open Folder`, then open the integrated terminal with `` Ctrl + ` ``.

### Step 2: Install dependencies

Run this command inside the project folder:

```bash
npm install
```

This reads the `package.json` file and downloads everything the project needs (Strudel, Vite, etc.) into a `node_modules` folder. It may take a minute or two on the first run.

> **You only need to run `npm install` once**, unless you delete the `node_modules` folder or the project's dependencies change.

---

## Running the Dashboard

Every time you want to use the dashboard, run this command from the project folder:

```bash
npm run dev
```

You should see output like this:

```
  Strudel Dashboard server running at:
    ➜  Operator:  http://localhost:3000/
    ➜  Audience:  http://localhost:3000/audience.html
    ➜  Mode:      development
```

Then open **http://localhost:3000** in Chrome or Edge.

> **Important**:
> - Keep the terminal window open while you're using the dashboard. Closing it shuts down the server.
> - Run only **one** copy of the server. A second copy fails with "port already in use" (see Troubleshooting).
> - Open only **one dashboard window**. Each dashboard window runs its own music engine. Use the pad display and Host Messages pages for other screens.
> - After changes to `server.js`, restart the server (Ctrl + C, then `npm run dev`). Changes to the pages only need a browser refresh.

---

## Show-Day Checklist

1. Start the server with `npm run dev`, and open the dashboard in **one** Chrome/Edge window. If the MIDI badge says "Access Denied", click the lock icon in the address bar, allow MIDI, and reload.
2. **Open the dashboard a few minutes early and press ▶ Start once**, so instruments and samples have downloaded before the show.
3. **Top of the show:** open **🎙️ Host Messages ↗**, press **▶ Start**, and play the announcements from the pads. Press **■ Stop** afterwards, so the pads go back to the dashboard.
4. **Second screen:** in the **🎹 Sample Pad Assignments** tab, click **↗ Open in Separate Window**, drag it to the other screen, and click **⛶ Fullscreen**.
5. **Audience:** project the **📡 Audience Portal & Wi-Fi** tab, which shows the Wi-Fi details and a QR code to join. Use the **Audience controls** and **Music controls** switches to pause the audience whenever you need to.
6. In **Pad Banks**, untick any banks you don't want pad 16 to cycle through.

---

## Using the Dashboard

### Tabs

| Tab | Shortcut | What's on it |
|-----|----------|-------------|
| **🎛️ Performance Dashboard** | Ctrl + 1 | All the music, recording and pad controls |
| **🎹 Sample Pad Assignments** | Ctrl + 2 | Large view of the 16 pads in the active bank, clickable (also available as a pop-out) |
| **📡 Audience Portal & Wi-Fi** | Ctrl + 3 | A projector page with the Wi-Fi name and password and a QR code for the audience page |

### Transport

| Button | What it does |
|--------|-------------|
| **▶ Start** | Starts the Strudel audio engine and plays the generative arrangement. The first start can take a few seconds while instruments load. |
| **■ Stop** | Stops all audio playback immediately. |
| **🔊 Test Tone / 🎵 Test Strudel** | Quick checks that the computer's audio and Strudel are working. |

> **Note**: Browsers only allow audio after a click, which is why you must click Start. Audio can't auto-play.

### Volume and Tempo

| Slider | Range | What it controls |
|--------|-------|-----------------|
| **Music** | 0.00 – 1.00 | Volume of the generated music (all four tracks). Default 0.80. |
| **MIDI pads** | 0.00 – 1.00 | Volume of pads you play yourself, on the MIDI controller or by clicking pads on screen, in every bank. Default 1.00. |
| **Audience pads** | 0.00 – 1.00 | Volume of pads played from audience phones, in every bank. 0 mutes them. Default 1.00. |
| **Speed** | 0.25 – 2.00 | Playback speed multiplier. 1.00 = normal. |
| **CPM** | 60 – 180 | Cycles per minute: the tempo. Default 120. |
| **Time Sig** | 2/4 … 12/8 | Time signature. Changing it regenerates the arrangement. |

Moving Music, Speed or CPM updates the music straight away (the pattern restarts with the new value). The pad volumes apply to the next pad press, without restarting anything.

### Layer Toggles

Four buttons mute or unmute each track: **Drums**, **Chords**, **Bass** and **Melody** (lead). The key and scale are chosen in Generative Settings and change when you Regenerate all.

### Regenerate Buttons

These re-roll the random musical content **without stopping playback**:

| Button | What it does |
|--------|-------------|
| **↻ Regenerate all** | Re-rolls everything: chords, melody, bass, drums, instruments (any, built-in or recorded), time signature, scale, chord style and densities |
| **🎙️ Regenerate all (recordings)** | Same, but chords, melody and bass each get a different renamed recording (default-named takes are skipped), and drums get a built-in kit |
| **🎹 Regenerate all (built-in)** | Same, but every track gets a built-in instrument, with no recordings |
| **🗣️ Regenerate all (Lines)** | Same, but chords, melody and bass use recordings from the **Lines** pad bank; drums get a built-in kit |
| **💥 Regenerate all (Effects)** | Same, but **all four tracks, drums included,** use recordings from the **Effects** pad bank (vocal sound effects double as percussion) |
| **New chords** | Only re-rolls the chord progression |
| **New melody** | Only re-rolls the lead melody (and its octave range and density) |
| **New bass** | Only re-rolls the bassline (and its octave range and density) |
| **New drums** | Only re-rolls the drum pattern (and its density) |

Whenever a regenerate button picks a random density, melody and bass get 4, 8 or 16, and drums get 4 or 8. These keep the tracks in time with each other.

### Generative Settings

- **Chord style:** Sustained / Pad, Arp Up, Arp Pendulum, or Rhythmic Stabs.
- **Progression length:** 4 or 6 chords, or random.
- **Scale / mode:** Minor, Major, Dorian or Mixolydian. This sets the chords available, and the chords Pad 14 can pick in the Notes banks.
- **Octave range** (melody and bass): 1, 3 or 5 octaves of notes to choose from.
- **Note density** (melody, bass, drums): ÷2, −, +, ×2. Density is how many notes fit in each two-bar loop, up to 128. Powers of two (4, 8, 16, 32…) stay on the beat.

### Track Pitch

Each track has its own **STEP − / +** (moves the track 2 semitones) and **OCT − / +** (moves it an octave), plus **↺** to reset. There's no longer a global transpose.

### Per-Track Gains and Effects

Each track has a volume slider, plus pan, delay, low-pass and high-pass filters, room (reverb), distortion, and attack / decay / sustain / release. The reset buttons put a track's effects back to their defaults.

### Instruments

Each track has an instrument dropdown:
- **🎲** picks a random instrument from the list, which includes built-in sounds and recordings.
- **🎙️** picks a random recording.

The built-in lists only contain instruments that start quickly. 117 instruments that were silent or slow to load were removed; see `removed instruments.txt`. The drum kit list hasn't been checked that way yet.

### Live Code Editor and Piano Roll

The right-hand panel shows the Strudel code the dashboard is playing, and a scrolling piano roll. You can edit the code and press **Ctrl + Enter** to hear your change. The next dashboard change (a slider, a regenerate button…) replaces it with freshly generated code.

### Readouts and Status

The readout panel shows the tempo, speed, which layers are on, the current chord progression, the key/scale, the last note, and each track's instrument. The status badge at the top is grey when stopped, amber while loading, green when playing, and red on an error (check the browser console with F12). The MIDI badge shows how many controllers are connected; hover over it for their names.

---

## Pad Banks

The 16 pads (on screen, on the MIDI controller and on audience phones) work in four banks. **Pad 16 always switches to the next bank.**

| Bank | Pads 1–15 | Pad 14 | Pad 15 |
|------|-----------|--------|--------|
| **Lines** | Recorded one-shots (spoken lines) | a one-shot | a one-shot |
| **Effects** | Recorded one-shots (sound effects) | a one-shot | a one-shot |
| **Notes** | Pads 1–13 play the notes of the current chord, low to high, on a melody instrument | Picks the chord | Random melody instrument |
| **Sample Notes** | Pads 1–13 play the same chord notes on a recording, pitched and sped up or slowed down | Picks the chord | Next recording |

- **Lines and Effects on startup:** each bank fills with the newest renamed recordings of its own type, and any space left is filled with other renamed recordings. Default-named takes (like `audience_lines_1791023326331`) are skipped as likely failed attempts. You can reassign any pad from the dropdowns in the dashboard's pad panel.
- **New recordings:** recording as **Lines** or **Effects** puts the take straight onto pad 1 of that bank. The others move down one, and pad 15's drops off. Rename a take to keep it after a reload.
- **Pad 14 (chord):** each press steps through **Auto** (follow the chord the music is playing) and then each chord in the current key. A chosen chord shows as "(chosen)" in the bank title. Both Notes banks share the choice.
- **Turning banks on and off:** untick a bank's checkbox in the pad panel and pad 16 skips it. At least one bank always stays on. The choice is remembered in that browser.
- **Volume:** set with the **MIDI pads** and **Audience pads** sliders.

---

## Recording Audience Samples

In the **Sample Recording** panel, pick what you're recording, then press **🔴 Record** and **⏹ Stop**. The browser asks for microphone permission the first time.

| Type | Use it for | Where it goes |
|------|-----------|---------------|
| **Lead / Bass / Chords / Drums** | Sounds meant for a track's instrument | Available as an instrument for any track |
| **Lines** | Spoken lines from the audience | Straight onto pad 1 of the **Lines** pad bank |
| **Effects** | Verbal sound effects from the audience | Straight onto pad 1 of the **Effects** pad bank |

The new recording opens in **Edit Sample**, where you can:
- **◀ / ▶** browse all recordings, or pick one from the list.
- **Trim** the start and end, add fades, shape it with attack / decay / sustain / release, normalize it, and **tune it to C**, then **💾 Apply & Save**.
- **✏️ Rename** it. Renamed recordings are treated as "keepers": they're the ones auto-assigned to pads and used by the recordings regenerate buttons.
- **🗑️ Delete** it. This asks for confirmation and can't be undone. It removes the file, takes it off any pads (the rest close the gap), and switches any track using it back to that track's default instrument.

**Where recordings are stored:** recordings are saved as files in `public/samples/`, and the server keeps the catalog `public/strudel.json` up to date automatically. Don't edit or regenerate that catalog by hand. In particular, don't run `npx @strudel/sampler …`: it rewrites the catalog and forgets which recordings are Lines, Effects and so on. Add recordings through the dashboard. More detail is in `audience sampling instructions.txt`.

---

## MIDI Control

The dashboard detects connected Web MIDI controllers (like the M-VAVE SMC-PAD) automatically. The **Last MIDI** line under the header shows what each pad or knob press did.

Default mapping (full details in `midi-controls-mapping.txt`):

| Control | What it does |
|---------|-------------|
| Pads, notes 21–36 | Pads 1–16 of the active pad bank (pad 16 switches bank) |
| Pads, notes 1–13 | Mute tracks, random instruments, regenerate (see the mapping file) |
| Knobs CC 1–3 | Music volume, speed, tempo |
| Knobs CC 5–8 | Drums / chords / bass / melody volume |
| Knobs CC 9–16 | Reverb and low-pass filter per track |
| Buttons CC 27 / 28 / 29 | Start / stop / record |

**Customizing:** twist a knob and watch the browser console (F12) for `[MIDI] Unmapped CC: …`, or press a pad and read the **Last MIDI** line. Then edit `CC_MAP` / `PAD_MAP` at the top of `src/midi/midi.js`. The page updates instantly.

While the **Host Messages** page is started, it takes over the pads. The dashboard then ignores pad presses (its MIDI badge shows "pads → Host Messages"), but the knobs keep working.

---

## Audience Phone Page

Audience members connect from their phones and influence the music live.

### How to Connect the Audience
1. **Wi-Fi:** phones must be on the **same Wi-Fi network** as the computer running the server.
2. **Project the Audience Portal tab** (Ctrl + 3). Enter the Wi-Fi name and password once; they're remembered in that browser. The QR code switches between "join the Wi-Fi" and "open the audience page".
3. **Or share the link directly:** `http://<your-ip>:3000/audience.html`, for example `http://192.168.1.50:3000/audience.html`. The dashboard finds your IP for you (via `/api/network-info`).

For people outside the venue network, you'd need to host the project publicly or use a tunnel such as ngrok.

### What the Audience Can Do
The phone page has pages of buttons:
- **Music controls** (the first pages) change the generated music: more energy / calmer, new chords, a random change ("Weird"), faster / slower, octave up / down, new melody / bass / drums, regenerate all, and delay / reverb up / down.
- **Pads** (the last pages) play pads 1–15 of the dashboard's active bank, at the **Audience pads** volume. Empty pads are greyed out.

Each phone can act once every **5 seconds**: the button panel tints red while it waits and green when it's ready.

### Operator Guardrails
The **Audience Control** panel at the top of the dashboard shows how many phones are connected and the latest audience action, and has two switches:
- **Audience controls:** turns every audience control on or off. When it's off, phones show a "paused" message.
- **Music controls:** turns off just the buttons that change the generated music. Phones then show only the pads.

The server enforces both switches, so a phone with an old page open can't get around them. The dashboard shows the current state even after a reload.

---

## Host Messages (top of the show)

A separate page plays your recorded host announcements, in order, from the MIDI pads.

1. Put the recordings in `public/host-messages/`, numbered at the start of the file name: `01 welcome.mp3`, `02 phones out.wav`, ... (10 comes after 9; unnumbered files play last).
2. Open the page from the dashboard's **🎙️ Host Messages ↗** link (or `http://localhost:3000/host.html`) and press **▶ Start**.

| Control | What it does |
|---------|-------------|
| **Any pad** (or ▶ Play next) | Plays the next message, but only when nothing is playing. While a message plays, these pads do nothing. |
| **Pad 16** (or Skip ▶▶) | Works any time: stops the current message and plays the next one. |
| **Pad 13** (or ◀ Back) | Works any time: stops the current message and plays the previous one (to replay a message, press 13 then 16). |
| **↺ Back to #1** / clicking a message in the list | Sets which message is "next up", without playing it. |

The page shows the number and file name of the message playing now and of the one up next, and has its own volume slider. A file that can't be played is marked ⚠️ and skipped.

While the Host Messages page is started, it **takes over the MIDI pads**: the dashboard ignores pad presses, so a pad doesn't also trigger a dashboard sound. The controller's knobs keep working on the dashboard. Press **■ Stop** to hand the pads back. If the window is closed without Stop, the dashboard takes them back within a few seconds. Both pages must be open in the same browser.

After adding or renaming message files, press Stop and then Start to reload them.

---

## Pad Display on a Second Screen

You can show the **Sample Pad Assignments** view in its own window, for example on a second monitor or a projector, while you keep controlling the dashboard on your main screen.

1. In the dashboard, open the **🎹 Sample Pad Assignments** tab and click **↗ Open in Separate Window**. Or open `http://localhost:3000/pads.html` directly.
2. Drag that window to the other screen and click **⛶ Fullscreen**.

The pad display is a live, read-only mirror of the dashboard. It updates when you switch banks, reassign pads, change the Notes instrument or Sample Notes sample, or when the playing chord changes. It always fits all 16 pads to the window, with no scrolling. It makes no sound itself, so audio always comes from the dashboard window.

---

## Stopping the Server

When you're done, go back to the terminal where `npm run dev` is running and press **Ctrl + C**.

---

## Troubleshooting

### No sound after clicking Start
- Make sure your system volume is up and the browser tab isn't muted.
- Use **Chrome** or **Edge**, and try **🔊 Test Tone**.
- Check the browser console for errors: press **F12** → **Console**.

### A track goes silent after choosing an instrument
- Some built-in sounds download on first use. Give them a moment, or pick another. The slowest and silent ones have already been removed (see `removed instruments.txt`).
- If a **recording** is silent on a track, refresh the dashboard so the recordings are reloaded.

### "MIDI: Access Denied"
Click the lock icon in the address bar, allow MIDI for `localhost:3000`, and reload.

### `npm run dev` says the port is already in use (EADDRINUSE)
Another copy of the server is still running, for example in another terminal or from a closed editor tab. Stop it there with Ctrl + C, or, in PowerShell:

```powershell
Stop-Process -Id (Get-NetTCPConnection -LocalPort 3000).OwningProcess -Force
```

You can also run on a different port: `$env:PORT=3001; npm run dev` (PowerShell) or `PORT=3001 npm run dev` (macOS/Linux). See `Process_Instructions.txt` for more ways to find stuck servers.

### Delete, rename or Host Messages say the server is out of date
The server was started before the latest code changes. Restart it (Ctrl + C, then `npm run dev`).

### `npm install` fails
- Make sure Node.js is installed (see Prerequisites) and you're inside the project folder (the one with `package.json`).
- Delete `node_modules` and `package-lock.json`, then run `npm install` again. In PowerShell:
  ```powershell
  Remove-Item -Recurse -Force node_modules, package-lock.json
  npm install
  ```

### The page loads but looks broken
Hard-refresh with **Ctrl + Shift + R**, and check that the server is still running.

---

## Project Layout

| Path | Purpose |
|------|---------|
| `server.js` | Express + WebSocket server: serves the pages, the audience/operator bridge, and endpoints for recordings and host messages |
| `index.html`, `dashboard.js`, `style.css` | The operator dashboard |
| `audience.html`, `audience.js`, `audience.css` | The audience phone page |
| `pads.html`, `pads.js` | The pad display for a second screen |
| `host.html`, `host.js` | The Host Messages page |
| `src/state.js` | Shared performance state (tempo, volumes, effects, pad banks, …) |
| `src/patterns/generative.js` | The generative engine: chords, melody, bass, drums → Strudel code |
| `src/pads/` | Chord-note pad logic (`chordPads.js`) and the shared pad grid (`padGrid.js`) |
| `src/samples/` | Recording, sample editor, pitch detection, catalog, recording types (`layers.js`) and engine registration |
| `src/midi/` | MIDI mapping (`midi.js`) and the Host Messages pad hand-over (`hostClaim.js`) |
| `src/ws/` | The WebSocket message protocol and the dashboard's connection |
| `src/soundfonts/` | Built-in instrument lists and General MIDI soundfont setup |
| `public/samples/`, `public/strudel.json` | Audience recordings and their catalog (managed by the server) |
| `public/host-messages/` | Host announcement recordings |
| `CHANGELOG.md` | What changed and when |
| `CLAUDE.md` | Technical notes for AI coding assistants (and developers) |
| `midi-controls-mapping.txt` | Full MIDI controller mapping |
| `audience sampling instructions.txt` | Step-by-step recording guide |
| `removed instruments.txt` | Built-in instruments removed for being silent or slow |
| `list of strudel instrument samples.txt` | Every sound name Strudel knows (reference) |
| `Process_Instructions.txt` | Finding and stopping stuck dev servers |
| `docs/` | Strudel reference notes |
| `planning notes.txt`, `design notes.txt`, `General Idea.txt`, `compositions/`, `strudel code/` | Early planning notes and scripts (historical reference) |
| `.claude/launch.json` | Lets Claude Code start the dev server |
| `dist/` | Production build output (`npm run build`) |

---

## Roadmap History

The original build order (20 features across 6 phases) is in `planning notes.txt`. All six phases are complete; later work is listed in [CHANGELOG.md](CHANGELOG.md).

| Phase | Focus | Status |
|-------|-------|--------|
| 1. Foundation | Vite + dashboard + shared state | ✅ Complete |
| 2. Generative engine | Four-layer arrangement with controls | ✅ Complete |
| 3. Audience samples | Load and map recordings to lead/bass/chords | ✅ Complete |
| 4. MIDI | Two M-VAVE SMC-PAD controllers for improv players | ✅ Complete |
| 5. Strudel REPL embed | Piano roll + live coding alongside the dashboard | ✅ Complete |
| 6. Audience phone UI | Mobile buttons with guardrails | ✅ Complete |

---

## Licensing

Strudel is licensed under [AGPLv3](https://www.gnu.org/licenses/agpl-3.0.html). If you deploy this project publicly (host it on the web), you must make your source code available under compatible terms.
