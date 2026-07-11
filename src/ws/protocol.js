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
};

// Human-readable labels for each action (used by audience UI)
export const ACTION_LABELS = {
  [ACTIONS.MORE_ENERGY]: 'More energy',
  [ACTIONS.CALMER]: 'Calmer',
  [ACTIONS.NEW_CHORDS]: 'New chords',
  [ACTIONS.WEIRD]: 'Weird',
};

// What each action does to the operator state
export const ACTION_EFFECTS = {
  [ACTIONS.MORE_ENERGY]: { type: 'adjust', key: 'cpm', delta: +5, min: 60, max: 180 },
  [ACTIONS.CALMER]:      { type: 'adjust', key: 'cpm', delta: -5, min: 60, max: 180 },
  [ACTIONS.NEW_CHORDS]:  { type: 'regen',  key: 'chords' },
  [ACTIONS.WEIRD]:       { type: 'effect', pool: ['heavyDelay', 'deepLpf', 'bigRoom'] },
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
};

// ─── Rate limit ───────────────────────────────────────
/** Minimum milliseconds between accepted actions from a single audience client. */
export const RATE_LIMIT_MS = 2000;
