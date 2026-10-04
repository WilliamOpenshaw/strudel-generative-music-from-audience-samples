/**
 * host.js — plays the recorded host messages (public/host-messages) in order
 * from the MIDI pads, for the top of the show.
 *
 * - Any pad: plays the next message, but only when nothing is playing.
 * - Pad 13: stops the current message and plays the previous one.
 * - Pad 16: stops the current message and plays the next one.
 * While started, this page claims the pads so the dashboard ignores them.
 */

import { claimPads } from './src/midi/hostClaim.js';

const BACK_PAD = 13;
const FORWARD_PAD = 16;

const el = (id) => document.getElementById(id);
const startBtn = el('host-start-btn');
const backBtn = el('host-back-btn');
const playBtn = el('host-play-btn');
const forwardBtn = el('host-forward-btn');
const resetBtn = el('host-reset-btn');
const volumeInput = el('host-volume');
const list = el('host-list');

let messages = []; // { filename, url, buffer, error }
let started = false;
let audioCtx = null;
let output = null;
let current = null; // { source, index }
let nextIndex = 0; // the "next up" message
let releaseClaim = null;
let midiReady = false;

// The controller sends notes 1-16 or 21-36 for pads 1-16, depending on its bank mode.
function padForNote(note) {
  if (note >= 1 && note <= 16) return note;
  if (note >= 21 && note <= 36) return note - 20;
  return null;
}

function setStatus(text, kind = '') {
  const status = el('host-status');
  status.textContent = text;
  status.className = `host-status ${kind}`;
}

function describe(index) {
  const message = messages[index];
  return message ? { number: `#${index + 1}`, name: message.filename } : null;
}

function render() {
  const playing = current ? describe(current.index) : null;
  el('host-now-number').textContent = playing?.number ?? '—';
  el('host-now-name').textContent = playing?.name ?? (started ? 'Nothing playing' : 'Stopped');
  el('host-now-card').classList.toggle('playing', Boolean(playing));

  const next = describe(nextIndex);
  el('host-next-number').textContent = next?.number ?? '—';
  el('host-next-name').textContent = !started
    ? next ? `${next.name} — press Start` : 'Press Start'
    : next?.name ?? (messages.length ? 'End of messages — pad 13 goes back' : 'No messages found');

  for (const button of [backBtn, playBtn, forwardBtn, resetBtn]) button.disabled = !started;
  playBtn.disabled = !started || Boolean(current) || !next;

  if (started) {
    setStatus(current ? 'Playing — pads 13 & 16 only' : 'Ready — any pad plays next', current ? 'playing' : 'ready');
  }

  list.innerHTML = '';
  messages.forEach((message, index) => {
    const item = document.createElement('li');
    item.className = 'host-list-item';
    if (current?.index === index) item.classList.add('playing');
    if (index === nextIndex) item.classList.add('next');
    if (message.error) item.classList.add('broken');
    const tag = current?.index === index ? '▶ playing' : index === nextIndex ? 'next up' : message.error ? '⚠️ can’t play' : '';
    item.innerHTML = '<span class="host-list-number"></span><span class="host-list-name"></span><span class="host-list-tag"></span>';
    item.children[0].textContent = `#${index + 1}`;
    item.children[1].textContent = message.filename;
    item.children[2].textContent = tag;
    item.title = 'Click to make this message next up (doesn’t play it)';
    item.addEventListener('click', () => {
      if (!started) return;
      nextIndex = index;
      render();
    });
    list.appendChild(item);
  });
}

function stopCurrent() {
  if (!current) return;
  current.source.onended = null;
  try {
    current.source.stop();
  } catch (_) {}
  current = null;
}

function playIndex(index) {
  stopCurrent();
  if (index < 0 || index >= messages.length) {
    render();
    return;
  }
  nextIndex = index + 1;
  const message = messages[index];
  if (!message.buffer) {
    // Don't stall the show on a broken file: report it and move past it.
    render();
    setStatus(`#${index + 1} can't be played (${message.error || 'not loaded'}) — skipped`, 'error');
    return;
  }
  const source = audioCtx.createBufferSource();
  source.buffer = message.buffer;
  source.connect(output);
  const playing = { source, index };
  source.onended = () => {
    if (current === playing) {
      current = null;
      render();
    }
  };
  current = playing;
  source.start();
  render();
}

