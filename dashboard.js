import { initStrudel, evaluate, hush, samples, noteToMidi, superdough, getAudioContext } from '@strudel/web';
import { Drawer } from '@strudel/draw';
import '@strudel/repl'; // registers <strudel-editor> custom element (code display only)
import QRCode from 'qrcode';
import { state, setStatus } from './src/state.js';
import { createArrangement, buildStrudelCode } from './src/patterns/generative.js';
import { loadCatalog, applyCatalogToState, getAllSamples, getRenamedSamplesNewestFirst } from './src/samples/catalog.js';
import { captureEditorSampleLoader, registerAudienceSamples } from './src/samples/register.js';
import {
  MELODY_PAD_INSTRUMENTS,
  chordPadNotes,
  currentChordSymbol,
  sampleRateForNote,
  noteName,
  instrumentLabel,
} from './src/pads/chordPads.js';
import { PAD_DISPLAY_ORDER, renderPadGrid } from './src/pads/padGrid.js';
import { initMIDI } from './src/midi/midi.js';
import { initSampleEditor, setOnCatalogUpdated } from './src/samples/editor.js';
import { initSampleRecorder } from './src/samples/recorder.js';
import { initOperatorWS } from './src/ws/operator.js';
import { registerSoundfonts } from './src/soundfonts/register.js';
import { strudelInstruments } from './src/soundfonts/strudel-instruments.js';

let started = false;
let strudelReady = false;

// globalRepl is the object returned by initStrudel — it carries the single
// authoritative scheduler whose .now() we use to drive the piano roll canvas.
let globalRepl = null;
let operatorWsClient = null;

/* ─── Piano roll canvas renderer ──────────────────── */
// We use @strudel/draw's Drawer class which manages the rAF loop, hap query
// window, and memory correctly.  We provide our own draw callback that paints
// onto #test-canvas with the same layout logic as Strudel's __pianoroll().

/** @type {Drawer|null} */
let pianoRollDrawer = null;

/* ── Value extraction (mirrors @strudel/draw/pianoroll.mjs getValue) ─── */

/**
 * Convert a frequency in Hz to a MIDI note number.
 * @param {number} freq
 * @returns {number}
 */
function freqToMidi(freq) {
  return Math.round(12 * Math.log2(freq / 440) + 69);
}

/**
 * Extract a comparable value from a Hap for piano-roll Y-axis positioning.
 * Returns a number (MIDI) for pitched content, or a string for unpitched
 * sounds (drums / samples) so they can be folded into unique lanes.
 */
function getValue(e) {
  let { value } = e;
  if (typeof value !== 'object') {
    value = { value };
  }
  const { freq, s } = value;
  const note = value.note ?? value.n;

  if (freq) {
    return freqToMidi(freq);
  }
  if (typeof note === 'string') {
    try {
      return noteToMidi(note);
    } catch (_) {
      return 0;
    }
  }
  if (typeof note === 'number') {
    return note;
  }
  if (s) {
    return '_' + s; // unpitched: fold-mode will assign a lane
  }
  return typeof value === 'number' ? value : 0;
}

/* ── Drawing callback ──────────────────────────────────────────────── */

/**
 * Draw a single piano-roll frame onto the given canvas 2-D context.
 * Uses fold-mode so every unique value (MIDI note or sound name) gets
 * its own evenly-spaced vertical lane — the same approach as Strudel's
 * built-in __pianoroll().
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Hap[]} haps  — haps visible in the current look-around window
 * @param {number} time — current scheduler time in cycles
 * @param {number} cycles — total cycle window width
 * @param {number} playhead — fraction (0-1) of the window behind the playhead
 */
