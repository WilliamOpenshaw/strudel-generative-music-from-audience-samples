# Piano roll dashboard issue
_Exported on 8/22/2026 at 00:26:13 GMT+8 from Cursor (3.9.16)_

---

**User**

@dashboard.js 
This dashboard runs in chrome @README.md 
I would like for the strudel piano roll to work and run in the dashboard like it did in the past. Could you please familiarize yourself with the project and its goals and diagnose and fix the piano roll problem?

Inspect dashboard.js and ensure the piano roll visualization on #test-canvas / <strudel-editor> renders reliably. Check that: (1) buildStrudelCode output properly pipes .pianoroll() into the embedded editor's repl without double-playing audio, and (2) the ResizeObserver correctly handles retina/DPR scaling so the canvas doesn't render blank or blurry upon initial start.

This is an example of what you can try, but do what you think is best.

---

**Cursor**

Now let's set up the debugging session. I'll add targeted instrumentation to test several hypotheses about why the piano roll isn't rendering.

Now let me add the debug instrumentation to `dashboard.js`:

Now let's instrument `playPattern()`:

Now let's instrument the canvas ResizeObserver / initial sync in the DOMContentLoaded block:

Now let's check for linter errors and then start the dev server.

Good, no lint errors, and the log file doesn't exist yet (clean slate). Now let's start the dev server.

Server is running at `http://localhost:3000/`. Now I need the user to open this in Chrome and reproduce the issue.

Server is up and running at `http://localhost:3000/`. I've instrumented `dashboard.js` with debug logs to trace the piano-roll issue. I have five hypotheses I'm testing:

1. **H1** — The canvas's initial resize (`syncCanvasSize`) runs before the editor panel is properly laid out, leaving `#test-canvas` at a wrong/zero resolution that never gets corrected.
2. **H2** — `repl.editor` isn't found when "Start" is clicked, silently falling back to the global `evaluate()` path (which uses `.play()`, not `.pianoroll()`), so nothing ever draws to the canvas.
3. **H3** — `repl.editor.evaluate()` throws an error when running the `.pianoroll()`-modified code, which is being silently swallowed.
4. **H4** — The canvas dimensions are 0 or invalid at the exact moment `.pianoroll()` captures its drawing context.
5. **VIS** — Direct pixel-sampling of the canvas before/after evaluation to see if anything is actually being painted over time.

Please open Chrome and go to `http://localhost:3000/`, then click **▶ Start** and let it run for a few seconds while watching the piano roll panel on the right.

<reproduction_steps>
1. Open Chrome and navigate to http://localhost:3000/
2. Open DevTools (F12) and keep the Console tab visible so you can also see any errors.
3. Click the ▶ Start button in the dashboard.
4. Watch the "Live Code Editor & Piano Roll" panel on the right side for a few seconds — note whether the canvas area above the code editor is blank, blurry, or shows moving note bars.
5. Leave it running for about 5 seconds, then press Proceed/Mark as fixed when done.
</reproduction_steps>

---

**User**

Issue reproduced, please proceed.

---

**Cursor**

It's in `.cursor\debug-0d96c9.log` instead of the workspace root. Let's read it.

The four earlier hypotheses (H1 canvas sizing, H2 missing editor reference, H3 evaluate() errors, H4 zero canvas dims) are all **REJECTED** — canvas is correctly sized (518×200), the editor is always found, `evaluate()` never throws, and the scheduler always reports `started: true`.

However, the **VIS** pixel-sampling check reveals something important: the checksum stayed at **exactly 0 across every sample point** (before evaluate, immediately after, at 1.5s, at 3s) across ~15 restarts. That's suspicious, but my sampling only checked a small 60×60 corner, which could miss content drawn elsewhere on the canvas. I need better evidence — I'll directly monkey-patch the canvas's drawing methods to count actual draw calls, and add global error listeners to catch any silently-swallowed exceptions (Strudel's internal animation loop has no try/catch, so an error there would kill rendering permanently without any visible error).

