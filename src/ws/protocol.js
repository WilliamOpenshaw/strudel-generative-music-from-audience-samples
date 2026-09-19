/**
 * Shared WebSocket protocol — used by server.js, dashboard.js, and audience.js.
 *
 * This file is imported by both Node (server) and browser (client) code,
 * so it uses only plain JS with no Node-specific or DOM-specific APIs.
 */

// ─── Actions the audience can send ────────────────────
export const ACTIONS = {
  MORE_ENERGY: 'more_energy',
  CALMER: 'calmer',
  NEW_CHORDS: 'new_chords',
  WEIRD: 'weird',
  FASTER: 'faster',
  SLOWER: 'slower',
  OCTAVE_UP: 'octave_up',
  OCTAVE_DOWN: 'octave_down',
  NEW_MELODY: 'new_melody',
  NEW_BASS: 'new_bass',
  NEW_DRUMS: 'new_drums',
  REGEN_ALL: 'regen_all',
  DELAY_UP: 'delay_up',
  DELAY_DOWN: 'delay_down',
  REVERB_UP: 'reverb_up',
  REVERB_DOWN: 'reverb_down',
  PAD_1: 'pad_1',
  PAD_2: 'pad_2',
  PAD_3: 'pad_3',
  PAD_4: 'pad_4',
  PAD_5: 'pad_5',
  PAD_6: 'pad_6',
  PAD_7: 'pad_7',
  PAD_8: 'pad_8',
  PAD_9: 'pad_9',
  PAD_10: 'pad_10',
  PAD_11: 'pad_11',
  PAD_12: 'pad_12',
  PAD_13: 'pad_13',
  PAD_14: 'pad_14',
  PAD_15: 'pad_15',
  PAD_16: 'pad_16',
};

// Human-readable labels for each action (used by audience UI)
export const ACTION_LABELS = {
  [ACTIONS.MORE_ENERGY]: 'More energy',
  [ACTIONS.CALMER]: 'Calmer',
  [ACTIONS.NEW_CHORDS]: 'New chords',
  [ACTIONS.WEIRD]: 'Weird',
  [ACTIONS.FASTER]: 'Faster',
  [ACTIONS.SLOWER]: 'Slower',
  [ACTIONS.OCTAVE_UP]: 'Octave Up',
  [ACTIONS.OCTAVE_DOWN]: 'Octave Down',
  [ACTIONS.NEW_MELODY]: 'New melody',
  [ACTIONS.NEW_BASS]: 'New bass',
  [ACTIONS.NEW_DRUMS]: 'New drums',
  [ACTIONS.REGEN_ALL]: 'Regenerate all',
  [ACTIONS.DELAY_UP]: 'Delay up',
  [ACTIONS.DELAY_DOWN]: 'Delay down',
  [ACTIONS.REVERB_UP]: 'Reverb up',
  [ACTIONS.REVERB_DOWN]: 'Reverb down',
  [ACTIONS.PAD_1]: 'Pad 1',
  [ACTIONS.PAD_2]: 'Pad 2',
  [ACTIONS.PAD_3]: 'Pad 3',
  [ACTIONS.PAD_4]: 'Pad 4',
  [ACTIONS.PAD_5]: 'Pad 5',
  [ACTIONS.PAD_6]: 'Pad 6',
  [ACTIONS.PAD_7]: 'Pad 7',
  [ACTIONS.PAD_8]: 'Pad 8',
  [ACTIONS.PAD_9]: 'Pad 9',
  [ACTIONS.PAD_10]: 'Pad 10',
  [ACTIONS.PAD_11]: 'Pad 11',
  [ACTIONS.PAD_12]: 'Pad 12',
  [ACTIONS.PAD_13]: 'Pad 13',
  [ACTIONS.PAD_14]: 'Pad 14',
  [ACTIONS.PAD_15]: 'Pad 15',
  [ACTIONS.PAD_16]: 'Pad 16',
};