function drawPianoRollFrame(ctx, haps, time, cycles, playhead) {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const from = -cycles * playhead;
  const to = cycles * (1 - playhead);
  const timeExtent = to - from;

  // ── Background ──
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0d0d14';
  ctx.fillRect(0, 0, W, H);

  if (haps.length === 0) {
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.font = `${Math.round(H * 0.12)}px Inter, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('No notes', W / 2, H / 2);
    ctx.textAlign = 'left';
  }

  // ── Collect unique values and sort for fold-mode vertical lanes ──
  const values = [];
  haps.forEach((e) => {
    const v = getValue(e);
    if (!values.includes(v)) values.push(v);
  });
  values.sort((a, b) =>
    typeof a === 'number' && typeof b === 'number'
      ? a - b
      : typeof a === 'number'
        ? 1
        : String(a).localeCompare(String(b)),
  );
  const barThickness = values.length > 0 ? H / values.length : H;

  // ── Draw note rectangles ──
  haps.forEach((event) => {
    const value = getValue(event);
    const isActive = event.whole.begin <= time && event.endClipped > time;
    const { velocity = 1, gain = 1 } = event.value || {};

    // Time → X mapping
    const timeProgress = (event.whole.begin - (0 /* no flipTime */ ? to : from)) / timeExtent;
    const timePx = timeProgress * W;
    const durationPx = (event.duration / timeExtent) * W;

    // Value → Y mapping (fold mode: index into sorted unique values)
    const valueIdx = values.indexOf(value);
    const valueProgress = values.length > 1 ? valueIdx / values.length : 0;
    const valuePx = (1 - valueProgress) * H; // higher index = higher on canvas

    const offset = (time / timeExtent) * W;

    const x = timePx - offset + 1;
    const y = valuePx - barThickness + 1;
    const w = Math.max(2, durationPx - 2);
    const h = barThickness - 2;

    ctx.globalAlpha = Math.max(0.35, Math.min(1, velocity * gain));
    ctx.fillStyle = isActive ? '#b8ff8c' : '#4a9eff';
    ctx.strokeStyle = isActive ? '#e0ffcc' : '#2266bb';
    ctx.lineWidth = 1;

    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
    
    // Draw Note Notation
    const noteName = event.value.note ?? event.value.n ?? event.value.s ?? value;
    if (noteName !== undefined && noteName !== null && w > 4) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();
      ctx.fillStyle = isActive ? '#000' : '#fff';
      ctx.font = `600 ${Math.max(8, Math.min(12, h - 2))}px Inter, monospace`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(noteName), x + 2, y + h / 2);
      ctx.restore();
    }
  });

  // ── Playhead line ──
  ctx.globalAlpha = 1;
  const playheadX = (-from / timeExtent) * W;
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(playheadX, 0);
  ctx.lineTo(playheadX, H);
  ctx.stroke();
}

/* ── Drawer-based piano roll loop ─────────────────────────────────── */

const DRAW_TIME = [-2, 2]; // [lookbehind, lookahead] in cycles

/**
 * Start the piano-roll render loop.  Uses @strudel/draw's Drawer class which
 * manages hap memory, query windowing, and deduplication.
 */
function startPianoRollLoop() {
  stopPianoRollLoop();

  const canvas = document.getElementById('test-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const lookbehind = Math.abs(DRAW_TIME[0]);
  const lookahead = DRAW_TIME[1];
  const cycles = lookbehind + lookahead;
  const playhead = cycles !== 0 ? lookbehind / cycles : 0;

  pianoRollDrawer = new Drawer(
    (visibleHaps, time) => {
      drawPianoRollFrame(ctx, visibleHaps, time, cycles, playhead);
    },
    DRAW_TIME,
  );

  const replEl = document.querySelector('strudel-editor');
  const scheduler = replEl?.editor?.repl?.scheduler || globalRepl?.scheduler;
  if (scheduler) {
    pianoRollDrawer.start(scheduler);
  }
}

/** Stop the piano-roll render loop and clear the canvas. */
function stopPianoRollLoop() {
  if (pianoRollDrawer) {
    pianoRollDrawer.stop();
    pianoRollDrawer = null;
  }
  const canvas = document.getElementById('test-canvas');
  if (canvas) {
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }
}

function updateDebugStatus(message) {
  const el = document.getElementById('debug-status-display');
  if (el) el.innerText = message;
  console.debug('[dashboard] debug:', message);
}

let strudelInitPromise = null;

// Pads can trigger initialization too, so concurrent callers share one init.
async function ensureStrudel() {
  if (strudelReady) {
    updateDebugStatus('Strudel already initialized');
    return;
  }
  strudelInitPromise ??= initStrudelOnce().catch((err) => {
    strudelInitPromise = null;
    throw err;
  });
  await strudelInitPromise;
}

async function initStrudelOnce() {
  updateDebugStatus('Initializing Strudel...');
  // Must run before initStrudel(), which replaces the editor's global samples().
  await captureEditorSampleLoader();
  // initStrudel returns a Promise that resolves to the global repl object.
  // We store it so startPianoRollLoop() can access repl.scheduler.now().
  globalRepl = await initStrudel({
    prebake: async () => {
      updateDebugStatus('Prebaking: loading samples & soundfonts');
      const doughBase = 'https://raw.githubusercontent.com/felixroos/dough-samples/main';
      await Promise.all([
        samples('github:tidalcycles/dirt-samples'),
        samples(`${doughBase}/tidal-drum-machines.json`),
        samples(`${doughBase}/piano.json`),
      ]);
      try {
        await samples('https://raw.githubusercontent.com/todepond/samples/main/tidal-drum-machines-alias.json');
      } catch (_) {}
      try {
        registerSoundfonts();
      } catch (err) {
        console.warn('[dashboard] Failed to register soundfonts:', err);
      }
      const availability = await loadCatalog();
      applyCatalogToState(state);
      setupInstrumentSelects();

      // If any audience samples exist, load them from the local server
      if (availability.lead || availability.bass || availability.chord || availability.drum) {
        try {
          updateDebugStatus('Loading local audience samples');
          await registerAudienceSamples();
        } catch (err) {
          console.warn('[dashboard] Failed to load local samples:', err);
          updateDebugStatus('Failed to load local audience samples');
        }
      }
    },
  });
  strudelReady = true;
  updateDebugStatus('Strudel initialized');
}

/* ─── Status badge helper ──────────────────────────── */
function applyStatusClass(text) {
  const el = document.getElementById('status-display');
  if (!el) return;
  el.className = ''; // reset
  if (text === 'Playing') el.classList.add('playing');
  else if (text.startsWith('Error')) el.classList.add('error');
  else if (text === 'Loading…') el.classList.add('loading');
}

/* ─── Parameter and UI Sync ────────────────────────── */
let restartTimeout = null;
async function debouncedRestart() {
  if (!started) return;
  if (restartTimeout) clearTimeout(restartTimeout);
  restartTimeout = setTimeout(async () => {
    // Call playPattern() directly — NOT restartPattern() — so the running
    // Strudel scheduler keeps its clock and swaps in the new pattern at the
    // next cycle boundary (same behaviour as Ctrl+Enter in the Strudel REPL).
    await playPattern();
  }, 150);
}

const uiUpdaters = {};

function updateParameter(key, value) {
  state[key] = value;
  if (uiUpdaters[key]) {
    uiUpdaters[key](value);
  }
  debouncedRestart();
}

function handleAction(type, key) {
  if (type === 'toggle') {
    state[key] = !state[key];
    if (uiUpdaters[key]) uiUpdaters[key](state[key]);
    debouncedRestart();
  } else if (type === 'regen') {
    if (key === 'all') regenerate({ regenChords: true, regenMelody: true, regenBass: true, regenDrums: true, randomizeSettings: true });
    if (key === 'chords') regenerate({ regenChords: true, regenMelody: false, regenBass: false, regenDrums: false });
    if (key === 'bass') regenerate({ regenChords: false, regenMelody: false, regenBass: true, regenDrums: false, randomizeBassSettings: true });
    if (key === 'melody') regenerate({ regenChords: false, regenMelody: true, regenBass: false, regenDrums: false, randomizeMelodySettings: true });
    if (key === 'drums') regenerate({ regenChords: false, regenMelody: false, regenBass: false, regenDrums: true, randomizeDrumsSettings: true });
  } else if (type === 'transport') {
    if (key === 'start') document.getElementById('start-btn')?.click();
    if (key === 'stop') document.getElementById('stop-btn')?.click();
  } else if (type === 'rand') {
    document.getElementById(`rand-${key}`)?.click();
  } else if (type === 'record') {
    if (key === 'start') document.getElementById('record-btn')?.click();
    if (key === 'stop') document.getElementById('stop-record-btn')?.click();
    if (key === 'toggle') {
      const startBtn = document.getElementById('record-btn');
      if (startBtn && !startBtn.disabled && !startBtn.classList.contains('is-recording')) {
        startBtn.click();
      } else {
        document.getElementById('stop-record-btn')?.click();
      }
    }
  } else if (type === 'effectReset') {
    if (key === 'all') {
      ['drums', 'chords', 'bass', 'melody'].forEach(track => document.getElementById(`reset-${track}-effects`)?.click());
    } else {
      document.getElementById(`reset-${key}-effects`)?.click();
    }
  } else if (type.startsWith('density')) {
    const track = key;
    const isHalf = type === 'densityHalf';
    const stateKey = `${track}Density`;
    if (state[stateKey]) {
      state[stateKey] = isHalf ? Math.ceil(state[stateKey] / 2) : Math.min(128, state[stateKey] * 2);
      document.getElementById(`${track}-density-display`).innerText = state[stateKey];
      debouncedRestart();
    }
  } else if (type === 'padBank' && key === 'toggle') {
    triggerPad(16);
  } else if (type === 'padSample') {
    triggerPad(parseInt(key, 10));
  }
}

function bindSlider(id, key, formatter, { integer = false } = {}) {
  const slider = document.getElementById(id);
  const display = document.getElementById(`${id}-display`);
  if (!slider) return;
  
  uiUpdaters[key] = (val) => {
    slider.value = val;
    if (display) display.innerText = formatter(val);
  };
  
  uiUpdaters[key](state[key]); // init
  
  slider.addEventListener('input', (e) => {
    const val = integer ? parseInt(e.target.value, 10) : parseFloat(e.target.value);
    updateParameter(key, val);
  });
}

function bindToggle(id, key) {
  const btn = document.getElementById(id);
  if (!btn) return;
  
  uiUpdaters[key] = (val) => {
    btn.setAttribute('aria-pressed', val ? 'true' : 'false');
    btn.textContent = `${btn.dataset.label}: ${val ? 'on' : 'off'}`;
  };
  
  uiUpdaters[key](state[key]); // init
  
  btn.addEventListener('click', () => {
    handleAction('toggle', key);
  });
}

/* ─── Dashboard readout updater ────────────────────── */
function updateReadouts() {
  const map = {
    'status-display': () => state.status,
    'cpm-display': () => `CPM: ${state.cpm}`,
    'speed-display': () => `Speed: ${state.speed.toFixed(2)}`,
    'transpose-display': () => `Transpose: ${state.transpose}`,
    'layers-display': () =>
      `Layers — drums:${state.drumsOn ? 'on' : 'off'} chords:${state.chordsOn ? 'on' : 'off'} bass:${state.bassOn ? 'on' : 'off'} melody:${state.melodyOn ? 'on' : 'off'}`,
    'note-display': () => `Last note: ${state.currentNote}`,
    'chord-display': () => `Current chord: ${state.currentChord}`,
    'scale-display': () => `Key/Scale: C ${state.scaleMode || 'minor'}`,
    
    // Sample bank status
    'bank-lead-display': () => state.sampleBanks?.lead
      ? `Lead Bank: ${state.sampleBanks.lead}`
      : 'Lead Bank: Synth (triangle)',
    'bank-bass-display': () => state.sampleBanks?.bass
      ? `Bass Bank: ${state.sampleBanks.bass}`
      : 'Bass Bank: Synth (sawtooth)',
    'bank-chord-display': () => state.sampleBanks?.chord
      ? `Chord Bank: ${state.sampleBanks.chord}`
      : 'Chord Bank: Synth (sawtooth)',
    'bank-drum-display': () => state.sampleBanks?.drum
      ? `Drum Bank: ${state.sampleBanks.drum}`
      : 'Drum Bank: Synth fallback',
  };
  for (const [id, fn] of Object.entries(map)) {
    const el = document.getElementById(id);
    if (el) el.innerText = fn();
  }
  applyStatusClass(state.status);
}

/* ─── Pattern lifecycle ────────────────────────────── */
// playPattern evaluates through the <strudel-editor> repl when it exists, so its
// scheduler (not globalRepl's idle one) holds the real clock and tempo.
function activeScheduler() {
  return document.querySelector('strudel-editor')?.editor?.repl?.scheduler || globalRepl?.scheduler;
}

async function playPattern() {
  const code = buildStrudelCode(state);
  updateDebugStatus('Evaluating play code');
  console.debug('[dashboard] Playing Strudel code:\n', code);

  const replEl = document.querySelector('strudel-editor');
  if (replEl?.editor) {
    replEl.editor.setCode(code);
    await replEl.editor.evaluate();
  } else {
    await evaluate(code);
  }

  // Piano roll: if the Drawer is already running, invalidate it so it picks up
  // the new pattern from the scheduler.  Otherwise start a fresh loop.
  const scheduler = activeScheduler();
  if (pianoRollDrawer && scheduler) {
    pianoRollDrawer.invalidate(scheduler);
  } else {
    startPianoRollLoop();
  }

  updateDebugStatus('Playback started');
}

async function stopPattern() {
  try {
    updateDebugStatus('Stopping current pattern');
    // hush() stops the @strudel/web global scheduler
    try { hush(); } catch (_) {}
    try { globalRepl?.scheduler?.stop?.(); } catch (_) {}

    // Also stop strudel-editor repl if user evaluated via Ctrl+Enter in code window
    const replEl = document.querySelector('strudel-editor');
    if (replEl?.editor?.repl) {
      try { replEl.editor.repl.stop(); } catch (_) {}
    }

    // Stop and clear the piano roll render loop.
    stopPianoRollLoop();
    updateDebugStatus('Playback stopped');
  } catch (err) {
    console.warn('Stop failed:', err);
    updateDebugStatus(`Stop failed: ${err.message || err}`);
  }
}

async function restartPattern() {
  await stopPattern();
  await playPattern();
}

// Powers of two so every track's note grid lines up with the others.
// 128 is allowed manually but too fast to land on at random.
const RANDOM_DENSITY_CHOICES = [4, 8, 16, 32, 64];

function randomizeDensity(track) {
  const value = RANDOM_DENSITY_CHOICES[Math.floor(Math.random() * RANDOM_DENSITY_CHOICES.length)];
  state[`${track}Density`] = value;
  const display = document.getElementById(`${track}-density-display`);
  if (display) display.innerText = value;
}

function applyTimeSignature(value) {
  const [num, den] = value.split('/').map(Number);
  state.timeSigNum = num;
  state.timeSigDen = den;
  const select = document.getElementById('time-sig-select');
  if (select) select.value = value;
  const display = document.getElementById('time-sig-display');
  if (display) display.innerText = value;
}

async function regenerate(options) {
  if (options && options.randomizeSettings) {
    // Randomize instruments
    ['lead', 'chord', 'bass', 'drum'].forEach((role) => {
      document.getElementById(`rand-${role}`)?.click();
    });

    // Set directly rather than dispatching 'change': that handler runs its own
    // regenerate + restart, which would race this one.
    const timeSigs = Array.from(document.getElementById('time-sig-select')?.options || []).map((o) => o.value);
    if (timeSigs.length > 0) {
      applyTimeSignature(timeSigs[Math.floor(Math.random() * timeSigs.length)]);
    }

    // Randomize generative settings
    ['chord-style-select', 'chord-prog-length-select', 'scale-mode-select'].forEach((id) => {
      const select = document.getElementById(id);
      if (select && select.options.length > 0) {
        const opts = Array.from(select.options).map(o => o.value).filter(v => v !== '');
        if (opts.length > 0) {
          select.value = opts[Math.floor(Math.random() * opts.length)];
          select.dispatchEvent(new Event('change'));
        }
      }
    });

    // Randomize octave ranges for melody and bass
    ['melody', 'bass'].forEach((track) => {
      const ranges = [1, 3, 5];
      const picked = ranges[Math.floor(Math.random() * ranges.length)];
      document.getElementById(`${track}-oct-range-${picked}`)?.click();
    });

    ['melody', 'bass', 'drums'].forEach(randomizeDensity);
  }

  if (options && options.randomizeMelodySettings) {
    const ranges = [1, 3, 5];
    const picked = ranges[Math.floor(Math.random() * ranges.length)];
    document.getElementById(`melody-oct-range-${picked}`)?.click();
    randomizeDensity('melody');
  }

  if (options && options.randomizeBassSettings) {
    const ranges = [1, 3, 5];
    const picked = ranges[Math.floor(Math.random() * ranges.length)];
    document.getElementById(`bass-oct-range-${picked}`)?.click();
    randomizeDensity('bass');
  }

  if (options && options.randomizeDrumsSettings) {
    randomizeDensity('drums');
  }

  createArrangement(state, options);
  updateReadouts();
  // Use playPattern() directly so the new arrangement lands at the next
  // cycle boundary without stopping the clock.
  if (started) await playPattern();
}

/* ─── Track Pitch Controls (Independent Steps & Octaves) ── */
function bindTrackPitchControls() {
  const tracks = [
    {
      name: 'lead',
      stepKey: 'leadTranspose',
      aliasStepKey: 'melodyTranspose',
      octKey: 'leadOctave',
      aliasOctKey: 'melodyOctave',
      downStepId: 'lead-trans-down',
      upStepId: 'lead-trans-up',
      displayStepId: 'lead-trans-display',
      downOctId: 'lead-oct-down',
      upOctId: 'lead-oct-up',
      displayOctId: 'lead-oct-display',
      resetId: 'lead-pitch-reset',
    },
    {
      name: 'chords',
      stepKey: 'chordsTranspose',
      octKey: 'chordsOctave',
      downStepId: 'chords-trans-down',
      upStepId: 'chords-trans-up',
      displayStepId: 'chords-trans-display',
      downOctId: 'chords-oct-down',
      upOctId: 'chords-oct-up',
      displayOctId: 'chords-oct-display',
      resetId: 'chords-pitch-reset',
    },
    {
      name: 'bass',
      stepKey: 'bassTranspose',
      octKey: 'bassOctave',
      downStepId: 'bass-trans-down',
      upStepId: 'bass-trans-up',
      displayStepId: 'bass-trans-display',
      downOctId: 'bass-oct-down',
      upOctId: 'bass-oct-up',
      displayOctId: 'bass-oct-display',
      resetId: 'bass-pitch-reset',
    },
    {
      name: 'drums',
      stepKey: 'drumsTranspose',
      octKey: 'drumsOctave',
      downStepId: 'drums-trans-down',
      upStepId: 'drums-trans-up',
      displayStepId: 'drums-trans-display',
      downOctId: 'drums-oct-down',
      upOctId: 'drums-oct-up',
      displayOctId: 'drums-oct-display',
      resetId: 'drums-pitch-reset',
    },
  ];

  tracks.forEach((t) => {
    const downStep = document.getElementById(t.downStepId);
    const upStep = document.getElementById(t.upStepId);
    const displayStep = document.getElementById(t.displayStepId);

    const downOct = document.getElementById(t.downOctId);
    const upOct = document.getElementById(t.upOctId);
    const displayOct = document.getElementById(t.displayOctId);

    const resetBtn = document.getElementById(t.resetId);

    const updateDisplay = () => {
      const stepVal = state[t.stepKey] || 0;
      const octVal = state[t.octKey] || 0;
      if (displayStep) displayStep.innerText = stepVal > 0 ? `+${stepVal}` : `${stepVal}`;
      if (displayOct) displayOct.innerText = octVal > 0 ? `+${octVal}` : `${octVal}`;
    };

    const applyStep = async (delta) => {
      state[t.stepKey] = (state[t.stepKey] || 0) + delta;
      if (t.aliasStepKey) state[t.aliasStepKey] = state[t.stepKey];
      updateDisplay();
      debouncedRestart();
    };

    const applyOct = async (delta) => {
      state[t.octKey] = (state[t.octKey] || 0) + delta;
      if (t.aliasOctKey) state[t.aliasOctKey] = state[t.octKey];
      updateDisplay();
      debouncedRestart();
    };
    downStep?.addEventListener('click', () => applyStep(-2));
    upStep?.addEventListener('click', () => applyStep(2));

    downOct?.addEventListener('click', () => applyOct(-1));
    upOct?.addEventListener('click', () => applyOct(1));

    resetBtn?.addEventListener('click', () => {
      state[t.stepKey] = 0;
      if (t.aliasStepKey) state[t.aliasStepKey] = 0;
      state[t.octKey] = 0;
      if (t.aliasOctKey) state[t.aliasOctKey] = 0;
      updateDisplay();
      debouncedRestart();
    });

    updateDisplay();
  });
}

function setupInstrumentSelects() {
  const allSamples = getAllSamples();

  // Format instrument identifiers nicely for dropdown labels
  const formatName = (str) =>
    str
      .replace(/^gm_/, '')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());

  const configs = {
    'inst-drum': {
      role: 'drum',
      defaultOption: 'RolandTR909',
      groups: [
        {
          label: '── Classic Drum Kits ──',
          options: [
            { label: '🥁 Roland TR-909', value: 'RolandTR909' },
            { label: '🥁 Roland TR-808', value: 'RolandTR808' },
            { label: '📻 Synth Click (Fallback)', value: 'synth' },
            { label: '🎙️ Audience Drums (Full Bank)', value: 'audience_drum' },
          ],
        },
        {
          label: '── Built-in Drum Kits (Tidal / Strudel) ──',
          options: (strudelInstruments.drumKits || []).map((name) => ({
            label: `🥁 ${formatName(name)}`,
            value: name,
          })),
        },
      ],
    },
    'inst-chord': {
      role: 'chord',
      defaultOption: 'sawtooth',
      groups: [
        {
          label: '── Basic Synths ──',
          options: [
            { label: '🎹 Sawtooth Synth', value: 'sawtooth' },
            { label: '🎹 Triangle Synth', value: 'triangle' },
            { label: '🎹 Square Synth', value: 'square' },
            { label: '🎹 Sine Synth', value: 'sine' },
            { label: '🎙️ Audience Chords (Full Bank)', value: 'audience_chord' },
          ],
        },
        {
          label: '── Strudel Built-in Synths ──',
          options: (strudelInstruments.synths || [])
            .filter((s) => !['sawtooth', 'triangle', 'square', 'sine'].includes(s))
            .map((s) => ({
              label: `⚡ ${s}`,
              value: s,
            })),
        },
        {
          label: '── General MIDI Instruments ──',
          options: (strudelInstruments.gm || []).map((name) => ({
            label: `🎻 ${formatName(name)}`,
            value: name,
          })),
        },
        {
          label: '── Melodic & Acoustic Samples ──',
          options: (strudelInstruments.dirtSamples || []).map((name) => ({
            label: `🎶 ${name}`,
            value: name,
          })),
        },
      ],
    },
    'inst-bass': {
      role: 'bass',
      defaultOption: 'sawtooth',
      groups: [
        {
          label: '── Basic Synths ──',
          options: [
            { label: '🎸 Sawtooth Bass', value: 'sawtooth' },
            { label: '🎸 Triangle Bass', value: 'triangle' },
            { label: '🎸 Square Bass', value: 'square' },
            { label: '🎸 Sine Bass', value: 'sine' },
            { label: '🎙️ Audience Bass (Full Bank)', value: 'audience_bass' },
          ],
        },
        {
          label: '── Strudel Built-in Synths ──',
          options: (strudelInstruments.synths || [])
            .filter((s) => !['sawtooth', 'triangle', 'square', 'sine'].includes(s))
            .map((s) => ({
              label: `⚡ ${s}`,
              value: s,
            })),
        },
        {
          label: '── General MIDI Instruments ──',
          options: (strudelInstruments.gm || []).map((name) => ({
            label: `🎻 ${formatName(name)}`,
            value: name,
          })),
        },
        {
          label: '── Melodic & Acoustic Samples ──',
          options: (strudelInstruments.dirtSamples || []).map((name) => ({
            label: `🎶 ${name}`,
            value: name,
          })),
        },
      ],
    },
    'inst-lead': {
      role: 'lead',
      defaultOption: 'triangle',
      groups: [
        {
          label: '── Basic Synths ──',
          options: [
            { label: '✨ Triangle Lead', value: 'triangle' },
            { label: '✨ Sawtooth Lead', value: 'sawtooth' },
            { label: '✨ Square Lead', value: 'square' },
            { label: '✨ Sine Lead', value: 'sine' },
            { label: '🎙️ Audience Lead (Full Bank)', value: 'audience_lead' },
          ],
        },
        {
          label: '── Strudel Built-in Synths ──',
          options: (strudelInstruments.synths || [])
            .filter((s) => !['sawtooth', 'triangle', 'square', 'sine'].includes(s))
            .map((s) => ({
              label: `⚡ ${s}`,
              value: s,
            })),
        },
        {
          label: '── General MIDI Instruments ──',
          options: (strudelInstruments.gm || []).map((name) => ({
            label: `🎻 ${formatName(name)}`,
            value: name,
          })),
        },
        {
          label: '── Melodic & Acoustic Samples ──',
          options: (strudelInstruments.dirtSamples || []).map((name) => ({
            label: `🎶 ${name}`,
            value: name,
          })),
        },
      ],
    },
  };

  for (const [id, config] of Object.entries(configs)) {
    const el = document.getElementById(id);
    if (!el) continue;

    const currentVal = state.sampleBanks?.[config.role] || state.instruments?.[config.role] || config.defaultOption;
    el.innerHTML = '';

    // Populate categorized groups
    config.groups.forEach((group) => {
      if (group.options && group.options.length > 0) {
        const optGroup = document.createElement('optgroup');
        optGroup.label = group.label;
        group.options.forEach((opt) => {
          const optionEl = document.createElement('option');
          optionEl.value = opt.value;
          optionEl.textContent = opt.label;
          optGroup.appendChild(optionEl);
        });
        el.appendChild(optGroup);
      }
    });

    // Add individual recorded audience samples if any exist
    if (allSamples.length > 0) {
      const optGroup = document.createElement('optgroup');
      optGroup.label = '── Recorded Audience Samples ──';

      allSamples.forEach((sample) => {
        const optionEl = document.createElement('option');
        optionEl.value = sample.soundKey;
        optionEl.textContent = `🎙️ ${sample.displayName} (${sample.layerLabel})`;
        optGroup.appendChild(optionEl);
      });

      el.appendChild(optGroup);
    }

    // Restore selected value if valid, or default
    el.value = currentVal;
    if (!el.value) el.value = config.defaultOption;

    // Clear old listeners by cloning
    const newEl = el.cloneNode(true);
    el.parentNode.replaceChild(newEl, el);

    newEl.addEventListener('change', (e) => {
      const val = e.target.value;
      if (!state.sampleBanks) state.sampleBanks = {};
      if (!state.instruments) state.instruments = {};

      state.sampleBanks[config.role] = val;
      state.instruments[config.role] = val;

      updateReadouts();
      debouncedRestart();
    });

    // Randomize button
    const randBtnId = `rand-${config.role}`;
    const randBtn = document.getElementById(randBtnId);
    if (randBtn) {
      const newRandBtn = randBtn.cloneNode(true);
      randBtn.parentNode.replaceChild(newRandBtn, randBtn);
      newRandBtn.addEventListener('click', () => {
        const allOpts = Array.from(newEl.querySelectorAll('option')).map((o) => o.value);
        if (allOpts.length > 0) {
          const picked = allOpts[Math.floor(Math.random() * allOpts.length)];
          newEl.value = picked;
          if (!state.sampleBanks) state.sampleBanks = {};
          if (!state.instruments) state.instruments = {};
          state.sampleBanks[config.role] = picked;
          state.instruments[config.role] = picked;
          updateReadouts();
          debouncedRestart();
        }
      });
    }

    // Randomize recorded sample button
    const randSampleBtnId = `rand-sample-${config.role}`;
    const randSampleBtn = document.getElementById(randSampleBtnId);
    if (randSampleBtn) {
      const newRandSampleBtn = randSampleBtn.cloneNode(true);
      randSampleBtn.parentNode.replaceChild(newRandSampleBtn, randSampleBtn);
      newRandSampleBtn.addEventListener('click', () => {
        if (allSamples.length > 0) {
          const picked = allSamples[Math.floor(Math.random() * allSamples.length)].soundKey;
          newEl.value = picked;
          if (!state.sampleBanks) state.sampleBanks = {};
          if (!state.instruments) state.instruments = {};
          state.sampleBanks[config.role] = picked;
          state.instruments[config.role] = picked;
          updateReadouts();
          debouncedRestart();
        }
      });
    }
  }
}


function setupAudienceBridge() {
  const toast = document.getElementById('audience-activity-toast');
  const countBadge = document.getElementById('audience-count-badge');
  const statusPill = document.getElementById('audience-status-pill');

  function showToast(msg) {
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('flash');
    setTimeout(() => toast.classList.remove('flash'), 1500);
  }

  operatorWsClient = initOperatorWS({
    // Pad syncs sent before the socket opened were dropped; resend on every (re)connect.
    onOpen: () => broadcastPadSync(),
    onStatus: ({ connected, audienceCount }) => {
      if (countBadge) countBadge.textContent = audienceCount;
      if (statusPill) statusPill.textContent = connected ? `👥 ${audienceCount} connected` : '⚠️ Disconnected';
      const portalCount = document.getElementById('portal-audience-count');
      if (portalCount) {
        portalCount.textContent = connected ? `${audienceCount} Audience Connected` : 'Offline';
      }
    },
    onLockUpdate: (lockedSet) => {
      ['more_energy', 'calmer', 'new_chords', 'weird'].forEach((act) => {
        const btn = document.querySelector(`.lock-btn[data-action="${act}"]`);
        const icon = document.getElementById(`lock-icon-${act}`);
        if (btn) {
          const isLocked = lockedSet.has(act);
          btn.classList.toggle('locked', isLocked);
          if (icon) icon.textContent = isLocked ? '🔒' : '🔓';
        }
      });
    },
    onAction: async (action) => {
      console.info('[dashboard] Audience action received:', action);
      
      const updateSlider = (id, val) => {
        const slider = document.getElementById(id);
        if (slider) slider.value = val;
      };

      if (action === 'more_energy') {
        state.cpm = Math.min(240, state.cpm + 5);
        updateSlider('cpm-slider', state.cpm);
        showToast(`🔥 Audience: More Energy! (CPM: ${state.cpm})`);
        updateReadouts();
        debouncedRestart();
      } else if (action === 'calmer') {
        state.cpm = Math.max(60, state.cpm - 5);
        updateSlider('cpm-slider', state.cpm);
        showToast(`🌊 Audience: Calmer... (CPM: ${state.cpm})`);
        updateReadouts();
        debouncedRestart();
      } else if (action === 'new_chords') {
        showToast(`🎵 Audience: New Chords!`);
        regenerate({ regenChords: true, regenMelody: false, regenBass: false, regenDrums: false });
      } else if (action === 'weird') {
        state.melodyDelay = +(Math.random() * 0.6 + 0.2).toFixed(2);
        state.chordsRoom = +(Math.random() * 0.7 + 0.3).toFixed(2);
        updateSlider('melody-delay-slider', state.melodyDelay);
        updateSlider('chords-room-slider', state.chordsRoom);
        showToast(`✨ Audience: Got Weird! (Delay: ${state.melodyDelay}, Room: ${state.chordsRoom})`);
        updateReadouts();
        debouncedRestart();
      } else if (action === 'faster') {
        state.speed = Math.max(0.1, Math.min(4.0, (state.speed || 1.0) + 0.1));
        showToast(`⏩ Audience: Faster! (Speed: ${state.speed.toFixed(1)}x)`);
        updateReadouts();
        debouncedRestart();
      } else if (action === 'slower') {
        state.speed = Math.max(0.1, Math.min(4.0, (state.speed || 1.0) - 0.1));
        showToast(`⏪ Audience: Slower! (Speed: ${state.speed.toFixed(1)}x)`);
        updateReadouts();
        debouncedRestart();
      } else if (action === 'octave_up' || action === 'octave_down') {
        const delta = action === 'octave_up' ? 1 : -1;
        ['lead', 'chords', 'bass', 'drums'].forEach(track => {
          const octKey = `${track}Octave`;
          state[octKey] = (state[octKey] || 0) + delta;
          if (track === 'lead') state.melodyOctave = state.leadOctave;
          const displayEl = document.getElementById(`${track}-oct-display`);
          if (displayEl) {
             const val = state[octKey];
             displayEl.innerText = val > 0 ? `+${val}` : `${val}`;
          }
        });
        showToast(action === 'octave_up' ? `⬆️ Audience: Octave Up!` : `⬇️ Audience: Octave Down!`);
        updateReadouts();
        debouncedRestart();
      } else if (action === 'new_melody') {
        showToast(`🎹 Audience: New Melody!`);
        regenerate({ regenChords: false, regenMelody: true, regenBass: false, regenDrums: false, randomizeMelodySettings: true });
      } else if (action === 'new_bass') {
        showToast(`🎸 Audience: New Bass!`);
        regenerate({ regenChords: false, regenMelody: false, regenBass: true, regenDrums: false, randomizeBassSettings: true });
      } else if (action === 'new_drums') {
        showToast(`🥁 Audience: New Drums!`);
        regenerate({ regenChords: false, regenMelody: false, regenBass: false, regenDrums: true, randomizeDrumsSettings: true });
      } else if (action === 'regen_all') {
        showToast(`🎲 Audience: Regenerate All!`);
        regenerate({ regenChords: true, regenMelody: true, regenBass: true, regenDrums: true, randomizeSettings: true });
      } else if (action === 'delay_up' || action === 'delay_down') {
        const delta = action === 'delay_up' ? 0.1 : -0.1;
        ['drums', 'chords', 'bass', 'melody'].forEach(track => {
          const key = `${track}Delay`;
          state[key] = Math.max(0, Math.min(1, (state[key] || 0) + delta));
          updateSlider(`${track}-delay-slider`, state[key]);
        });
        showToast(action === 'delay_up' ? `↗️ Audience: Delay Up!` : `↙️ Audience: Delay Down!`);
        debouncedRestart();
      } else if (action === 'reverb_up' || action === 'reverb_down') {
        const delta = action === 'reverb_up' ? 0.1 : -0.1;
        ['drums', 'chords', 'bass', 'melody'].forEach(track => {
          const key = `${track}Room`;
          state[key] = Math.max(0, Math.min(1, (state[key] || 0) + delta));
          updateSlider(`${track}-room-slider`, state[key]);
        });
        showToast(action === 'reverb_up' ? `🌫️ Audience: Reverb Up!` : `📦 Audience: Reverb Down!`);
        debouncedRestart();
      } else if (action.startsWith('pad_')) {
        const padNum = parseInt(action.split('_')[1], 10);
        // Bank switching stays with the performers.
        if (padNum !== 16 && triggerPad(padNum)) {
          showToast(`🎛️ Audience: Played Pad ${padNum}!`);
        }
      }
    },
  });

  // Bind operator lock toggle buttons
  document.querySelectorAll('.lock-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      if (action && operatorWsClient) {
        operatorWsClient.toggleLock(action);
      }
    });
  });
}

/* ─── Pad Banks ────────────────────────────────────── */
// Banks 1-2: assignable one-shot samples. Bank 3: chord notes on a melody
// instrument. Bank 4: chord notes on a pitch-shifted recorded sample.
// Pad 16 always switches bank.
const PAD_BANK_COUNT = 4;
const BANK_TOGGLE_PAD = 16;
const NOTE_BANK_CYCLE_PAD = 15;
const oneShotBuffers = new Map();
let padBankAudioCtx = null;
let hasAssignedPadBankDefaults = false;
let renamedSamples = [];
let lastRenderedPadChord = null;

const isNoteBank = (bank) => bank === 3 || bank === 4;
const nextPadBank = (bank) => (bank % PAD_BANK_COUNT) + 1;

async function refreshRenamedSamples() {
  renamedSamples = await getRenamedSamplesNewestFirst();
  if (!renamedSamples.some((s) => s.soundKey === state.notePadSample)) {
    state.notePadSample = renamedSamples[0]?.soundKey || '';
  }
}

// Fill banks 1 and 2 once per session with the 30 most recent renamed samples.
function assignDefaultSampleBanks() {
  if (hasAssignedPadBankDefaults || renamedSamples.length === 0) return;
  hasAssignedPadBankDefaults = true;
  for (let pad = 1; pad <= 15; pad++) {
    state.padBanks[1][pad] = renamedSamples[pad - 1]?.soundKey || '';
    state.padBanks[2][pad] = renamedSamples[pad + 14]?.soundKey || '';
  }
}

function sampleDisplayName(sampleKey) {
  return getAllSamples().find((s) => s.soundKey === sampleKey)?.displayName || sampleKey;
}

// The cycle being heard right now. scheduler.now() tracks the query window,
// which runs a few hundred ms behind the audio, so invert the Cyclist's
// targetTime formula instead when its fields are available.
function audibleCycle(scheduler) {
  if (!scheduler) return null;
  const { num_cycles_at_cps_change: cycles0, seconds_at_cps_change: seconds0, latency, cps } = scheduler;
  if ([cycles0, seconds0, latency, cps].every(Number.isFinite) && scheduler.getTime) {
    return cycles0 + (scheduler.getTime() - seconds0 - latency) * cps;
  }
  return scheduler.now?.() ?? null;
}

function currentPadChord() {
  const schedulerCycle = started ? audibleCycle(activeScheduler()) : null;
  // The arrangement is wrapped in .fast(speed), so pattern time runs at speed × clock time.
  const cycle = schedulerCycle === null ? null : schedulerCycle * (state.speed || 1);
  return currentChordSymbol(state, cycle);
}

function currentPadNotes() {
  // Follow the chord layer's key, but not its octave shift.
  const transpose = (state.transpose || 0) + (state.chordsTranspose || 0);
  return chordPadNotes(currentPadChord(), transpose);
}

async function getPadAudioContext() {
  if (!padBankAudioCtx) {
    padBankAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (padBankAudioCtx.state === 'suspended') {
    await padBankAudioCtx.resume();
  }
  return padBankAudioCtx;
}

async function loadSampleBuffer(sampleKey) {
  if (oneShotBuffers.has(sampleKey)) return oneShotBuffers.get(sampleKey);

  const sampleData = getAllSamples().find((s) => s.soundKey === sampleKey);
  if (!sampleData) {
    console.warn(`[PadBank] Sample not found in catalog: ${sampleKey}`);
    return null;
  }
  try {
    const ctx = await getPadAudioContext();
    const res = await fetch(`/samples/${sampleData.filename}`);
    if (!res.ok) throw new Error('Not found');
    const buffer = await ctx.decodeAudioData(await res.arrayBuffer());
    oneShotBuffers.set(sampleKey, buffer);
    return buffer;
  } catch (err) {
    console.warn(`[PadBank] Failed to load sample ${sampleData.filename}:`, err);
    return null;
  }
}

async function playOneShot(sampleKey, playbackRate = 1) {
  const ctx = await getPadAudioContext();
  const buffer = await loadSampleBuffer(sampleKey);
  if (!buffer) return;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = playbackRate;
  source.connect(ctx.destination);
  source.start();
}

async function playInstrumentNote(midi) {
  try {
    await ensureStrudel();
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') await ctx.resume();
    const gain = 0.8 * (state.gain ?? 1);
    await superdough({ s: state.notePadInstrument, note: midi, gain }, ctx.currentTime + 0.05, 1);
  } catch (err) {
    console.warn(`[PadBank] Failed to play ${state.notePadInstrument}:`, err);
  }
}

function cycleNotePadInstrument() {
  const choices = MELODY_PAD_INSTRUMENTS.filter((name) => name !== state.notePadInstrument);
  state.notePadInstrument = choices[Math.floor(Math.random() * choices.length)];
  refreshPadViews();
}

function cycleNotePadSample() {
  if (renamedSamples.length === 0) return;
  const index = renamedSamples.findIndex((s) => s.soundKey === state.notePadSample);
  state.notePadSample = renamedSamples[(index + 1) % renamedSamples.length].soundKey;
  loadSampleBuffer(state.notePadSample); // warm the cache so the next hit is instant
  refreshPadViews();
}

/** Play or act on a pad in the active bank. Returns false if the pad does nothing. */
function triggerPad(padNum) {
  const bank = state.activePadBank;

  if (padNum === BANK_TOGGLE_PAD) {
    setActivePadBank(nextPadBank(bank));
    return true;
  }

  if (isNoteBank(bank)) {
    if (padNum === NOTE_BANK_CYCLE_PAD) {
      if (bank === 3) cycleNotePadInstrument();
      else cycleNotePadSample();
      return true;
    }
    const midi = currentPadNotes()[padNum - 1];
    if (midi === undefined) return false;
    if (bank === 3) {
      playInstrumentNote(midi);
      return true;
    }
    if (!state.notePadSample) return false;
    playOneShot(state.notePadSample, sampleRateForNote(midi));
    return true;
  }

  const sampleKey = state.padBanks[bank][padNum];
  if (!sampleKey) return false;
  playOneShot(sampleKey);
  return true;
}

function setActivePadBank(bank) {
  state.activePadBank = bank;
  refreshPadViews();
}

function refreshPadViews() {
  setupPadBank2Selects();
  updatePerformerTab();
}

// Note labels follow the playing chord, so redraw when it changes.
function refreshNotePadsIfChordChanged() {
  if (!isNoteBank(state.activePadBank)) return;
  if (currentPadChord() !== lastRenderedPadChord) refreshPadViews();
}

function padLabel(padNum, notes) {
  const bank = state.activePadBank;
  if (padNum === BANK_TOGGLE_PAD) return `Switch to Bank ${nextPadBank(bank)}`;
  if (isNoteBank(bank)) {
    if (padNum === NOTE_BANK_CYCLE_PAD) {
      return bank === 3
        ? `🎲 ${instrumentLabel(state.notePadInstrument)}`
        : `🎙️ ${state.notePadSample ? sampleDisplayName(state.notePadSample) : 'No renamed samples'}`;
    }
    return noteName(notes[padNum - 1]);
  }
  const sampleKey = state.padBanks[bank][padNum];
  return sampleKey ? sampleDisplayName(sampleKey) : 'Empty';
}

function padBankTitle(chord) {
  const bank = state.activePadBank;
  if (bank === 3) return `Bank 3 · ${chord} notes · ${instrumentLabel(state.notePadInstrument)}`;
  if (bank === 4) return `Bank 4 · ${chord} notes · ${state.notePadSample ? sampleDisplayName(state.notePadSample) : 'no sample'}`;
  return `Bank ${bank}`;
}

function setupPadBank2Selects() {
  const grid = document.getElementById('pad-bank-grid');
  if (!grid) return;

  const activeBankNum = state.activePadBank;
  const chord = currentPadChord();
  const notes = currentPadNotes();
  lastRenderedPadChord = chord;
  grid.innerHTML = '';

  for (const i of PAD_DISPLAY_ORDER) {
    const padNum = i + 1;
    const item = document.createElement('div');
    item.className = 'pad-bank-item';

    if (padNum === BANK_TOGGLE_PAD) {
      item.classList.add('pad-bank-toggle');
      const title = document.createElement('label');
      title.textContent = 'Pad 16 (Toggle)';
      const indicator = document.createElement('div');
      indicator.className = 'toggle-indicator';
      indicator.textContent = padLabel(padNum, notes);
      item.append(title, indicator);
      item.addEventListener('click', () => triggerPad(padNum));
      grid.appendChild(item);
      continue;
    }

    const label = document.createElement('label');
    label.innerText = `Pad ${padNum}`;

    if (isNoteBank(activeBankNum)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = padNum === NOTE_BANK_CYCLE_PAD ? 'pad-bank-note pad-bank-cycle' : 'pad-bank-note';
      button.textContent = padLabel(padNum, notes);
      button.addEventListener('click', () => triggerPad(padNum));
      item.append(label, button);
      grid.appendChild(item);
      continue;
    }

    const currentBank = state.padBanks[activeBankNum];
    const select = document.createElement('select');
    select.dataset.pad = padNum;

    const emptyOpt = document.createElement('option');
    emptyOpt.value = '';
    emptyOpt.text = 'Empty';
    select.appendChild(emptyOpt);

    getAllSamples().forEach((sample) => {
      const opt = document.createElement('option');
      opt.value = sample.soundKey;
      opt.text = sample.displayName;
      select.appendChild(opt);
    });

    select.value = currentBank[padNum] || '';

    select.addEventListener('change', (e) => {
      currentBank[padNum] = e.target.value;
      updatePadBank2SelectsUI();
      updatePerformerTab();
    });

    item.append(label, select);
    grid.appendChild(item);
  }

  for (let bank = 1; bank <= PAD_BANK_COUNT; bank++) {
    document.getElementById(`bank-toggle-${bank}`)?.classList.toggle('active', bank === activeBankNum);
  }

  const heading = document.getElementById('pad-bank-heading');
  if (heading) heading.textContent = padBankTitle(chord);

  updatePadBank2SelectsUI();
}

function updatePadBank2SelectsUI() {
  if (isNoteBank(state.activePadBank)) return;
  const selects = document.querySelectorAll('#pad-bank-grid select');
  const currentBank = state.padBanks[state.activePadBank];

  const assigned = new Set();
  for (const pad in currentBank) {
    if (currentBank[pad]) {
      assigned.add(currentBank[pad]);
    }
  }

  selects.forEach((select) => {
    const myPad = parseInt(select.dataset.pad, 10);
    const myValue = currentBank[myPad] || '';

    Array.from(select.options).forEach((opt) => {
      if (opt.value === '') return;
      opt.disabled = opt.value !== myValue && assigned.has(opt.value);
    });
  });
}

function padKind(padNum) {
  const bank = state.activePadBank;
  if (padNum === BANK_TOGGLE_PAD) return 'toggle';
  if (isNoteBank(bank)) return padNum === NOTE_BANK_CYCLE_PAD ? 'cycle' : 'note';
  return state.padBanks[bank][padNum] ? 'assigned' : 'empty';
}

/** Pad layout keyed `pad_1`…`pad_16`, shared by the performer tab, pads.html, and audience phones. */
function currentPadLayout() {
  const chord = currentPadChord();
  const notes = currentPadNotes();
  const padLabels = {};
  const padKinds = {};
  for (let pad = 1; pad <= 16; pad++) {
    padLabels[`pad_${pad}`] = padLabel(pad, notes);
    padKinds[`pad_${pad}`] = padKind(pad);
  }
  return { chord, padLabels, padKinds, bankTitle: padBankTitle(chord) };
}

export function broadcastPadSync(layout = currentPadLayout()) {
  if (!operatorWsClient) return;
  const { padLabels, padKinds, bankTitle } = layout;
  operatorWsClient.syncPads({ padLabels, padKinds, bankTitle });
}

export function updatePerformerTab() {
  const layout = currentPadLayout();
  broadcastPadSync(layout); // Tell audience phones and pad display windows about the new layout
  lastRenderedPadChord = layout.chord;

  const bankTitle = document.getElementById('performer-bank-title');
  if (bankTitle) bankTitle.innerText = layout.bankTitle;

  const grid = document.getElementById('performer-pad-grid');
  if (grid) {
    renderPadGrid(grid, { labels: layout.padLabels, kinds: layout.padKinds, onPadClick: triggerPad });
  }
}

/* ─── Audience Portal & Wi-Fi Projection Tab ───────── */
function setupAudiencePortalTab() {
  const tabBtnDashboard = document.getElementById('tab-btn-dashboard');
  const tabBtnPortal = document.getElementById('tab-btn-audience-portal');
  const tabBtnPerformer = document.getElementById('tab-btn-performer');
  const quickSwitchBtn = document.getElementById('quick-switch-audience-portal-btn');
  const contentDashboard = document.getElementById('tab-content-dashboard');
  const contentPortal = document.getElementById('tab-content-audience-portal');
  const contentPerformer = document.getElementById('tab-content-performer');

  let qrMode = 'audience-url'; // 'audience-url' | 'wifi'
  let isPasswordHidden = false;
  let currentSsid = '';
  let currentIp = location.hostname || 'localhost';
  let currentPort = location.port || 3000;

  function switchTab(target) {
    const tabs = [
      { id: 'dashboard', btn: tabBtnDashboard, content: contentDashboard, display: 'flex' },
      { id: 'audience-portal', btn: tabBtnPortal, content: contentPortal, display: 'block', onOpen: renderQrCode },
      { id: 'performer', btn: tabBtnPerformer, content: contentPerformer, display: 'block', onOpen: updatePerformerTab }
    ];

    tabs.forEach(tab => {
      const isActive = tab.id === target;
      if (tab.btn) {
        if (isActive) {
          tab.btn.classList.add('active');
          tab.btn.setAttribute('aria-selected', 'true');
        } else {
          tab.btn.classList.remove('active');
          tab.btn.setAttribute('aria-selected', 'false');
        }
      }
      
      if (tab.content) {
        tab.content.style.display = isActive ? tab.display : 'none';
      }
      
      if (isActive && tab.onOpen) {
        tab.onOpen();
      }
    });
  }

  tabBtnDashboard?.addEventListener('click', () => switchTab('dashboard'));
  tabBtnPortal?.addEventListener('click', () => switchTab('audience-portal'));
  tabBtnPerformer?.addEventListener('click', () => switchTab('performer'));
  quickSwitchBtn?.addEventListener('click', () => switchTab('audience-portal'));

  // Keyboard shortcut: Ctrl+1 (Dashboard) / Ctrl+2 (Performer) / Ctrl+3 (Audience Portal)
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey) {
      if (e.key === '1') {
        e.preventDefault();
        switchTab('dashboard');
      } else if (e.key === '2') {
        e.preventDefault();
        switchTab('performer');
      } else if (e.key === '3') {
        e.preventDefault();
        switchTab('audience-portal');
      }
    }
  });

  // ── Password Management ──
  const pwInput = document.getElementById('wifi-password-input');
  const pwDisplay = document.getElementById('wifi-password-display');
  const pwClearBtn = document.getElementById('wifi-password-clear-btn');
  const pwVisibilityBtn = document.getElementById('wifi-pw-visibility-btn');
  const copyPwBtn = document.getElementById('copy-wifi-pw-btn');

  function updatePasswordDisplay() {
    const val = pwInput ? pwInput.value.trim() : '';
    if (!pwDisplay) return;

    if (!val) {
      pwDisplay.textContent = 'No password required / None set';
      pwDisplay.classList.add('empty');
    } else {
      pwDisplay.classList.remove('empty');
      if (isPasswordHidden) {
        pwDisplay.textContent = '•'.repeat(Math.min(val.length, 16));
      } else {
        pwDisplay.textContent = val;
      }
    }

    if (qrMode === 'wifi') {
      renderQrCode();
    }
  }

  // Restore saved password from localStorage
  const savedPw = localStorage.getItem('strudel_wifi_password') || '';
  if (pwInput && savedPw) {
    pwInput.value = savedPw;
  }
  updatePasswordDisplay();

  pwInput?.addEventListener('input', () => {
    localStorage.setItem('strudel_wifi_password', pwInput.value);
    updatePasswordDisplay();
  });

  pwClearBtn?.addEventListener('click', () => {
    if (pwInput) pwInput.value = '';
    localStorage.removeItem('strudel_wifi_password');
    updatePasswordDisplay();
  });

  pwVisibilityBtn?.addEventListener('click', () => {
    isPasswordHidden = !isPasswordHidden;
    if (pwVisibilityBtn) {
      pwVisibilityBtn.textContent = isPasswordHidden ? '👁️ Show on Screen' : '👁️ Hide on Screen';
    }
    updatePasswordDisplay();
  });

  copyPwBtn?.addEventListener('click', async () => {
    const val = pwInput ? pwInput.value : '';
    if (val && navigator.clipboard) {
      await navigator.clipboard.writeText(val);
      const prev = copyPwBtn.textContent;
      copyPwBtn.textContent = '✓ Copied!';
      setTimeout(() => { copyPwBtn.textContent = prev; }, 1500);
    }
  });

  // ── Wi-Fi SSID Management ──
  const ssidDisplay = document.getElementById('wifi-ssid-display');
  const ssidEditToggle = document.getElementById('wifi-ssid-edit-toggle');
  const ssidEditBox = document.getElementById('wifi-ssid-edit-box');
  const ssidInput = document.getElementById('wifi-ssid-input');
  const ssidSaveBtn = document.getElementById('wifi-ssid-save-btn');
  const ssidCancelBtn = document.getElementById('wifi-ssid-cancel-btn');

  function updateSsidDisplay(ssid) {
    currentSsid = ssid || '';
    if (ssidDisplay) {
      ssidDisplay.textContent = currentSsid || 'Not detected (Wired or Offline)';
    }
    if (qrMode === 'wifi') {
      renderQrCode();
    }
  }

  ssidEditToggle?.addEventListener('click', () => {
    if (!ssidEditBox) return;
    const isHidden = ssidEditBox.style.display === 'none';
    ssidEditBox.style.display = isHidden ? 'flex' : 'none';
    if (isHidden && ssidInput) {
      ssidInput.value = currentSsid;
      ssidInput.focus();
    }
  });

  ssidSaveBtn?.addEventListener('click', () => {
    if (ssidInput) {
      const custom = ssidInput.value.trim();
      localStorage.setItem('strudel_custom_ssid', custom);
      updateSsidDisplay(custom);
    }
    if (ssidEditBox) ssidEditBox.style.display = 'none';
  });

  ssidCancelBtn?.addEventListener('click', () => {
    if (ssidEditBox) ssidEditBox.style.display = 'none';
  });

  // ── URL & Network Interfaces ──
  const urlLink = document.getElementById('audience-url-link');
  const copyUrlBtn = document.getElementById('copy-url-btn');
  const interfacesContainer = document.getElementById('network-interfaces-container');
  const interfacesSelect = document.getElementById('network-interfaces-select');
  const refreshBtn = document.getElementById('portal-refresh-btn');

  function getAudienceUrl() {
    const ip = currentIp || location.hostname || 'localhost';
    const port = currentPort || location.port || 3000;
    return `http://${ip}:${port}/audience.html`;
  }

  function updateUrlDisplay() {
    const url = getAudienceUrl();
    if (urlLink) {
      urlLink.href = url;
      urlLink.textContent = url;
    }
    renderQrCode();
  }

  copyUrlBtn?.addEventListener('click', async () => {
    const url = getAudienceUrl();
    if (url && navigator.clipboard) {
      await navigator.clipboard.writeText(url);
      const prev = copyUrlBtn.textContent;
      copyUrlBtn.textContent = '✓ Copied!';
      setTimeout(() => { copyUrlBtn.textContent = prev; }, 1500);
    }
  });

  interfacesSelect?.addEventListener('change', () => {
    currentIp = interfacesSelect.value;
    updateUrlDisplay();
  });

  // ── QR Code Rendering ──
  const qrCanvas = document.getElementById('audience-qr-canvas');
  const qrLabelText = document.getElementById('qr-scan-label-text');
  const toggleQrModeBtn = document.getElementById('toggle-qr-wifi-mode-btn');

  function renderQrCode() {
    if (!qrCanvas) return;

    let payload = '';
    if (qrMode === 'audience-url') {
      payload = getAudienceUrl();
      if (qrLabelText) qrLabelText.textContent = '📷 Point phone camera at QR code';
      if (toggleQrModeBtn) toggleQrModeBtn.textContent = '📶 Switch to Wi-Fi Join QR';
    } else {
      // Standard Wi-Fi QR format: WIFI:S:<SSID>;T:<WPA|nopass>;P:<PASSWORD>;;
      const pw = pwInput ? pwInput.value.trim() : '';
      const authType = pw ? 'WPA' : 'nopass';
      payload = `WIFI:S:${currentSsid};T:${authType};P:${pw};;`;
      if (qrLabelText) qrLabelText.textContent = `📶 Scan to join "${currentSsid || 'Wi-Fi'}" directly`;
      if (toggleQrModeBtn) toggleQrModeBtn.textContent = '🌐 Switch to Audience Site QR';
    }

    try {
      QRCode.toCanvas(qrCanvas, payload, {
        width: 280,
        margin: 2,
        color: {
          dark: '#0f172a',
          light: '#ffffff',
        },
        errorCorrectionLevel: 'M',
      }, (err) => {
        if (err) console.error('[QR] Error rendering QR code:', err);
      });
    } catch (err) {
      console.error('[QR] Render exception:', err);
    }
  }

  toggleQrModeBtn?.addEventListener('click', () => {
    qrMode = qrMode === 'audience-url' ? 'wifi' : 'audience-url';
    renderQrCode();
  });

  // ── Fetch Network Info from Server ──
  async function fetchNetworkInfo() {
    try {
      if (ssidDisplay) ssidDisplay.textContent = 'Refreshing network info…';
      const res = await fetch('/api/network-info');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      // Check if user set a custom SSID override
      const customSsid = localStorage.getItem('strudel_custom_ssid');
      updateSsidDisplay(customSsid || data.ssid);

      if (data.port) currentPort = data.port;
      if (data.primaryIp) currentIp = data.primaryIp;

      // Populate interface dropdown if available
      if (data.interfaces && data.interfaces.length > 0) {
        if (interfacesSelect) {
          interfacesSelect.innerHTML = '';
          data.interfaces.forEach((iface) => {
            const opt = document.createElement('option');
            opt.value = iface.address;
            opt.textContent = `${iface.name} (${iface.address})`;
            if (iface.address === currentIp) opt.selected = true;
            interfacesSelect.appendChild(opt);
          });
          if (data.interfaces.length > 1 && interfacesContainer) {
            interfacesContainer.style.display = 'flex';
          }
        }
      }

      updateUrlDisplay();
    } catch (err) {
      console.warn('[dashboard] Failed to fetch /api/network-info:', err);
      if (ssidDisplay) ssidDisplay.textContent = 'Wi-Fi detection unavailable (offline)';
      updateUrlDisplay();
    }
  }

  refreshBtn?.addEventListener('click', () => fetchNetworkInfo());
  fetchNetworkInfo();

  // ── Fullscreen Projector Toggle ──
  const fullscreenBtn = document.getElementById('portal-fullscreen-btn');
  fullscreenBtn?.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      contentPortal?.requestFullscreen?.().catch((err) => {
        console.warn('[dashboard] Fullscreen error:', err);
      });
    } else {
      document.exitFullscreen?.();
    }
  });

  document.addEventListener('fullscreenchange', () => {
    if (fullscreenBtn) {
      fullscreenBtn.textContent = document.fullscreenElement ? '✕ Exit Fullscreen' : '⛶ Fullscreen Projector';
    }
  });
}

