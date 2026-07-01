import { initStrudel, evaluate, hush, samples } from '@strudel/web';
import { state, setStatus } from './src/state.js';
import { createArrangement, buildStrudelCode } from './src/patterns/generative.js';

let started = false;
let strudelReady = false;

async function ensureStrudel() {
  if (strudelReady) return;
  await initStrudel({
    prebake: async () => {
      await samples('github:tidalcycles/dirt-samples');
    },
  });
  strudelReady = true;
}

function bindSlider(id, key, formatter, { integer = false } = {}) {
  const slider = document.getElementById(id);
  if (!slider) return;
  slider.value = state[key];
  slider.addEventListener('input', async (e) => {
    state[key] = integer ? parseInt(e.target.value, 10) : parseFloat(e.target.value);
    const display = document.getElementById(`${id}-display`);
    if (display) display.innerText = formatter(state[key]);
    if (started) await restartPattern();
  });
  const display = document.getElementById(`${id}-display`);
  if (display) display.innerText = formatter(state[key]);
}

function bindToggle(id, key) {
  const btn = document.getElementById(id);
  if (!btn) return;
  const sync = () => {
    btn.setAttribute('aria-pressed', state[key] ? 'true' : 'false');
    btn.textContent = `${btn.dataset.label}: ${state[key] ? 'on' : 'off'}`;
  };
  sync();
  btn.addEventListener('click', async () => {
    state[key] = !state[key];
    sync();
    if (started) await restartPattern();
  });
}

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
  };
  for (const [id, fn] of Object.entries(map)) {
    const el = document.getElementById(id);
    if (el) el.innerText = fn();
  }
}

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

document.addEventListener('DOMContentLoaded', () => {
  createArrangement(state);

  bindSlider('gain-slider', 'gain', (v) => `Gain: ${v.toFixed(2)}`);
  bindSlider('speed-slider', 'speed', (v) => `Speed: ${v.toFixed(2)}`);
  bindSlider('cpm-slider', 'cpm', (v) => `CPM: ${v}`, { integer: true });

  bindToggle('toggle-drums', 'drumsOn');
  bindToggle('toggle-chords', 'chordsOn');
  bindToggle('toggle-bass', 'bassOn');
  bindToggle('toggle-melody', 'melodyOn');

  bindTransposeControls();

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

  updateReadouts();
  setInterval(updateReadouts, 1000);
});
