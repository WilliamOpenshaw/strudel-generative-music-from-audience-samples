/**
 * pads.js — read-only mirror of the dashboard's Sample Pad Assignments,
 * for a second window/screen. Layout arrives from the operator via the
 * server's WebSocket bridge (role=display).
 */

import { MSG } from './src/ws/protocol.js';
import { renderPadGrid } from './src/pads/padGrid.js';

const grid = document.getElementById('pad-display-grid');
const title = document.getElementById('pad-display-title');
const status = document.getElementById('pad-display-status');
const fullscreenBtn = document.getElementById('pad-display-fullscreen');

let reconnectDelay = 500;
let hasLayout = false;

renderPadGrid(grid, { labels: {}, kinds: {} });

function setStatus(text, live) {
  status.textContent = text;
  status.classList.toggle('live', live);
}

function connect() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${protocol}//${location.host}/ws?role=display`);

  ws.onopen = () => {
    reconnectDelay = 500;
    setStatus(hasLayout ? 'Live' : 'Waiting for the dashboard…', hasLayout);
  };

  ws.onclose = () => {
    setStatus('Reconnecting…', false);
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 10000);
  };

  ws.onmessage = (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }
    if (msg.type !== MSG.SYNC_PADS) return;

    hasLayout = true;
    setStatus('Live', true);
    title.textContent = msg.bankTitle || '';
    renderPadGrid(grid, { labels: msg.padLabels, kinds: msg.padKinds });
  };
}

fullscreenBtn.addEventListener('click', () => {
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else {
    document.documentElement.requestFullscreen?.().catch((err) => console.warn('[pads] Fullscreen failed:', err));
  }
});

document.addEventListener('fullscreenchange', () => {
  fullscreenBtn.textContent = document.fullscreenElement ? '✕ Exit Fullscreen' : '⛶ Fullscreen';
});

connect();
