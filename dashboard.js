import { initStrudel, evaluate, hush } from '@strudel/web';

const state = { gain: 0.8, speed: 1.0, currentNote: 'c3 e3 g3 b3' };
let started = false;

function updateGain(newValue) {
  state.gain = newValue;
  const el = document.getElementById('gain-display');
  if (el) el.innerText = `Gain: ${newValue.toFixed(2)}`;
}

async function playPattern() {
  const code = `note("c3 e3 g3 b3").s("sine").gain(${state.gain.toFixed(2)}).speed(${state.speed.toFixed(2)}).play()`;
  console.debug('Playing Strudel code:', code);
  await evaluate(code);
}

async function stopPattern() {
  try {
    hush();
  } catch (err) {
    console.warn('hush() failed:', err);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const slider = document.getElementById('gain-slider');
  if (slider) slider.value = state.gain;
  if (slider) slider.addEventListener('input', async (e) => {
    updateGain(parseFloat(e.target.value));
    if (started) {
      await stopPattern();
      await playPattern();
    }
  });

  const startBtn = document.getElementById('start-btn');
  if (startBtn) startBtn.addEventListener('click', async () => {
    if (started) return;
    await initStrudel();
    await playPattern();
    started = true;
    const s = document.getElementById('status'); if (s) s.innerText = 'Started';
  });

  setInterval(() => {
    const nd = document.getElementById('note-display');
    if (nd) nd.innerText = `Playing Note: ${state.currentNote}`;
  }, 1000);
});
