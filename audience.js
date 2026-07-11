/**
 * audience.js — WebSocket client for the audience phone page.
 *
 * Opens a connection to the show server, sends action requests on button tap,
 * handles rate-limiting and lock state from the operator.
 */

import { MSG, RATE_LIMIT_MS } from './src/ws/protocol.js';

// ─── DOM refs ─────────────────────────────────────────
const dot = document.getElementById('connection-dot');
const label = document.getElementById('connection-label');
const buttons = document.querySelectorAll('.action-btn');

// ─── State ────────────────────────────────────────────
let ws = null;
let lockedActions = new Set();
let lastSendTime = 0;
let reconnectDelay = 500; // ms, doubles on each failure up to 10 s

// ─── WebSocket connection ─────────────────────────────
function connect() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}/ws?role=audience`);

  ws.onopen = () => {
    setConnectionState(true);
    reconnectDelay = 500; // reset backoff
  };

  ws.onclose = () => {
    setConnectionState(false);
    scheduleReconnect();
  };

  ws.onerror = () => {
    // onclose will fire after this
  };

  ws.onmessage = (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }

    if (msg.type === MSG.LOCK_UPDATE) {
      lockedActions = new Set(msg.locked || []);
      updateButtonStates();
    }
  };
}

function scheduleReconnect() {
  setTimeout(() => {
    reconnectDelay = Math.min(reconnectDelay * 2, 10000);
    connect();
  }, reconnectDelay);
}

function setConnectionState(connected) {
  if (connected) {
    dot.classList.add('connected');
    label.textContent = 'Connected';
  } else {
    dot.classList.remove('connected');
    label.textContent = 'Reconnecting…';
  }
}

// ─── Button handling ──────────────────────────────────
function updateButtonStates() {
  buttons.forEach((btn) => {
    const action = btn.dataset.action;
    if (lockedActions.has(action)) {
      btn.classList.add('locked');
      btn.disabled = true;
    } else {
      btn.classList.remove('locked');
      btn.disabled = false;
    }
  });
}

function sendAction(action, btn) {
  const now = Date.now();

  // Client-side rate limit
  if (now - lastSendTime < RATE_LIMIT_MS) return;
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  if (lockedActions.has(action)) return;

  lastSendTime = now;

  ws.send(JSON.stringify({ type: MSG.ACTION_REQUEST, action }));

  // Visual cooldown feedback
  btn.classList.add('cooldown');
  btn.disabled = true;
  setTimeout(() => {
    btn.classList.remove('cooldown');
    if (!lockedActions.has(action)) {
      btn.disabled = false;
    }
  }, RATE_LIMIT_MS);
}

// Tap ripple effect
function createRipple(btn, event) {
  const ripple = document.createElement('span');
  ripple.classList.add('ripple');
  const rect = btn.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height) * 2;
  ripple.style.width = ripple.style.height = `${size}px`;

  // Use touch position if available, otherwise center
  let x, y;
  if (event.touches && event.touches[0]) {
    x = event.touches[0].clientX - rect.left - size / 2;
    y = event.touches[0].clientY - rect.top - size / 2;
  } else {
    x = event.clientX - rect.left - size / 2;
    y = event.clientY - rect.top - size / 2;
  }
  ripple.style.left = `${x}px`;
  ripple.style.top = `${y}px`;

  btn.appendChild(ripple);
  ripple.addEventListener('animationend', () => ripple.remove());
}

// ─── Init ─────────────────────────────────────────────
buttons.forEach((btn) => {
  const action = btn.dataset.action;

  btn.addEventListener('click', (e) => {
    createRipple(btn, e);
    sendAction(action, btn);
  });

  // Prevent context menu on long press (mobile)
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
});

connect();
