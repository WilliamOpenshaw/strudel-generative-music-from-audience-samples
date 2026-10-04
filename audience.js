/**
 * audience.js — WebSocket client for the audience phone page.
 *
 * Opens a connection to the show server, sends action requests on button tap,
 * handles rate-limiting and which controls the operator has switched on.
 */

import { MSG, RATE_LIMIT_MS, DEFAULT_AUDIENCE_ACCESS, isActionAllowed } from './src/ws/protocol.js';

// ─── DOM refs ─────────────────────────────────────────
const dot = document.getElementById('connection-dot');
const label = document.getElementById('connection-label');
const buttonGrid = document.getElementById('button-grid');
const bankIndicator = document.getElementById('bank-indicator');
const btnPrev = document.getElementById('btn-prev');
const btnNext = document.getElementById('btn-next');
const footer = document.getElementById('audience-footer');

// ─── State ────────────────────────────────────────────
let ws = null;
let access = { ...DEFAULT_AUDIENCE_ACCESS }; // which controls the operator has switched on
let lastSendTime = 0;
let reconnectDelay = 500; // ms, doubles on each failure up to 10 s
// The page is tracked by its first button, so it stays put when other pages are hidden or shown.
let currentPageKey = null;
let currentPadLabels = {}; // stores mapping from 'pad_1' -> '808 Kick'
let currentPadKinds = {}; // 'pad_1' -> 'assigned' | 'empty' | 'note' | 'cycle' | 'toggle'

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
  weird: "You made a random change.",
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
  // Bank 7 (Pads 13-15; pad 16 switches banks, which stays with the performers)
  [
    { action: 'pad_13', icon: '🎛️', label: 'Pad 13' },
    { action: 'pad_14', icon: '🎛️', label: 'Pad 14' },
    { action: 'pad_15', icon: '🎛️', label: 'Pad 15' },
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

    if (msg.type === MSG.ACCESS_UPDATE) {
      const previous = access;
      access = { ...DEFAULT_AUDIENCE_ACCESS, ...msg.access };
      renderBank();
      announceAccessChange(previous, access);
    } else if (msg.type === MSG.SYNC_PADS) {
      currentPadLabels = msg.padLabels || {};
      currentPadKinds = msg.padKinds || {};
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
  // Neither green nor red while offline: presses can't go anywhere.
  buttonGrid.classList.toggle('offline', !connected);
  if (connected) {
    dot.classList.add('connected');
    label.textContent = 'Connected';
  } else {
    dot.classList.remove('connected');
    label.textContent = 'Reconnecting…';
  }
}

// ─── Button handling ──────────────────────────────────
// The rate limit is per phone, not per button, so the cooldown tint goes on the
// whole grid; it survives page changes because renderBank() only replaces its children.
let cooldownTimer = null;

function setCoolingDown(coolingDown) {
  buttonGrid.classList.toggle('cooling-down', coolingDown);
  buttonGrid.classList.toggle('ready', !coolingDown);
}

function startCooldown() {
  setCoolingDown(true);
  clearTimeout(cooldownTimer);
  cooldownTimer = setTimeout(() => setCoolingDown(false), RATE_LIMIT_MS);
}

// Empty pads play nothing, so pressing one would only waste the phone's cooldown.
function isEmptyPad(action) {
  return currentPadKinds[action] === 'empty';
}

function updateButtonStates() {
  document.querySelectorAll('.action-btn').forEach((btn) => {
    btn.disabled = isEmptyPad(btn.dataset.action);
  });
}

function announceAccessChange(previous, next) {
  if (previous.all === next.all && previous.music === next.music) return;
  if (!next.all) {
    showInfo('The performers have paused audience controls for now.');
  } else if (!next.music) {
    showInfo('Music controls are paused — you can still play the pads!');
  } else {
    showInfo('Audience controls are back on!');
  }
}

function sendAction(action, btn) {
  const now = Date.now();

  // Checked first: a switched-off control shouldn't use up the cooldown.
  if (!isActionAllowed(action, access)) {
    showInfo('That control is switched off right now.');
    return;
  }
  // Client-side rate limit
  if (now - lastSendTime < RATE_LIMIT_MS) {
    showInfo("You have to wait until you can press again.");
    return;
  }
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    showInfo("Not connected yet — reconnecting, try again in a moment.");
    return;
  }

  lastSendTime = now;
  startCooldown();

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
    updateButtonStates();
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
/** Pages with controls the operator has switched on (a page is all music controls or all pads). */
function visiblePages() {
  return BANKS.filter((page) => page.some((btnInfo) => isActionAllowed(btnInfo.action, access)));
}

function currentPageIndex(pages) {
  const index = pages.findIndex((page) => page[0].action === currentPageKey);
  return index === -1 ? 0 : index;
}

function goToPage(step) {
  const pages = visiblePages();
  if (pages.length === 0) return;
  const index = (currentPageIndex(pages) + step + pages.length) % pages.length;
  currentPageKey = pages[index][0].action;
  renderBank();
}

function renderBank() {
  buttonGrid.innerHTML = '';
  const pages = visiblePages();
  const paused = pages.length === 0;
  buttonGrid.classList.toggle('paused', paused);
  btnPrev.disabled = pages.length <= 1;
  btnNext.disabled = pages.length <= 1;

  if (paused) {
    bankIndicator.textContent = 'Paused';
    const message = document.createElement('div');
    message.className = 'paused-message';
    message.textContent = '⏸️ Audience controls are paused. Hang tight — they may come back on soon!';
    buttonGrid.appendChild(message);
    return;
  }

  const index = currentPageIndex(pages);
  const bank = pages[index];
  currentPageKey = bank[0].action;
  bankIndicator.textContent = `Page ${index + 1} of ${pages.length}`;

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
btnPrev.addEventListener('click', () => goToPage(-1));
btnNext.addEventListener('click', () => goToPage(1));

footer.textContent = `Tap a button to influence the live performance. One action every ${RATE_LIMIT_MS / 1000} seconds.`;
setCoolingDown(false);
buttonGrid.classList.add('offline'); // until the first connection opens
renderBank();
connect();
