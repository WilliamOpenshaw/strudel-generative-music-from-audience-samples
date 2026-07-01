import { initStrudel, evaluate, hush, samples } from '@strudel/web';
import { state, setStatus } from './src/state.js';
import { createArrangement, buildStrudelCode } from './src/patterns/generative.js';
import { loadCatalog, applyCatalogToState, sampleAvailability } from './src/samples/catalog.js';
import { initMIDI } from './src/midi/midi.js';

let started = false;
let strudelReady = false;

async function ensureStrudel() {
  if (strudelReady) return;
  await initStrudel({
    prebake: async () => {
      await samples('github:tidalcycles/dirt-samples');
      const availability = await loadCatalog();
      applyCatalogToState(state);
      
      // If any audience samples exist, load them from the local server
      if (availability.lead || availability.bass || availability.chord || availability.drum) {
        try {
          await samples(window.location.origin);
        } catch (err) {
          console.warn('[dashboard] Failed to load local samples:', err);
        }
      }
    },
  });
  strudelReady = true;
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
    await restartPattern();
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
    if (key === 'all') regenerate({ regenChords: true, regenMelody: true, regenBass: true });
    if (key === 'chords') regenerate({ regenChords: true, regenMelody: false, regenBass: false });
    if (key === 'bass') regenerate({ regenChords: false, regenMelody: false, regenBass: true });
    if (key === 'melody') regenerate({ regenChords: false, regenMelody: true, regenBass: false });
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
    'bank-lead-display': () => `Lead Bank: ${state.sampleBanks.lead || 'Synth (triangle)'}`,
    'bank-bass-display': () => `Bass Bank: ${state.sampleBanks.bass || 'Synth (sawtooth)'}`,
    'bank-chord-display': () => `Chord Bank: ${state.sampleBanks.chord || 'Synth (sawtooth)'}`,
    'bank-drum-display': () => `Drum Bank: ${state.sampleBanks.drum || 'Default (TR909)'}`,
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
  console.debug('Playing Strudel code:\n', code);
  await evaluate(code);
}

async function stopPattern() {
  try {
    hush();
  } catch (err) {
    console.warn('hush() failed:', err);
  }
}

async function restartPattern() {
  await stopPattern();
  await playPattern();
}

async function regenerate(options) {
  createArrangement(state, options);
  updateReadouts();
  if (started) await restartPattern();
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

/* ─── Init ─────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  createArrangement(state);

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

  // Transpose
  bindTransposeControls();

  // Regenerate buttons
  document.getElementById('regen-all')?.addEventListener('click', () =>
    regenerate({ regenChords: true, regenMelody: true, regenBass: true }),
  );
  document.getElementById('regen-chords')?.addEventListener('click', () =>
    regenerate({ regenChords: true, regenMelody: false, regenBass: false }),
  );
  document.getElementById('regen-melody')?.addEventListener('click', () =>
    regenerate({ regenChords: false, regenMelody: true, regenBass: false }),
  );
  document.getElementById('regen-bass')?.addEventListener('click', () =>
    regenerate({ regenChords: false, regenMelody: false, regenBass: true }),
  );

  // Transport: Start
  const startBtn = document.getElementById('start-btn');
  if (startBtn) {
    startBtn.addEventListener('click', async () => {
      if (started) return;
      startBtn.disabled = true;
      setStatus('Loading…');
      updateReadouts();
      try {
        await ensureStrudel();
        await playPattern();
        started = true;
        setStatus('Playing');
      } catch (err) {
        console.error(err);
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