Let's clean up the rejected-hypothesis logging and add sharper instrumentation:

Let me replace the instrumentation block with sharper diagnostics (full-canvas alpha scan, draw-call counters via monkey-patching, and global error/rejection listeners):

Now let's simplify the previously-rejected H1/H2/H4 verbose logging and wire up the new instrumentation:

Now let's remove the rejected-hypothesis logging (H1, H2, H4, and the corner-pixel VIS checks) and keep only what's still relevant, wiring in the new draw-call instrumentation:

Now let's simplify the resize/canvas-setup instrumentation (H1 was rejected) and wire in the new `instrumentCanvasDrawCalls()`:

Good, all cleaned up. Let's check for lint errors and clear the log file for a fresh run.

This is a major clue. The server logs show a **direct runtime warning from `@strudel/core` itself**: *"`@strudel/core` was loaded more than once... multiple versions of strudel installed."* This confirms a new, much stronger hypothesis. Let's investigate the mechanism behind this warning.

We found a critical clue in the server terminal: **`@strudel/core was loaded more than once`** — a runtime self-check inside `@strudel/core` itself that fires when its top-level module code executes twice in the browser (this is a JS-module-instantiation duplication, not an npm package duplication — `npm ls` confirms only one physical copy on disk). This happens when Vite's dev-time dependency pre-bundler creates separate bundled chunks for `@strudel/web` and `@strudel/repl` that each inline their own copy of shared internal state (schedulers, `Pattern` prototypes, animation-frame registries, audio context singletons) instead of sharing one instance.

This could explain a "silently draws nothing" piano roll: if `@strudel/draw`'s internal `getTime()`/animation-frame loop ends up wired to a different, disconnected module instance than the one actually playing audio, the pianoroll's draw loop could be running but computing stale/static positions forever.

Let's get direct evidence with the draw-call counters and error listeners I just added. Please reproduce once more:

I've updated the instrumentation (dev server has already hot-reloaded the page 3 times per the terminal log, so the new code is live). Please reproduce once more so I can check the draw-call counters and error listeners.

<reproduction_steps>
1. In Chrome at http://localhost:3000/, refresh the page (Ctrl+Shift+R for a hard refresh) to ensure the latest instrumentation is loaded.
2. Open DevTools Console (F12) and watch for any warnings, especially anything mentioning "@strudel/core was loaded more than once".
3. Click the ▶ Start button.
4. Let it run for about 6 seconds while watching the piano roll canvas.
5. Click ■ Stop, then press Proceed/Mark as fixed when done.
</reproduction_steps>

---

**User**

Issue reproduced, please proceed.

---

**Cursor**

Excellent — this is very strong, conclusive evidence. The `DRAWCALLS` log shows `fillRect` exploding from **0 → 196,460 → 553,587 → ... → 733,239 calls per 2-second window**, while `clearRect`/`stroke` stay in a sane ~60-230/2s range (consistent with a normal ~60fps animation loop). This means: the animation loop itself runs at a normal rate, but each frame is drawing an **enormous and ever-growing number of note rectangles** — a classic symptom of **multiple orphaned `.pianoroll()` render loops piling up** across repeated restarts, each accumulating stale note data forever. This lines up exactly with the **"`@strudel/core` was loaded more than once"** warning recorded in the server terminal — a duplicated module instance would explain why old animation-frame loops from `Pattern.prototype.draw()` aren't being properly cancelled when new ones start (they're referencing disconnected copies of the same internal state).

Let's confirm this diagnosis by checking Vite's dependency-optimization config, which is the standard cause of this exact class of bug:

