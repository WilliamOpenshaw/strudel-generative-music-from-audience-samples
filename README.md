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
  VITE v5.x.x  ready in XXX ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: http://192.168.x.x:5173/
```

### Step 3: Open the dashboard in your browser

Open your web browser (Chrome or Edge recommended) and go to:

```
http://localhost:5173
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
| **Gain** | 0.00 – 1.00 | Master volume. 0 = silent, 1 = full volume. Default is 0.80. |
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
| **↻ Regenerate all** | Creates a brand-new random chord progression, melody, and bassline |
| **New chords** | Only re-rolls the chord progression |
| **New melody** | Only re-rolls the lead melody |
| **New bass** | Only re-rolls the bassline |

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
- Make sure nothing else is using port 5173. If it is, Vite will try the next available port and tell you in the terminal output.

### The page loads but looks broken
- Hard-refresh the browser: **Ctrl + Shift + R** (Windows/Linux) or **Cmd + Shift + R** (Mac).
- Make sure the dev server is still running in the terminal.

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

After adding or renaming samples, you must regenerate the sample catalog so the dashboard knows they exist. Run this from the project folder:

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
| 5. Strudel REPL embed | Pianoroll + live coding alongside dashboard | 🔲 Not started |
| 6. Audience phone UI | ~4 mobile buttons with guardrails | 🔲 Not started |

---

## Licensing

Strudel is licensed under [AGPLv3](https://www.gnu.org/licenses/agpl-3.0.html). If you deploy this project publicly (host it on the web), you must make your source code available under compatible terms.
