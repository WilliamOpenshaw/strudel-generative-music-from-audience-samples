import { initStrudel, evaluate, hush, samples, noteToMidi } from '@strudel/web';
import { Drawer } from '@strudel/draw';
import '@strudel/repl'; // registers <strudel-editor> custom element (code display only)
import { state, setStatus } from './src/state.js';
import { createArrangement, buildStrudelCode } from './src/patterns/generative.js';
import { loadCatalog, applyCatalogToState, getAllSamples } from './src/samples/catalog.js';
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

async function ensureStrudel() {
  if (strudelReady) {
    updateDebugStatus('Strudel already initialized');
    return;
  }

  updateDebugStatus('Initializing Strudel...');
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
          await samples(`${window.location.origin}/strudel.json`);
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
    if (key === 'all') regenerate({ regenChords: true, regenMelody: true, regenBass: true, regenDrums: true });
    if (key === 'chords') regenerate({ regenChords: true, regenMelody: false, regenBass: false, regenDrums: false });
    if (key === 'bass') regenerate({ regenChords: false, regenMelody: false, regenBass: true, regenDrums: false });
    if (key === 'melody') regenerate({ regenChords: false, regenMelody: true, regenBass: false, regenDrums: false });
    if (key === 'drums') regenerate({ regenChords: false, regenMelody: false, regenBass: false, regenDrums: true });
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
  const scheduler = replEl?.editor?.repl?.scheduler || globalRepl?.scheduler;
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

async function regenerate(options) {
  createArrangement(state, options);
  updateReadouts();
  // Use playPattern() directly so the new arrangement lands at the next
  // cycle boundary without stopping the clock.
  if (started) await playPattern();
}

/* ─── Transpose (buttons + keyboard shortcut) ──────── */
function bindTransposeControls() {
  const down = document.getElementById('transpose-down');
  const up = document.getElementById('transpose-up');
  const apply = async (delta) => {
    state.transpose += delta;
    updateReadouts();
    if (started) await restartPattern();
  };
  if (down) down.addEventListener('click', () => apply(-1));
  if (up) up.addEventListener('click', () => apply(1));

  if (window._strudelKeyHandler) {
    document.removeEventListener('keydown', window._strudelKeyHandler);
  }
  window._strudelKeyHandler = (e) => {
    if (!e.ctrlKey) return;
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      apply(1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      apply(-1);
    }
  };
  document.addEventListener('keydown', window._strudelKeyHandler);
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

    downStep?.addEventListener('click', () => applyStep(-1));
    upStep?.addEventListener('click', () => applyStep(1));

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

  const wsClient = initOperatorWS({
    onStatus: ({ connected, audienceCount }) => {
      if (countBadge) countBadge.textContent = audienceCount;
      if (statusPill) statusPill.textContent = connected ? `👥 ${audienceCount} connected` : '⚠️ Disconnected';
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
      if (action === 'more_energy') {
        state.cpm = Math.min(180, state.cpm + 5);
        const cpmSlider = document.getElementById('cpm-slider');
        if (cpmSlider) cpmSlider.value = state.cpm;
        showToast(`🔥 Audience: More Energy! (CPM: ${state.cpm})`);
        updateReadouts();
        debouncedRestart();
      } else if (action === 'calmer') {
        state.cpm = Math.max(60, state.cpm - 5);
        const cpmSlider = document.getElementById('cpm-slider');
        if (cpmSlider) cpmSlider.value = state.cpm;
        showToast(`🌊 Audience: Calmer... (CPM: ${state.cpm})`);
        updateReadouts();
        debouncedRestart();
      } else if (action === 'new_chords') {
        showToast(`🎵 Audience: New Chords!`);
        regenerate({ regenChords: true, regenMelody: false, regenBass: false });
      } else if (action === 'weird') {
        const delaySlider = document.getElementById('melody-delay-slider');
        const roomSlider = document.getElementById('chords-room-slider');
        state.melodyDelay = +(Math.random() * 0.6 + 0.2).toFixed(2);
        state.chordsRoom = +(Math.random() * 0.7 + 0.3).toFixed(2);
        if (delaySlider) delaySlider.value = state.melodyDelay;
        if (roomSlider) roomSlider.value = state.chordsRoom;
        showToast(`✨ Audience: Got Weird! (Delay: ${state.melodyDelay}, Room: ${state.chordsRoom})`);
        updateReadouts();
        debouncedRestart();
      }
    },
  });

  // Bind operator lock toggle buttons
  document.querySelectorAll('.lock-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      if (action && wsClient) {
        wsClient.toggleLock(action);
      }
    });
  });
}