/* ─── Init ─────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  // Setup Audience Portal & Wi-Fi Tab
  setupAudiencePortalTab();
  // ── Piano roll canvas resolution fix ────────────────
  // #test-canvas must have pixel-accurate .width/.height attributes so our
  // custom drawPianoRollFrame() renders at native resolution on retina screens.
  const pianoCanvas = document.getElementById('test-canvas');
  if (pianoCanvas) {
    const dpr = window.devicePixelRatio || 1;
    const syncCanvasSize = () => {
      const rect = pianoCanvas.getBoundingClientRect();
      pianoCanvas.width = Math.round(rect.width * dpr);
      pianoCanvas.height = Math.round(rect.height * dpr);
    };
    syncCanvasSize();
    const ro = new ResizeObserver(syncCanvasSize);
    ro.observe(pianoCanvas);
  }

  createArrangement(state);

  // Initialize Sample Editor, Recorder & Audience Bridge
  initSampleEditor();
  initSampleRecorder();
  
  // Pre-load catalog so dropdowns aren't empty initially
  loadCatalog(true).then(async () => {
    setupInstrumentSelects();
    await refreshRenamedSamples();
    assignDefaultSampleBanks();
    setupPadBank2Selects();
    updatePerformerTab();
    updateReadouts();
  });

  setupAudienceBridge();
  setOnCatalogUpdated(async (oldName, newName) => {
    await loadCatalog(true); // Force a refresh of the catalog

    if (oldName && newName) {
      // Update any instruments using the old name
      if (state.sampleBanks) {
        Object.keys(state.sampleBanks).forEach(k => {
          if (state.sampleBanks[k] === oldName) state.sampleBanks[k] = newName;
        });
      }
      if (state.instruments) {
        Object.keys(state.instruments).forEach(k => {
          if (state.instruments[k] === oldName) state.instruments[k] = newName;
        });
      }
      // Update any pads using the old name
      if (state.padBanks) {
        [1, 2].forEach(bank => {
          if (state.padBanks[bank]) {
            Object.keys(state.padBanks[bank]).forEach(pad => {
              if (state.padBanks[bank][pad] === oldName) state.padBanks[bank][pad] = newName;
            });
          }
        });
      }
      if (state.notePadSample === oldName) state.notePadSample = newName;
    }

    await refreshRenamedSamples();
    setupInstrumentSelects();
    setupPadBank2Selects();
    updatePerformerTab();
    updateReadouts();
    debouncedRestart();
  });

  for (let bank = 1; bank <= PAD_BANK_COUNT; bank++) {
    document.getElementById(`bank-toggle-${bank}`)?.addEventListener('click', () => setActivePadBank(bank));
  }
  // A named popup so repeat clicks re-focus the same window instead of opening more.
  document.getElementById('open-pad-display-btn')?.addEventListener('click', () => {
    window.open('/pads.html', 'strudel-pad-display', 'popup,width=1280,height=860')?.focus();
  });
  setInterval(refreshNotePadsIfChordChanged, 100);

  // Initialize MIDI
  initMIDI({
    getState: (key) => state[key],
    onParameterChange: updateParameter,
    onAction: handleAction,
    onStatusUpdate: (text, deviceNames = '') => {
      const el = document.getElementById('midi-status-display');
      if (!el) return;
      el.innerText = text;
      el.title = deviceNames;
    },
    onRawMessage: (msg) => {
      const el = document.getElementById('midi-last-cmd-display');
      if (el) el.innerText = `Last MIDI: ${msg}`;
    }
  });

  // Sliders
  bindSlider('gain-slider', 'gain', (v) => `Gain: ${v.toFixed(2)}`);
  bindSlider('speed-slider', 'speed', (v) => `Speed: ${v.toFixed(2)}`);
  bindSlider('cpm-slider', 'cpm', (v) => `CPM: ${v}`, { integer: true });

  // Per-layer gains
  bindSlider('drums-gain-slider', 'drumsGain', (v) => `Drums: ${v.toFixed(2)}`);
  bindSlider('chords-gain-slider', 'chordsGain', (v) => `Chords: ${v.toFixed(2)}`);
  bindSlider('bass-gain-slider', 'bassGain', (v) => `Bass: ${v.toFixed(2)}`);
  bindSlider('melody-gain-slider', 'melodyGain', (v) => `Lead: ${v.toFixed(2)}`);

  // Comprehensive Track Effects
  bindSlider('melody-pan-slider', 'melodyPan', (v) => `${v.toFixed(2)}`);
  bindSlider('melody-delay-slider', 'melodyDelay', (v) => `${v.toFixed(2)}`);
  bindSlider('melody-lpf-slider', 'melodyLpf', (v) => `${v}`, { integer: true });
  bindSlider('melody-hpf-slider', 'melodyHpf', (v) => `${v}`, { integer: true });
  bindSlider('melody-room-slider', 'melodyRoom', (v) => `${v.toFixed(2)}`);
  bindSlider('melody-distort-slider', 'melodyDistort', (v) => `${v.toFixed(2)}`);
  bindSlider('melody-attack-slider', 'melodyAttack', (v) => `${v.toFixed(2)}`);
  bindSlider('melody-decay-slider', 'melodyDecay', (v) => `${v.toFixed(2)}`);
  bindSlider('melody-sustain-slider', 'melodySustain', (v) => `${v.toFixed(2)}`);
  bindSlider('melody-release-slider', 'melodyRelease', (v) => `${v.toFixed(2)}`);
  bindSlider('chords-pan-slider', 'chordsPan', (v) => `${v.toFixed(2)}`);
  bindSlider('chords-delay-slider', 'chordsDelay', (v) => `${v.toFixed(2)}`);
  bindSlider('chords-lpf-slider', 'chordsLpf', (v) => `${v}`, { integer: true });
  bindSlider('chords-hpf-slider', 'chordsHpf', (v) => `${v}`, { integer: true });
  bindSlider('chords-room-slider', 'chordsRoom', (v) => `${v.toFixed(2)}`);
  bindSlider('chords-distort-slider', 'chordsDistort', (v) => `${v.toFixed(2)}`);
  bindSlider('chords-attack-slider', 'chordsAttack', (v) => `${v.toFixed(2)}`);
  bindSlider('chords-decay-slider', 'chordsDecay', (v) => `${v.toFixed(2)}`);
  bindSlider('chords-sustain-slider', 'chordsSustain', (v) => `${v.toFixed(2)}`);
  bindSlider('chords-release-slider', 'chordsRelease', (v) => `${v.toFixed(2)}`);
  bindSlider('bass-pan-slider', 'bassPan', (v) => `${v.toFixed(2)}`);
  bindSlider('bass-delay-slider', 'bassDelay', (v) => `${v.toFixed(2)}`);
  bindSlider('bass-lpf-slider', 'bassLpf', (v) => `${v}`, { integer: true });
  bindSlider('bass-hpf-slider', 'bassHpf', (v) => `${v}`, { integer: true });
  bindSlider('bass-room-slider', 'bassRoom', (v) => `${v.toFixed(2)}`);
  bindSlider('bass-distort-slider', 'bassDistort', (v) => `${v.toFixed(2)}`);
  bindSlider('bass-attack-slider', 'bassAttack', (v) => `${v.toFixed(2)}`);
  bindSlider('bass-decay-slider', 'bassDecay', (v) => `${v.toFixed(2)}`);
  bindSlider('bass-sustain-slider', 'bassSustain', (v) => `${v.toFixed(2)}`);
  bindSlider('bass-release-slider', 'bassRelease', (v) => `${v.toFixed(2)}`);
  bindSlider('drums-pan-slider', 'drumsPan', (v) => `${v.toFixed(2)}`);
  bindSlider('drums-delay-slider', 'drumsDelay', (v) => `${v.toFixed(2)}`);
  bindSlider('drums-lpf-slider', 'drumsLpf', (v) => `${v}`, { integer: true });
  bindSlider('drums-hpf-slider', 'drumsHpf', (v) => `${v}`, { integer: true });
  bindSlider('drums-room-slider', 'drumsRoom', (v) => `${v.toFixed(2)}`);
  bindSlider('drums-distort-slider', 'drumsDistort', (v) => `${v.toFixed(2)}`);
  bindSlider('drums-attack-slider', 'drumsAttack', (v) => `${v.toFixed(2)}`);
  bindSlider('drums-decay-slider', 'drumsDecay', (v) => `${v.toFixed(2)}`);
  bindSlider('drums-sustain-slider', 'drumsSustain', (v) => `${v.toFixed(2)}`);
  bindSlider('drums-release-slider', 'drumsRelease', (v) => `${v.toFixed(2)}`);

  // Layer mutes
  bindToggle('toggle-drums', 'drumsOn');
  bindToggle('toggle-chords', 'chordsOn');
  bindToggle('toggle-bass', 'bassOn');
  bindToggle('toggle-melody', 'melodyOn');

  // Track Pitch Controls (Independent Steps & Octaves)
  bindTrackPitchControls();


  // ── Editor Zoom & Wrap ──────────────────────────────────
  const wrapBtn = document.getElementById('editor-wrap-btn');
  const zoomInBtn = document.getElementById('editor-zoom-in-btn');
  const zoomOutBtn = document.getElementById('editor-zoom-out-btn');
  const replHost = document.querySelector('.repl-host');
  let currentFontSize = 14;

  if (wrapBtn && replHost) {
    wrapBtn.addEventListener('click', () => {
      replHost.classList.toggle('wrap-text');
      wrapBtn.classList.toggle('active');
    });
  }
  if (zoomInBtn && replHost) {
    zoomInBtn.addEventListener('click', () => {
      currentFontSize = Math.min(32, currentFontSize + 2);
      document.documentElement.style.setProperty('--editor-font-size', `${currentFontSize}px`);
    });
  }
  if (zoomOutBtn && replHost) {
    zoomOutBtn.addEventListener('click', () => {
      currentFontSize = Math.max(8, currentFontSize - 2);
      document.documentElement.style.setProperty('--editor-font-size', `${currentFontSize}px`);
    });
  }

  // ── Effect Resets ─────────────────────────────
  function setupEffectResets() {
    const defaults = {
      drums: { Pan: 0.5, Delay: 0, Lpf: 20000, Hpf: 0, Room: 0, Distort: 0, Attack: 0.01, Decay: 0.1, Sustain: 1.0, Release: 0.1 },
      chords: { Pan: 0.5, Delay: 0, Lpf: 1100, Hpf: 0, Room: 0.4, Distort: 0, Attack: 0.01, Decay: 0.1, Sustain: 1.0, Release: 0.1 },
      bass: { Pan: 0.5, Delay: 0, Lpf: 500, Hpf: 0, Room: 0, Distort: 0, Attack: 0.01, Decay: 0.1, Sustain: 1.0, Release: 0.1 },
      melody: { Pan: 0.5, Delay: 0.3, Lpf: 20000, Hpf: 0, Room: 0, Distort: 0, Attack: 0.01, Decay: 0.1, Sustain: 1.0, Release: 0.1 }
    };
    
    ['drums', 'chords', 'bass', 'melody'].forEach(track => {
      const btn = document.getElementById(`reset-${track}-effects`);
      if (btn) {
        btn.addEventListener('click', (e) => {
          e.stopPropagation(); // prevent accordion toggle
          e.preventDefault();
          
          const trackDefs = defaults[track];
          for (const [key, val] of Object.entries(trackDefs)) {
            state[`${track}${key}`] = val;
            
            // update slider UI
            const input = document.getElementById(`${track}-${key.toLowerCase()}-slider`);
            if (input) {
              input.value = val;
              // trigger input event to update display
              input.dispatchEvent(new Event('input'));
            }
          }
          debouncedRestart();
        });
      }
    });
  }
  setupEffectResets();


  // ── Time signature select ─────────────────────────
  const timeSigSelect = document.getElementById('time-sig-select');
  if (timeSigSelect) {
    timeSigSelect.addEventListener('change', async (e) => {
      applyTimeSignature(e.target.value);
      console.info(`[dashboard] Time signature changed to ${e.target.value}`);
      // Regenerate all patterns so note counts work with the new feel,
      // then restart playback with the new .slow() values.
      await regenerate({ regenChords: true, regenMelody: true, regenBass: true });
    });
  }

  // Regenerate buttons
  document.getElementById('regen-all')?.addEventListener('click', () =>
    regenerate({ regenChords: true, regenMelody: true, regenBass: true, regenDrums: true, randomizeSettings: true }),
  );
  document.getElementById('regen-chords')?.addEventListener('click', () =>
    regenerate({ regenChords: true, regenMelody: false, regenBass: false, regenDrums: false }),
  );
  document.getElementById('regen-melody')?.addEventListener('click', () =>
    regenerate({ regenChords: false, regenMelody: true, regenBass: false, regenDrums: false, randomizeMelodySettings: true }),
  );
  document.getElementById('regen-bass')?.addEventListener('click', () =>
    regenerate({ regenChords: false, regenMelody: false, regenBass: true, regenDrums: false, randomizeBassSettings: true }),
  );
  document.getElementById('regen-drums')?.addEventListener('click', () =>
    regenerate({ regenChords: false, regenMelody: false, regenBass: false, regenDrums: true, randomizeDrumsSettings: true }),
  );

  // ── Note Density controls ──────────────────────────
  // Each track: ÷2, −, display, +, ×2
  // Melody/bass density changes trigger a partial regen (note count changes).
  // Drums density only adjusts the slow() factor (no regen needed).
  function bindDensityControls({ track, stateKey, displayId, minVal, maxVal, regenOpts }) {
    const display = document.getElementById(displayId);
    const refresh = () => {
      if (display) display.innerText = state[stateKey];
    };
    refresh(); // init display

    const clamp = (v) => Math.max(minVal, Math.min(maxVal, v));

    const apply = async (newVal) => {
      state[stateKey] = clamp(newVal);
      refresh();
      // Melody/bass: regenerate that track's note sequence with the new length
      if (regenOpts) {
        createArrangement(state, regenOpts);
        updateReadouts();
      }
      debouncedRestart();
    };

    document.getElementById(`${track}-density-half`)?.addEventListener('click',   () => apply(Math.ceil(state[stateKey] / 2)));
    document.getElementById(`${track}-density-down`)?.addEventListener('click',   () => apply(state[stateKey] - 1));
    document.getElementById(`${track}-density-up`)?.addEventListener('click',     () => apply(state[stateKey] + 1));
    document.getElementById(`${track}-density-double`)?.addEventListener('click', () => apply(state[stateKey] * 2));
  }

  bindDensityControls({
    track: 'melody', stateKey: 'melodyDensity', displayId: 'melody-density-display',
    minVal: 1, maxVal: 128,
    regenOpts: { regenChords: false, regenMelody: true, regenBass: false, regenDrums: false },
  });
  bindDensityControls({
    track: 'bass', stateKey: 'bassDensity', displayId: 'bass-density-display',
    minVal: 1, maxVal: 128,
    regenOpts: { regenChords: false, regenMelody: false, regenBass: true, regenDrums: false },
  });
  bindDensityControls({
    track: 'drums', stateKey: 'drumsDensity', displayId: 'drums-density-display',
    minVal: 1, maxVal: 128,
    regenOpts: { regenChords: false, regenMelody: false, regenBass: false, regenDrums: true },
  });

  // ── Octave Range controls ──────────────────────────
  // 1 = Current octave
  // 3 = Current octave ± 1 octave
  // 5 = Current octave ± 2 octaves
  const OCTAVE_RANGES = [1, 3, 5];

  function bindOctaveRangeControls({ track, stateKey, displayId, regenOpts }) {
    const display = document.getElementById(displayId);
    const btnDown = document.getElementById(`${track}-oct-range-down`);
    const btnUp = document.getElementById(`${track}-oct-range-up`);
    const pills = [1, 3, 5].map((r) => ({
      range: r,
      el: document.getElementById(`${track}-oct-range-${r}`),
    }));

    const getLabel = (val) => {
      if (val === 5) return '5 Oct (±2 Oct)';
      if (val === 3) return '3 Oct (±1 Oct)';
      return '1 Oct (Current)';
    };

    const refresh = () => {
      const current = state[stateKey] || 1;
      if (display) {
        display.innerText = getLabel(current);
      }
      pills.forEach(({ range, el }) => {
        if (el) {
          el.classList.toggle('active', range === current);
        }
      });
    };

    const apply = (newVal) => {
      if (!OCTAVE_RANGES.includes(newVal)) return;
      state[stateKey] = newVal;
      refresh();
      // Regenerate track arrangement with new octave range
      if (regenOpts) {
        createArrangement(state, regenOpts);
        updateReadouts();
      }
      debouncedRestart();
    };

    const stepDown = () => {
      const idx = OCTAVE_RANGES.indexOf(state[stateKey] || 1);
      if (idx > 0) {
        apply(OCTAVE_RANGES[idx - 1]);
      }
    };

    const stepUp = () => {
      const idx = OCTAVE_RANGES.indexOf(state[stateKey] || 1);
      if (idx < OCTAVE_RANGES.length - 1) {
        apply(OCTAVE_RANGES[idx + 1]);
      }
    };

    const cycle = () => {
      const idx = OCTAVE_RANGES.indexOf(state[stateKey] || 1);
      const nextIdx = (idx + 1) % OCTAVE_RANGES.length;
      apply(OCTAVE_RANGES[nextIdx]);
    };

    btnDown?.addEventListener('click', stepDown);
    btnUp?.addEventListener('click', stepUp);
    display?.addEventListener('click', cycle);

    pills.forEach(({ range, el }) => {
      el?.addEventListener('click', () => apply(range));
    });

    refresh();
  }

  bindOctaveRangeControls({
    track: 'melody',
    stateKey: 'melodyOctaveRange',
    displayId: 'melody-oct-range-display',
    regenOpts: { regenChords: false, regenMelody: true, regenBass: false, regenDrums: false },
  });

  bindOctaveRangeControls({
    track: 'bass',
    stateKey: 'bassOctaveRange',
    displayId: 'bass-oct-range-display',
    regenOpts: { regenChords: false, regenMelody: false, regenBass: true, regenDrums: false },
  });

  // ── Generative Settings controls ─────────────────────
  const chordStyleSelect = document.getElementById('chord-style-select');
  if (chordStyleSelect) {
    chordStyleSelect.value = state.chordStyle || 'sustained';
    chordStyleSelect.addEventListener('change', (e) => {
      state.chordStyle = e.target.value;
      debouncedRestart();
    });
  }

  const chordProgLengthSelect = document.getElementById('chord-prog-length-select');
  if (chordProgLengthSelect) {
    chordProgLengthSelect.value = state.chordProgressionLength || '4';
    chordProgLengthSelect.addEventListener('change', (e) => {
      state.chordProgressionLength = e.target.value;
      createArrangement(state, { regenChords: true, regenMelody: false, regenBass: false, regenDrums: false });
      updateReadouts();
      debouncedRestart();
    });
  }

  const scaleModeSelect = document.getElementById('scale-mode-select');
  if (scaleModeSelect) {
    scaleModeSelect.value = state.scaleMode || 'minor';
    scaleModeSelect.addEventListener('change', (e) => {
      state.scaleMode = e.target.value;
      createArrangement(state, { regenChords: true, regenMelody: true, regenBass: true, regenDrums: false });
      updateReadouts();
      debouncedRestart();
    });
  }

  const startBtn = document.getElementById('start-btn');
  if (startBtn) {
    startBtn.addEventListener('click', async () => {
      if (started) {
        updateDebugStatus('Start clicked but already playing');
        return;
      }
      updateDebugStatus('Start clicked');
      startBtn.disabled = true;
      setStatus('Loading…');
      updateReadouts();
      try {
        await ensureStrudel();
        await playPattern();
        started = true;
        setStatus('Playing');
        updateDebugStatus('Playback started successfully');
      } catch (err) {
        console.error(err);
        updateDebugStatus(`Start error: ${err.message || err}`);
        setStatus(`Error: ${err.message || err}`);
        startBtn.disabled = false;
        return;
      }
      startBtn.disabled = false;
      updateReadouts();
    });
  }

  // Transport: Stop
  const stopBtn = document.getElementById('stop-btn');
  if (stopBtn) {
    stopBtn.addEventListener('click', async () => {
      if (!started) return;
      await stopPattern();
      started = false;
      setStatus('Stopped');
      updateReadouts();
    });
  }

  // Initial readout + 1 Hz poll
  updateReadouts();
  setInterval(updateReadouts, 1000);
});
