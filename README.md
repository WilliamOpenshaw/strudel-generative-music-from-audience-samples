# Strudel Generative Music from Audience Samples

An interactive, algorithmic music generator built with [Strudel](https://strudel.cc). Uses generative JavaScript functions and audience-submitted samples to build dynamic chords, melodies, basslines, and beats for live interactive performances.

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

This reads the `package.json` file and downloads everything the project needs (Strudel, Vite, etc.) into a `node_modules` folder. It may take a minute or two on the first run. You'll see some progress output — wait until it finishes and you see your terminal prompt again.

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

### Step 3: Open the dashboard in your browser

Open your web browser (Chrome or Edge recommended) and go to:

```
http://localhost:3000
```

You should see the **Strudel Dashboard** — a dark-themed control panel with sliders, buttons, and readouts.

> **Important**: Keep the terminal window open while you're using the dashboard. Closing it will shut down the local server and the page will stop working.

---

## Using the Dashboard

Here's what each part of the dashboard does:

### Transport Controls

| Button | What it does |
|--------|-------------|
| **▶ Start** | Initializes the Strudel audio engine and begins playing the generative arrangement. The first click may take a few seconds while it loads audio samples from the internet. |
| **■ Stop** | Stops all audio playback immediately. |

> **Note**: Your browser requires a user gesture (clicking a button) before it will allow audio to play. This is why you must click "Start" — audio can't auto-play.

### Sliders

| Slider | Range | What it controls |
|--------|-------|-----------------|
| **Music** | 0.00 – 1.00 | Volume of the generated music (all four tracks). 0 = silent, 1 = full volume. Default is 0.80. |
| **MIDI pads** | 0.00 – 1.00 | Volume of pads you play yourself, on the MIDI controller or by clicking pads on screen, in every bank. Default is 1.00. |
| **Audience pads** | 0.00 – 1.00 | Volume of pads played from audience phones, in every bank. 0 mutes them. Default is 1.00. |
| **Speed** | 0.25 – 2.00 | Playback speed multiplier. 1.00 = normal. Lower = slower, higher = faster. |
| **CPM** | 60 – 180 | Cycles Per Minute — essentially the tempo. Higher = faster. Default is 120. |

Drag any slider and the audio updates in real time (the pattern restarts with the new value).

### Transpose

Press the **−** and **+** buttons to shift all pitched layers (chords, bass, melody) down or up by one semitone. You can also use the keyboard shortcut **Ctrl + ↑** / **Ctrl + ↓**.

### Layer Toggles

Four buttons that mute or unmute individual layers of the arrangement:

| Button | Layer | Description |
|--------|-------|-------------|
| **Drums** | Drum pattern | Kick, snare, and hi-hat loop |
| **Chords** | Chord pads | Randomly generated chord progression |
| **Bass** | Bassline | Random melodic line in C minor (low register) |
| **Melody** | Lead melody | Random melodic line in C minor (high register) |

When a layer is **on**, the button is highlighted blue. When **off**, it's dimmed. Click to toggle.

### Regenerate Buttons

These re-roll the random musical content **without stopping playback**:

| Button | What it does |
|--------|-------------|
| **↻ Regenerate all** | Re-rolls everything: chords, melody, bass, drums, instruments (any, built-in or recorded), time signature, scale, and densities |
| **🎙️ Regenerate all (recordings)** | Same, but chords, melody and bass each get a different renamed recording (default-named takes are skipped), and drums get a built-in kit |
| **🎹 Regenerate all (built-in)** | Same, but every track gets a built-in instrument, with no recordings |
| **🗣️ Regenerate all (Lines)** | Same, but chords, melody and bass use recordings from the **Lines** pad bank; drums get a built-in kit |
| **💥 Regenerate all (Effects)** | Same, but **all four tracks, drums included,** use recordings from the **Effects** pad bank (vocal sound effects double as percussion) |
| **New chords** | Only re-rolls the chord progression |
| **New melody** | Only re-rolls the lead melody |
| **New bass** | Only re-rolls the bassline |
| **New drums** | Only re-rolls the drum pattern |

Whenever a regenerate button picks a random density, melody and bass get 4, 8 or 16, and drums get 4 or 8. The manual density buttons can still set any value up to 128.

### Live Readouts

The bottom panel shows the current state of the engine, updated once per second:

- **CPM** — Current tempo
- **Speed** — Current speed multiplier
- **Layers** — Which layers are on/off
- **Current chord** — The chord symbols in the current progression
- **Last note** — The last note triggered by the engine

### Status Badge

The status indicator at the top changes color:
- **Grey** — Stopped (no audio playing)
- **Amber** — Loading (initializing the audio engine)
- **Green** — Playing (audio is active)
- **Red** — Error (something went wrong — check the browser console)

## MIDI Control

The dashboard automatically detects connected Web MIDI devices (like the M-VAVE SMC-PAD) when you open the page. A status indicator in the top right will show you how many devices are connected.

### Customizing MIDI Mapping
Since MIDI controllers send different Control Change (CC) and Note numbers, you may need to map your specific controller to the dashboard parameters.

1. Connect your controller and open the dashboard.
2. Open your browser's Developer Console (press `F12` and click **Console**).
3. Twist a knob or press a pad. You will see a log like: `[MIDI] Unmapped CC: 1 (Value: 64)` or `[MIDI] Unmapped Note On: 36`.
4. Open `src/midi/midi.js` in your code editor.
5. Update the `CC_MAP` and `PAD_MAP` objects at the top of the file using the numbers you saw in the console. The changes will hot-reload instantly.

---

## Audience Phone Dashboard

The dashboard includes a built-in realtime bridge that allows audience members to connect to the session from their mobile phones and influence the live music. 

### How to Connect the Audience
1. **Find your local network IP address:**
   The dashboard fetches this for you automatically (via `/api/network-info`) and renders a scannable QR code in the **Audience Controls** panel — no need to read it off the terminal. If you want it manually, your machine's IP will look like `192.168.1.50`.
2. **Share the link:**
   Point audience phones at the QR code, or give them the URL directly (using your actual IP address):
   `http://192.168.1.50:3000/audience.html`
   The dashboard's QR panel can also switch to a "Join Wi-Fi" QR code so phones connect to your network first.
3. **Network Requirements:**
   For this to work locally without any extra configuration, the audience members must be connected to the **same Wi-Fi network** as the host computer. If you want people on cellular data or outside the venue to connect, you will need to host the project on a public server or use a tool like Ngrok to expose your local server to the public internet.

### What the Audience Can Do
The phone page has pages of rate-limited buttons:
- **Music controls** (the first pages) change the generated music: more energy / calmer, new chords, a random change ("Weird"), faster / slower, octave up / down, new melody / bass / drums, regenerate all, and delay / reverb up / down.
- **Pads** (the last pages) play whatever is on the dashboard's active pad bank.

### Operator Guardrails
The **Audience Control** panel at the top of the dashboard shows how many phones are connected and the latest audience action, and has two switches:
- **Audience controls:** turns every audience control on or off. When it's off, phones show a "paused" message.
- **Music controls:** turns off just the buttons that change the generated music. Phones then show only the pads.

The server enforces both switches, so a phone with an old page open can't get around them. They take effect on every phone immediately, and the dashboard shows the current state even after a reload. Built-in rate limiting stops any one phone from spamming (max 1 action per 5 seconds per phone).

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

The page shows the number and file name of the message playing now and of the one up next.

While the Host Messages page is started, it **takes over the MIDI pads**: the dashboard ignores pad presses (its MIDI badge shows "pads → Host Messages"), so a pad doesn't also trigger a dashboard sound. The controller's knobs keep working on the dashboard. Press **■ Stop** to hand the pads back. If the window is closed without Stop, the dashboard takes them back within a few seconds. Both pages must be open in the same browser.

After adding or renaming message files, press Stop and then Start to reload them.

---

## Pad Display on a Second Screen

You can show the **Sample Pad Assignments** view in its own window, for example on a second monitor or a projector, while you keep controlling the dashboard on your main screen.

1. In the dashboard, open the **🎹 Sample Pad Assignments** tab and click **↗ Open in Separate Window**. Or open `http://localhost:3000/pads.html` directly.
2. Drag that window to the other screen and click **⛶ Fullscreen**.

The pad display is a live, read-only mirror of the dashboard. It updates when you switch banks, reassign pads, change the Notes instrument or Sample Notes sample, or when the playing chord changes. It makes no sound itself, so audio always comes from the dashboard window. Keep exactly one dashboard window open: each dashboard window runs its own separate music engine.

---

## Stopping the Dev Server

When you're done, go back to the terminal where `npm run dev` is running and press **Ctrl + C** to stop the server.

---

## Troubleshooting

### No sound after clicking Start
- Make sure your system volume is turned up and your browser tab isn't muted (look for a speaker icon on the browser tab).
- Try using **Chrome** or **Edge**. Firefox has less reliable Web Audio support.
- Check the browser console for errors: press **F12** → click the **Console** tab.

### `npm install` fails
- Make sure you have Node.js installed (see Prerequisites above).
- Make sure you're running the command **inside the project folder** (the folder that contains `package.json`).
- Try deleting `node_modules` and `package-lock.json`, then running `npm install` again:
  ```bash
  rm -rf node_modules package-lock.json
  npm install
  ```
  On Windows (PowerShell):
  ```powershell
  Remove-Item -Recurse -Force node_modules, package-lock.json
  npm install
  ```

### `npm run dev` shows an error
- Make sure you've run `npm install` first.
- Make sure nothing else is using port 3000. If it is, either close the other process or start the server with a different port: `PORT=3001 npm run dev` (macOS/Linux) or `$env:PORT=3001; npm run dev` (Windows PowerShell).

### The page loads but looks broken
- Hard-refresh the browser: **Ctrl + Shift + R** (Windows/Linux) or **Cmd + Shift + R** (Mac).
- Make sure the dev server is still running in the terminal.

---

## Recording Audience Samples in the Dashboard

In the **Sample Recording** panel, pick what you're recording, then press **🔴 Record** and **⏹ Stop**:

| Type | Use it for | Where it goes |
|------|-----------|---------------|
| **Lead / Bass / Chords / Drums** | Sounds meant for a track's instrument | Available as an instrument for any track |
| **Lines** | Spoken lines from the audience | Straight onto pad 1 of the **Lines** pad bank (others move down one) |
| **Effects** | Verbal sound effects from the audience | Straight onto pad 1 of the **Effects** pad bank (others move down one) |

In **Edit Sample** you can preview, trim/tune and save, **rename**, or **🗑️ Delete** a recording. Deleting asks for confirmation and can't be undone. It removes the file, takes it off any pads (the rest close the gap), and switches any track using it back to that track's default instrument.

---

## Adding Audience Samples

You can replace the default synthesizers with custom audience recordings. 

### 1. Folder Structure

Place your recordings in the `public/samples/` directory, organized by role:

- `public/samples/lead/` — Melodic lead recordings
- `public/samples/bass/` — Bass recordings
- `public/samples/chord/` — Chord stab recordings
- `public/samples/drum/` — Percussion recordings (future)

### 2. Naming Conventions

Strudel supports pitch-shifting a single sample across notes. You can also provide multiple variations.

- **Lead, Bass, and Chords:** Name files as numbered variations (`0.wav`, `1.wav`, `2.wav`, etc.).
- **Drums:** Name files by their role (`kick.wav`, `snare.wav`, `hihat.wav`).

Supported formats: `.wav` (recommended), `.mp3`, `.ogg`.

### 3. Generate the Catalog

After adding or renaming samples **by hand in the folder**, you must regenerate the sample catalog so the dashboard knows they exist. (Recordings made in the dashboard update the catalog automatically. Don't run this if you rely on them: it rewrites `public/strudel.json` and forgets which recordings are Lines, Effects, etc.) Run this from the project folder:

```bash
npx @strudel/sampler public/samples --json > public/strudel.json
```

Then refresh the dashboard. If a folder is empty, the dashboard will gracefully fall back to a synthesizer for that layer.

---

## Project Layout

| Path | Purpose |
|------|---------|
| `index.html` | The main HTML page that loads in the browser |
| `style.css` | All visual styling (dark mode theme, layout, animations) |
| `dashboard.js` | Operator dashboard — wires up controls to the Strudel engine |
| `src/state.js` | Shared performance state (single source of truth for all parameters) |
| `src/patterns/generative.js` | Generative arrangement engine — random chords, melodies, and basslines |
| `strudel code/` | Original REPL-oriented generative scripts (reference material) |
| `planning notes.txt` | Architecture notes + ordered feature roadmap (6 phases, 20 features) |
| `General Idea.txt` | Project vision and goals |
| `package.json` | Project config — lists dependencies and available npm scripts |

---

## Roadmap

The full build order (20 features across 6 phases) is documented in `planning notes.txt`.

| Phase | Focus | Status |
|-------|-------|--------|
| 1. Foundation | Vite + dashboard + shared state | ✅ Complete |
| 2. Generative engine | Four-layer arrangement with controls | ✅ Complete |
| 3. Audience samples | Load and map recordings to lead/bass/chords | ✅ Complete |
| 4. MIDI | Two m-vave SMC-PAD controllers for improv players | ✅ Complete |
| 5. Strudel REPL embed | Pianoroll + live coding alongside dashboard | ✅ Complete |
| 6. Audience phone UI | ~4 mobile buttons with guardrails | ✅ Complete |

### Recent Enhancements

- **Expanded Sample Banks:** Four pad banks; the 16th pad cycles through them on both the UI and MIDI controllers.
  - **Lines and Effects (banks 1–2):** up to 30 assignable one-shot samples.
    - **On startup:** each bank fills with the newest renamed recordings of its own type (recorded as Lines or Effects), and any space left is filled with other renamed recordings, newest first. Samples still carrying a default name like `audience_lead_1789044106422` are skipped as likely failed takes.
    - **New recordings:** recording a new sample as **Lines** or **Effects** puts it straight onto pad 1 of that bank. The others move down one pad, and the one on pad 15 drops off. Rename a take to keep it in the bank after a reload, since unrenamed takes are left out at startup.
  - **Notes (bank 3):** pads 1–13 play the notes of the current chord, low to high, on a melody instrument. Pad 14 picks the chord. Pad 15 switches to a random melody instrument.
  - **Sample Notes (bank 4):** the same chord notes, played by pitch-shifting a recorded sample (lower pads slower and deeper, higher pads faster and brighter). Pad 14 picks the chord. Pad 15 cycles through the renamed recorded samples.
  - **Pad 14 (chord) in Notes and Sample Notes:** each press steps through **Auto**, then each chord in the current key (e.g. Cm7, Fm7, Gm7, Bb7, EbM7, AbM7 in C minor), then back to Auto. On Auto, the pads follow the chord the music is playing (or the progression's first chord when stopped). On a chosen chord, they stay on it, shown as "(chosen)" in the bank title. Both banks share the choice. If the key changes, a chosen chord that's no longer in the key returns to Auto.
  - **Turning banks on and off:** in the dashboard's pad panel, untick a bank's checkbox to leave it out. Pad 16 then skips it, for example only switching between Lines and Effects. Turning off the bank you're on moves to the next one that's on, and at least one bank always stays on. The choice is remembered in that browser across reloads.
- **Enhanced Audience Controls:** Updated the mobile browser controls to display the assigned sample filename on each pad. Added an info bar to provide feedback on recent actions (e.g., rate limit cooldowns and effect changes).
- **Improved Regenerate All:** Enhanced the "Regenerate all" and "New Melody/Bass" dashboard buttons to also randomize instruments for each track, chord style, progression length, scale/mode, and note density. Added random recorded sample buttons (🎙️) to the instruments section.
- **Refined Transpose Controls:** Removed global transpose (whole song up/down) from the dashboard and MIDI mapping. Modified the "Track Pitch" controls to shift up/down by two steps at a time.
- **Robust Sample State Management:** Improved the workflow for saving, trimming, ADSR, and renaming samples. Renames now immediately reflect across the UI, seamlessly updating active track and pad assignments without dropping a beat or requiring a browser refresh.
---

## Licensing

Strudel is licensed under [AGPLv3](https://www.gnu.org/licenses/agpl-3.0.html). If you deploy this project publicly (host it on the web), you must make your source code available under compatible terms.
