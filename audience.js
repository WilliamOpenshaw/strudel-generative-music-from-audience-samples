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
const buttonGrid = document.getElementById('button-grid');
const bankIndicator = document.getElementById('bank-indicator');
const btnPrev = document.getElementById('btn-prev');
const btnNext = document.getElementById('btn-next');

// ─── State ────────────────────────────────────────────
let ws = null;
let lockedActions = new Set();
let lastSendTime = 0;
let reconnectDelay = 500; // ms, doubles on each failure up to 10 s
let currentBankIndex = 0;
let currentPadLabels = {}; // stores mapping from 'pad_1' -> '808 Kick'

// ─── Info Bar ─────────────────────────────────────────
const infoBar = document.getElementById('audience-info-bar');

function showInfo(msg) {
  if (!infoBar) return;
  infoBar.textContent = msg;
  infoBar.classList.remove('flash');
  // force reflow to restart animation
  void infoBar.offsetWidth;
  infoBar.classList.add('flash');
}

const ACTION_MESSAGES = {
  more_energy: "You gave the music more energy!",
  calmer: "You made the music calmer.",
  new_chords: "You asked for new chords.",
  weird: "You made things weird!",
  faster: "You made the music faster.",
  slower: "You made the music slower.",
  octave_up: "You made the track increase by one octave.",
  octave_down: "You made the track decrease by one octave.",
  new_melody: "You asked for a new melody.",
  new_bass: "You asked for a new bassline.",
  new_drums: "You asked for new drums.",
  regen_all: "You regenerated the whole track!",
  delay_up: "You added more delay.",
  delay_down: "You reduced the delay.",
  reverb_up: "You added more reverb.",
  reverb_down: "You reduced the reverb.",
};

const BANKS = [
  // Bank 0
  [
    { action: 'more_energy', icon: '🔥', label: 'More energy' },
    { action: 'calmer', icon: '🌊', label: 'Calmer' },
    { action: 'new_chords', icon: '🎵', label: 'New chords' },
    { action: 'weird', icon: '✨', label: 'Weird' },
  ],
  // Bank 1
  [
    { action: 'faster', icon: '⏩', label: 'Faster' },
    { action: 'slower', icon: '⏪', label: 'Slower' },
    { action: 'octave_up', icon: '⬆️', label: 'Octave Up' },
    { action: 'octave_down', icon: '⬇️', label: 'Octave Down' },
  ],
  // Bank 2
  [
    { action: 'new_melody', icon: '🎹', label: 'New melody' },
    { action: 'new_bass', icon: '🎸', label: 'New bass' },
    { action: 'new_drums', icon: '🥁', label: 'New drums' },
    { action: 'regen_all', icon: '🎲', label: 'Regenerate all' },
  ],
  // Bank 3
  [
    { action: 'delay_up', icon: '↗️', label: 'Delay up' },
    { action: 'delay_down', icon: '↙️', label: 'Delay down' },
    { action: 'reverb_up', icon: '🌫️', label: 'Reverb up' },
    { action: 'reverb_down', icon: '📦', label: 'Reverb down' },
  ],
  // Bank 4 (Pads 1-4)
  [
    { action: 'pad_1', icon: '🎛️', label: 'Pad 1' },
    { action: 'pad_2', icon: '🎛️', label: 'Pad 2' },
    { action: 'pad_3', icon: '🎛️', label: 'Pad 3' },
    { action: 'pad_4', icon: '🎛️', label: 'Pad 4' },
  ],
  // Bank 5 (Pads 5-8)
  [
    { action: 'pad_5', icon: '🎛️', label: 'Pad 5' },
    { action: 'pad_6', icon: '🎛️', label: 'Pad 6' },
    { action: 'pad_7', icon: '🎛️', label: 'Pad 7' },
    { action: 'pad_8', icon: '🎛️', label: 'Pad 8' },
  ],
  // Bank 6 (Pads 9-12)
  [
    { action: 'pad_9', icon: '🎛️', label: 'Pad 9' },
    { action: 'pad_10', icon: '🎛️', label: 'Pad 10' },
    { action: 'pad_11', icon: '🎛️', label: 'Pad 11' },
    { action: 'pad_12', icon: '🎛️', label: 'Pad 12' },
  ],
  // Bank 7 (Pads 13-16)
  [
    { action: 'pad_13', icon: '🎛️', label: 'Pad 13' },
    { action: 'pad_14', icon: '🎛️', label: 'Pad 14' },
    { action: 'pad_15', icon: '🎛️', label: 'Pad 15' },
    { action: 'pad_16', icon: '🎛️', label: 'Pad 16' },
  ],
];

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
    } else if (msg.type === MSG.SYNC_PADS) {
      currentPadLabels = msg.padLabels || {};
      renderBank(); // re-render to show updated labels
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
  const buttons = document.querySelectorAll('.action-btn');
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
  if (now - lastSendTime < RATE_LIMIT_MS) {
    showInfo("You have to wait until you can press again.");
    return;
  }
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  if (lockedActions.has(action)) {
    showInfo("That action is currently locked by the operator.");
    return;
  }

  lastSendTime = now;

  ws.send(JSON.stringify({ type: MSG.ACTION_REQUEST, action }));

  let msgText = ACTION_MESSAGES[action];
  if (!msgText && action.startsWith('pad_')) {
    const padNum = action.split('_')[1];
    msgText = `You played Pad ${padNum}!`;
  }
  showInfo(msgText || "Action sent!");

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

// ─── Rendering ─────────────────────────────────────────
function renderBank() {
  buttonGrid.innerHTML = '';
  const bank = BANKS[currentBankIndex];
  
  bankIndicator.textContent = `Page ${currentBankIndex + 1} of ${BANKS.length}`;
  
  bank.forEach(btnInfo => {
    const btn = document.createElement('button');
    btn.className = 'action-btn';
    btn.dataset.action = btnInfo.action;
    btn.type = 'button';
    
    const iconSpan = document.createElement('span');
    iconSpan.className = 'btn-icon';
    iconSpan.textContent = btnInfo.icon;
    
    const labelSpan = document.createElement('span');
    let labelText = btnInfo.label;
    if (btnInfo.action.startsWith('pad_') && currentPadLabels[btnInfo.action]) {
      // e.g. "Pad 1: 808 Kick"
      labelText = `${btnInfo.label}: ${currentPadLabels[btnInfo.action]}`;
    }
    labelSpan.textContent = labelText;
    
    btn.appendChild(iconSpan);
    btn.appendChild(labelSpan);
    
    btn.addEventListener('click', (e) => {
      createRipple(btn, e);
      sendAction(btnInfo.action, btn);
    });
    
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
    
    buttonGrid.appendChild(btn);
  });
  
  updateButtonStates();
}

// ─── Init ─────────────────────────────────────────────
btnPrev.addEventListener('click', () => {
  currentBankIndex = (currentBankIndex - 1 + BANKS.length) % BANKS.length;
  renderBank();
});

btnNext.addEventListener('click', () => {
  currentBankIndex = (currentBankIndex + 1) % BANKS.length;
  renderBank();
});

renderBank();
connect();
