import { initStrudel, evaluate, hush, samples, getAudioContext } from '@strudel/web';
import '@strudel/repl';
import { state, setStatus } from './src/state.js';
import { createArrangement, buildStrudelCode } from './src/patterns/generative.js';
import { loadCatalog, applyCatalogToState } from './src/samples/catalog.js';
import { initMIDI } from './src/midi/midi.js';
import { MSG, ACTION_EFFECTS, ACTION_LABELS, ACTIONS } from './src/ws/protocol.js';

let started = false;
let strudelReady = false;

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
  await initStrudel({
    prebake: async () => {
      updateDebugStatus('Prebaking: loading samples');
      await samples('github:tidalcycles/dirt-samples');
      const availability = await loadCatalog();
      applyCatalogToState(state);
      
      // If any audience samples exist, load them from the local server
      if (availability.lead || availability.bass || availability.chord || availability.drum) {
        try {
          updateDebugStatus('Loading local audience samples');
          await samples(window.location.origin);
        } catch (err) {
          console.warn('[dashboard] Failed to load local samples:', err);
          updateDebugStatus('Failed to load local audience samples');
        }
      }
    },
  });

  // Ensure the AudioContext used by Strudel is running
  try {
    const ac = getAudioContext();
    console.log('[dashboard] Strudel AudioContext state:', ac.state, 'sampleRate:', ac.sampleRate, 'currentTime:', ac.currentTime);
    if (ac.state === 'suspended') {
      console.warn('[dashboard] AudioContext is suspended, attempting resume...');
      await ac.resume();
      console.log('[dashboard] AudioContext resumed, state:', ac.state);
    }
    updateDebugStatus(`Strudel AudioContext: ${ac.state}, time=${ac.currentTime.toFixed(2)}`);
  } catch (err) {
    console.error('[dashboard] Failed to access Strudel AudioContext:', err);
  }

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
    'bank-lead-display': () => state.sampleBanks.lead
      ? `Lead Bank: ${state.sampleBanks.lead}`
      : 'Lead Bank: Synth (triangle)',
    'bank-bass-display': () => state.sampleBanks.bass
      ? `Bass Bank: ${state.sampleBanks.bass}`
      : 'Bass Bank: Synth (sawtooth)',
    'bank-chord-display': () => state.sampleBanks.chord
      ? `Chord Bank: ${state.sampleBanks.chord}`
      : 'Chord Bank: Synth (sawtooth)',
    'bank-drum-display': () => state.sampleBanks.drum
      ? `Drum Bank: ${state.sampleBanks.drum}`
      : 'Drum Bank: Synth fallback',
  };
  for (const [id, fn] of Object.entries(map)) {
    const el = document.getElementById(id);
    if (el) el.innerText = fn();
  }
  applyStatusClass(state.status);
}

/* ─── Audio diagnostics ────────────────────────────── */
function playTestTone() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 440;
    gain.gain.value = 0.3;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    osc.stop(ctx.currentTime + 0.5);
    updateDebugStatus('Test tone played (440 Hz, 0.5s)');
    console.log('[dashboard] Test tone: 440 Hz for 0.5s via raw Web Audio API');
  } catch (err) {
    updateDebugStatus(`Test tone FAILED: ${err.message}`);
    console.error('[dashboard] Test tone failed:', err);
  }
}

async function testStrudelSound() {
  try {
    await ensureStrudel();
    
    // Log AudioContext state
    const ac = getAudioContext();
    console.log('[test] AudioContext state:', ac.state, 'currentTime:', ac.currentTime);
    if (ac.state === 'suspended') {
      await ac.resume();
      console.log('[test] AudioContext resumed:', ac.state);
    }
    
    // Try the absolute simplest pattern
    const testCode = 'note("c3 e3 g3 c4").sound("sine").gain(0.5).play()';
    console.log('[test] Evaluating simple test pattern:', testCode);
    updateDebugStatus('Testing simple Strudel pattern...');
    await evaluate(testCode);
    console.log('[test] evaluate() completed, AudioContext state:', ac.state, 'currentTime:', ac.currentTime);
    updateDebugStatus(`Test pattern active - AC state: ${ac.state}, time: ${ac.currentTime.toFixed(1)}`);
    
    // Check again after a short delay
    setTimeout(() => {
      console.log('[test] After 1s - AudioContext state:', ac.state, 'currentTime:', ac.currentTime.toFixed(2));
    }, 1000);
  } catch (err) {
    console.error('[test] testStrudelSound failed:', err);
    updateDebugStatus(`Strudel test FAILED: ${err.message || err}`);
  }
}