// What each action does to the operator state
export const ACTION_EFFECTS = {
  [ACTIONS.MORE_ENERGY]: { type: 'adjust', key: 'cpm', delta: +5, min: 60, max: 180 },
  [ACTIONS.CALMER]:      { type: 'adjust', key: 'cpm', delta: -5, min: 60, max: 180 },
  [ACTIONS.NEW_CHORDS]:  { type: 'regen',  key: 'chords' },
  [ACTIONS.WEIRD]:       { type: 'effect', pool: ['heavyDelay', 'deepLpf', 'bigRoom'] },
  [ACTIONS.FASTER]:      { type: 'adjust', key: 'speed', delta: +0.1, min: 0.1, max: 4.0 },
  [ACTIONS.SLOWER]:      { type: 'adjust', key: 'speed', delta: -0.1, min: 0.1, max: 4.0 },
  [ACTIONS.OCTAVE_UP]:   { type: 'adjust', key: 'transpose', delta: +12, min: -24, max: 24 },
  [ACTIONS.OCTAVE_DOWN]: { type: 'adjust', key: 'transpose', delta: -12, min: -24, max: 24 },
  [ACTIONS.NEW_MELODY]:  { type: 'regen',  key: 'melody' },
  [ACTIONS.NEW_BASS]:    { type: 'regen',  key: 'bass' },
  [ACTIONS.NEW_DRUMS]:   { type: 'regen',  key: 'drums' },
  [ACTIONS.REGEN_ALL]:   { type: 'regen',  key: 'all' },
  [ACTIONS.DELAY_UP]:    { type: 'effect', action: 'delay_up' },
  [ACTIONS.DELAY_DOWN]:  { type: 'effect', action: 'delay_down' },
  [ACTIONS.REVERB_UP]:   { type: 'effect', action: 'reverb_up' },
  [ACTIONS.REVERB_DOWN]: { type: 'effect', action: 'reverb_down' },
  [ACTIONS.PAD_1]:       { type: 'pad', pad: 1 },
  [ACTIONS.PAD_2]:       { type: 'pad', pad: 2 },
  [ACTIONS.PAD_3]:       { type: 'pad', pad: 3 },
  [ACTIONS.PAD_4]:       { type: 'pad', pad: 4 },
  [ACTIONS.PAD_5]:       { type: 'pad', pad: 5 },
  [ACTIONS.PAD_6]:       { type: 'pad', pad: 6 },
  [ACTIONS.PAD_7]:       { type: 'pad', pad: 7 },
  [ACTIONS.PAD_8]:       { type: 'pad', pad: 8 },
  [ACTIONS.PAD_9]:       { type: 'pad', pad: 9 },
  [ACTIONS.PAD_10]:      { type: 'pad', pad: 10 },
  [ACTIONS.PAD_11]:      { type: 'pad', pad: 11 },
  [ACTIONS.PAD_12]:      { type: 'pad', pad: 12 },
  [ACTIONS.PAD_13]:      { type: 'pad', pad: 13 },
  [ACTIONS.PAD_14]:      { type: 'pad', pad: 14 },
  [ACTIONS.PAD_15]:      { type: 'pad', pad: 15 },
  [ACTIONS.PAD_16]:      { type: 'pad', pad: 16 },
};

// ─── Server ↔ client message types ────────────────────
export const MSG = {
  /** Server → operator: an audience member pressed a button */
  AUDIENCE_ACTION: 'audience_action',
  /** Server → audience: lock state changed */
  LOCK_UPDATE: 'lock_update',
  /** Server → both: general status (e.g. connection count) */
  STATUS: 'status',
  /** Audience → server: an action request */
  ACTION_REQUEST: 'action_request',
  /** Operator → server: toggle lock on an action */
  TOGGLE_LOCK: 'toggle_lock',
  /** Operator → server → audience: sync pad sample labels */
  SYNC_PADS: 'sync_pads',
};

// ─── Rate limit ───────────────────────────────────────
/** Minimum milliseconds between accepted actions from a single audience client. */
export const RATE_LIMIT_MS = 5000;