function handlePad(pad) {
  if (!started) return;
  if (pad === FORWARD_PAD) {
    playIndex(Math.min(nextIndex, messages.length));
  } else if (pad === BACK_PAD) {
    // "Previous" = the one before the last played (next up - 2), never before #1.
    playIndex(Math.max(0, nextIndex - 2));
  } else if (!current) {
    playIndex(nextIndex); // ignored while a message plays
  }
}

async function loadMessages() {
  const entries = await fetch('/api/host-messages', { cache: 'no-store' }).then((res) => {
    if (!res.ok) throw new Error(`server returned ${res.status}`);
    return res.json();
  });
  messages = entries.map((m) => ({ ...m, buffer: null, error: null }));
  let loaded = 0;
  await Promise.all(
    messages.map(async (message) => {
      try {
        const data = await fetch(message.url, { cache: 'no-store' }).then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.arrayBuffer();
        });
        message.buffer = await audioCtx.decodeAudioData(data);
      } catch (err) {
        message.error = err.message || String(err);
        console.warn(`[host] Couldn't load ${message.filename}:`, err);
      }
      setStatus(`Loading messages… ${++loaded}/${messages.length}`, 'loading');
    }),
  );
  nextIndex = Math.min(nextIndex, messages.length);
}

async function setUpMidi() {
  if (midiReady) return;
  const midiStatus = el('host-midi-status');
  if (!navigator.requestMIDIAccess) {
    midiStatus.textContent = 'MIDI: not supported in this browser';
    return;
  }
  try {
    const access = await navigator.requestMIDIAccess();
    const attach = () => {
      const names = [];
      for (const input of access.inputs.values()) {
        if (input.state !== 'connected') continue;
        input.onmidimessage = (msg) => {
          const [status, note, velocity] = msg.data;
          if (status >> 4 !== 9 || velocity === 0) return; // note-on only
          const pad = padForNote(note);
          if (pad) handlePad(pad);
        };
        names.push(input.name);
      }
      midiStatus.textContent = names.length ? `MIDI: ${names.length} device(s)` : 'MIDI: no devices';
      midiStatus.title = names.join('\n');
    };
    attach();
    access.onstatechange = attach;
    midiReady = true;
  } catch (err) {
    midiStatus.textContent = 'MIDI: access denied (use the on-screen buttons)';
    console.warn('[host] MIDI access failed:', err);
  }
}

async function start() {
  startBtn.disabled = true;
  try {
    audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') await audioCtx.resume();
    if (!output) {
      output = audioCtx.createGain();
      output.gain.value = Number(volumeInput.value);
      output.connect(audioCtx.destination);
    }
    setStatus('Loading messages…', 'loading');
    await Promise.all([loadMessages(), setUpMidi()]);
    started = true;
    releaseClaim = claimPads();
    startBtn.textContent = '■ Stop';
    startBtn.classList.add('running');
    const broken = messages.filter((m) => m.error).length;
    render();
    if (broken) setStatus(`Ready — ${broken} file(s) couldn't be loaded (marked ⚠️)`, 'error');
  } catch (err) {
    setStatus(`Couldn't start: ${err.message || err}`, 'error');
  } finally {
    startBtn.disabled = false;
  }
}

function stop() {
  stopCurrent();
  started = false;
  releaseClaim?.();
  releaseClaim = null;
  startBtn.textContent = '▶ Start';
  startBtn.classList.remove('running');
  setStatus('Stopped — pads are back with the dashboard', '');
  render();
}

startBtn.addEventListener('click', () => (started ? stop() : start()));
backBtn.addEventListener('click', () => handlePad(BACK_PAD));
forwardBtn.addEventListener('click', () => handlePad(FORWARD_PAD));
playBtn.addEventListener('click', () => handlePad(1));
resetBtn.addEventListener('click', () => {
  nextIndex = 0;
  render();
});
volumeInput.addEventListener('input', () => {
  if (output) output.gain.value = Number(volumeInput.value);
});

render();