/* ─── Init ─────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
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
  setupInstrumentSelects();
  setupAudienceBridge();
  setOnCatalogUpdated(() => {
    setupInstrumentSelects();
    updateReadouts();
  });

  // Initialize MIDI
  initMIDI({
    onParameterChange: updateParameter,
    onAction: handleAction,
    onStatusUpdate: (text) => {
      const el = document.getElementById('midi-status-display');
      if (el) el.innerText = text;
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

  // Effects
  bindSlider('chords-lpf-slider', 'chordsLpf', (v) => `Chords LPF: ${v} Hz`, { integer: true });
  bindSlider('chords-room-slider', 'chordsRoom', (v) => `Chords Room: ${v.toFixed(2)}`);
  bindSlider('bass-lpf-slider', 'bassLpf', (v) => `Bass LPF: ${v} Hz`, { integer: true });
  bindSlider('melody-delay-slider', 'melodyDelay', (v) => `Lead Delay: ${v.toFixed(2)}`);

  // Layer mutes
  bindToggle('toggle-drums', 'drumsOn');
  bindToggle('toggle-chords', 'chordsOn');
  bindToggle('toggle-bass', 'bassOn');
  bindToggle('toggle-melody', 'melodyOn');

  // Transpose (Global + Per-track independent)
  bindTransposeControls();
  bindTrackPitchControls();

  // ── Time signature select ─────────────────────────
  const timeSigSelect = document.getElementById('time-sig-select');
  const timeSigDisplay = document.getElementById('time-sig-display');
  if (timeSigSelect) {
    timeSigSelect.addEventListener('change', async (e) => {
      const [num, den] = e.target.value.split('/').map(Number);
      state.timeSigNum = num;
      state.timeSigDen = den;
      if (timeSigDisplay) timeSigDisplay.innerText = `${num}/${den}`;
      console.info(`[dashboard] Time signature changed to ${num}/${den}`);
      // Regenerate all patterns so note counts work with the new feel,
      // then restart playback with the new .slow() values.
      await regenerate({ regenChords: true, regenMelody: true, regenBass: true });
    });
  }

  // Regenerate buttons
  document.getElementById('regen-all')?.addEventListener('click', () =>
    regenerate({ regenChords: true, regenMelody: true, regenBass: true, regenDrums: true }),
  );
  document.getElementById('regen-chords')?.addEventListener('click', () =>
    regenerate({ regenChords: true, regenMelody: false, regenBass: false, regenDrums: false }),
  );
  document.getElementById('regen-melody')?.addEventListener('click', () =>
    regenerate({ regenChords: false, regenMelody: true, regenBass: false, regenDrums: false }),
  );
  document.getElementById('regen-bass')?.addEventListener('click', () =>
    regenerate({ regenChords: false, regenMelody: false, regenBass: true, regenDrums: false }),
  );
  document.getElementById('regen-drums')?.addEventListener('click', () =>
    regenerate({ regenChords: false, regenMelody: false, regenBass: false, regenDrums: true }),
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
    minVal: 1, maxVal: 64,
    regenOpts: { regenChords: false, regenMelody: true, regenBass: false, regenDrums: false },
  });
  bindDensityControls({
    track: 'bass', stateKey: 'bassDensity', displayId: 'bass-density-display',
    minVal: 1, maxVal: 32,
    regenOpts: { regenChords: false, regenMelody: false, regenBass: true, regenDrums: false },
  });
  bindDensityControls({
    track: 'drums', stateKey: 'drumsDensity', displayId: 'drums-density-display',
    minVal: 1, maxVal: 64,
    regenOpts: { regenChords: false, regenMelody: false, regenBass: false, regenDrums: true },
  });

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