/* ─── Pattern lifecycle ────────────────────────────── */
async function playPattern() {
  const code = buildStrudelCode(state);
  updateDebugStatus('Evaluating play code');
  console.log('[dashboard] Playing Strudel code:\n', code);
  
  const repl = document.getElementById('repl-editor');
  if (repl && repl.editor) {
    if (!repl.editor._hooked) {
      repl.editor._hooked = true;
      repl.editor.evaluate = async function() {
        updateDebugStatus('Evaluating live tweak');
        try {
          await evaluate(this.code);
        } catch (err) {
          console.error(err);
        }
      };
    }
    repl.editor.setCode(code);
  }
  
  try {
    await evaluate(code);
    updateDebugStatus('Playback started');
  } catch (err) {
    console.error('[dashboard] evaluate() error:', err);
    updateDebugStatus(`evaluate() error: ${err.message || err}`);
    throw err;
  }
}

async function stopPattern() {
  try {
    updateDebugStatus('Stopping current pattern');
    hush();
    updateDebugStatus('Playback stopped');
  } catch (err) {
    console.warn('Stop failed:', err);
    updateDebugStatus(`Stop failed: ${err.message || err}`);
  }
}

async function restartPattern() {
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

  // Audio diagnostics
  document.getElementById('test-tone-btn')?.addEventListener('click', playTestTone);
  document.getElementById('test-strudel-btn')?.addEventListener('click', testStrudelSound);

  // Transport: Start
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

  // Wire up the onTrigger callback used by generated Strudel code
  window.updateStateFromStrudel = (hap) => {
    const note = hap?.value?.note || hap?.value?.s;
    if (note) state.currentNote = String(note);
  };

  // Initial readout + 1 Hz poll
  updateReadouts();
  setInterval(updateReadouts, 1000);

  // ─── Audience WebSocket client ──────────────────────
  initAudienceWS();
});

/* ─── Audience WebSocket (operator side) ───────────── */
function initAudienceWS() {
  const countEl = document.getElementById('audience-connection-count');
  const lastActionEl = document.getElementById('audience-last-action');
  let ws = null;
  let reconnectDelay = 500;

  function connect() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${location.host}/ws?role=operator`);

    ws.onopen = () => {
      console.log('[audience-ws] Connected as operator');
      reconnectDelay = 500;
    };

    ws.onclose = () => {
      console.log('[audience-ws] Disconnected, reconnecting...');
      setTimeout(() => {
        reconnectDelay = Math.min(reconnectDelay * 2, 10000);
        connect();
      }, reconnectDelay);
    };

    ws.onerror = () => { /* onclose fires after */ };

    ws.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }

      if (msg.type === MSG.STATUS && msg.audienceCount !== undefined) {
        if (countEl) countEl.innerText = `${msg.audienceCount} connected`;
      }

      if (msg.type === MSG.AUDIENCE_ACTION) {
        applyAudienceAction(msg.action);
        flashLastAction(msg.action);
      }

      if (msg.type === MSG.LOCK_UPDATE) {
        // Sync lock checkboxes with server state
        const locked = new Set(msg.locked || []);
        for (const actionId of Object.values(ACTIONS)) {
          const cb = document.getElementById(`lock-${actionId}`);
          if (cb) cb.checked = locked.has(actionId);
        }
      }
    };
  }

  function applyAudienceAction(actionId) {
    const effect = ACTION_EFFECTS[actionId];
    if (!effect) return;

    if (effect.type === 'adjust') {
      const current = state[effect.key] || 0;
      const next = Math.max(effect.min, Math.min(effect.max, current + effect.delta));
      updateParameter(effect.key, next);
    } else if (effect.type === 'regen') {
      const opts = { regenChords: false, regenMelody: false, regenBass: false, regenDrums: false };
      opts[`regen${effect.key.charAt(0).toUpperCase() + effect.key.slice(1)}`] = true;
      regenerate(opts);
    } else if (effect.type === 'effect') {
      const pick = effect.pool[Math.floor(Math.random() * effect.pool.length)];
      if (pick === 'heavyDelay') updateParameter('melodyDelay', Math.min(1, state.melodyDelay + 0.25));
      else if (pick === 'deepLpf') updateParameter('chordsLpf', Math.max(100, state.chordsLpf - 300));
      else if (pick === 'bigRoom') updateParameter('chordsRoom', Math.min(1, state.chordsRoom + 0.2));
    }
  }

  function flashLastAction(actionId) {
    const label = ACTION_LABELS[actionId] || actionId;
    if (lastActionEl) {
      lastActionEl.innerText = `↣ ${label}`;
      lastActionEl.classList.add('flash');
      setTimeout(() => lastActionEl.classList.remove('flash'), 1200);
    }
  }

  // Lock toggles → send to server
  for (const actionId of Object.values(ACTIONS)) {
    const cb = document.getElementById(`lock-${actionId}`);
    if (cb) {
      cb.addEventListener('change', () => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: MSG.TOGGLE_LOCK, action: actionId }));
        }
      });
    }
  }

  connect();
}