This is the key mechanism. `StrudelMirror`'s `beforeEval` hook already calls `cleanupDraw(true, id)` before every evaluation — but `id` there is the **editor's own random instance id** (e.g. `"a1b2"`), while `.pianoroll()` defaults to `id: 1`. Since `cleanupDraw` only cancels animation-frame loops whose id **starts with** the editor's id, it never matches `1`, so the previous `.pianoroll()` render loop is *never cancelled* on restart — it just keeps accumulating state forever, compounding across every restart. Let's verify the editor exposes its own `.id` and fix this by making `.pianoroll()` use that same id:

Confirmed. Now let's implement the fix — make `.pianoroll()` use the same `id` as the embedded editor instance, so Strudel's existing `beforeEval` cleanup hook correctly cancels the previous render loop before each restart:

Now let's check for lint errors and clear the log for a fresh verification run:

I've applied the fix (tying `.pianoroll()`'s render-loop id to the embedded editor's own instance id, so Strudel's existing cleanup hook actually cancels the old loop on every restart). The dev server has already picked up the change via HMR. Now let's verify with a fresh reproduction — this time please also try changing sliders/regenerating a few times (like before) to stress-test the restart path, since that's what triggered the bug originally.

<reproduction_steps>
1. In Chrome at http://localhost:3000/, hard-refresh the page (Ctrl+Shift+R).
2. Click ▶ Start and confirm the piano roll now shows moving note bars scrolling across the canvas.
3. Click a few "Regenerate"/instrument-randomize (🎲) buttons a handful of times over a few seconds, like before, to stress-test rapid restarts.
4. Watch the piano roll for about 8-10 seconds total — confirm it keeps rendering smoothly (no blank/frozen/garbled canvas) and audio still plays normally (only once, not doubled).
5. Click ■ Stop, then press Proceed/Mark as fixed when done.
</reproduction_steps>

---

**User**

Issue reproduced, please proceed.

---

**Cursor**

Big improvement confirmed by the logs. Compare the two runs:

- **Before the fix**: `fillRect` exploded to 600,000–733,000 calls per 2-second window and kept climbing — a runaway leak.
- **After the fix**: `fillRect` now tracks `clearRect`/`stroke` almost 1:1 (e.g. `317/317/317`, `240/240/240`), staying in the low hundreds per 2-second window — exactly what a normal ~60fps single render loop should look like. The leak is gone.

However, I noticed something in this same data that needs your eyes: in every single window, `fillRect` count **exactly equals** `clearRect` count. Since each `__pianoroll()` frame does 1 background `clearRect` + 1 background `fillRect` + (one `fillRect`/`strokeRect` **per visible note**) + 1 `stroke` (playhead line), an exact 1:1:1 match across 80+ seconds suggests **zero note rectangles are being drawn** — only the background clear and the playhead line. That could mean the canvas now shows a moving playhead line but no actual colored note blocks, which would still look "broken" to you, just differently broken than before.

I need your eyes to confirm which of these you're seeing now:

<reproduction_steps>
1. In Chrome at http://localhost:3000/, hard-refresh (Ctrl+Shift+R) if you haven't already.
2. Click ▶ Start.
3. Look closely at the piano roll canvas for about 5 seconds and note specifically: (a) Do you see a thin vertical or horizontal playhead line moving/present? (b) Do you see any colored rectangular note blocks scrolling across it, or is it just an empty dark background (with or without the line)?
4. Click a "Regenerate" button once or twice to confirm it still restarts cleanly without flashing/freezing.
5. Click ■ Stop, then press Proceed/Mark as fixed when done — but please describe what you saw in step 3 in your next message either way.
</reproduction_steps>

---

**User**

When I reporoduced these steps, I see a line in the middle of the piano roll, but there is nothing else. no note bars scrolling. The music does nto play unless I randomize the instruments a few times like in the previous test. In teh strudel code window console, the drum notation does light up with rectangle boxes on what is playing at what time, but there is no sound. 

---

**Cursor**

Let's check if `@strudel/repl`'s actual bundle (the large chunk file) inlines its own copy of `@strudel/core`, and inspect how `getTime`/`setTime` are wired — this could explain both the "no note bars" and "no sound until several restarts" symptoms.

