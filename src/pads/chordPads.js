/**
 * Chord note pads (banks 3 and 4): pads 1-13 play the tones of the current
 * chord, stacked upward across octaves from pad 1 (lowest) to pad 13.
 * Pad 14 picks the chord, pad 15 the instrument/sample, pad 16 the bank.
 */

import { SCALES } from '../patterns/generative.js';
import { midiToNoteInfo } from '../samples/pitch.js';

export const NOTE_PAD_COUNT = 13;

// Pitched, melody-friendly sounds only (no noise, percussion or sound effects), and only
// ones that start within ~1.5 s of first use (tested 2026-10-03; slower soundfonts removed).
export const MELODY_PAD_INSTRUMENTS = [
  'gm_epiano1', 'gm_epiano2', 'gm_harpsichord', 'gm_clavinet', 'gm_celesta',
  'gm_glockenspiel', 'gm_marimba', 'gm_kalimba', 'gm_orchestral_harp', 'gm_koto', 'gm_sitar',
  'gm_banjo', 'gm_acoustic_guitar_nylon',
  'gm_electric_guitar_clean', 'gm_electric_guitar_jazz', 'gm_pizzicato_strings', 'gm_violin',
  'gm_fiddle', 'gm_flute', 'gm_piccolo', 'gm_pan_flute', 'gm_ocarina',
  'gm_shakuhachi', 'gm_clarinet', 'gm_oboe', 'gm_soprano_sax', 'gm_alto_sax', 'gm_trumpet',
  'gm_harmonica', 'gm_bandoneon', 'gm_lead_1_square', 'gm_lead_2_sawtooth',
  'gm_lead_3_calliope', 'gm_lead_5_charang', 'gm_lead_6_voice',
  'sawtooth', 'square', 'triangle', 'sine', 'supersaw', 'pulse',
];

// Recorded samples are tuned to a C by the sample editor. Treating that C as
// C5 (mid pad range) spreads the pads evenly between slowed and sped up.
const SAMPLE_REFERENCE_MIDI = 72;
const LOWEST_PAD_OCTAVE_MIDI = 48; // pad 1 is the chord root in octave 3

const PITCH_CLASSES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

const CHORD_INTERVALS = {
  '': [0, 4, 7],
  M: [0, 4, 7],
  m: [0, 3, 7],
  '7': [0, 4, 7, 10],
  m7: [0, 3, 7, 10],
  M7: [0, 4, 7, 11],
  maj7: [0, 4, 7, 11],
  '^7': [0, 4, 7, 11],
  m7b5: [0, 3, 6, 10],
  dim: [0, 3, 6],
  o: [0, 3, 6],
  dim7: [0, 3, 6, 9],
  o7: [0, 3, 6, 9],
  aug: [0, 4, 8],
  '+': [0, 4, 8],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  '6': [0, 4, 7, 9],
  m6: [0, 3, 7, 9],
};

function parseChord(symbol) {
  const match = /^([A-G])([b#]?)(.*)$/.exec(symbol || '');
  if (!match) return { rootPc: 0, intervals: CHORD_INTERVALS.m };
  const [, letter, accidental, quality] = match;
  const rootPc = PITCH_CLASSES[letter] + (accidental === '#' ? 1 : accidental === 'b' ? -1 : 0);
  const intervals =
    CHORD_INTERVALS[quality] ?? (quality.startsWith('m') ? CHORD_INTERVALS.m : CHORD_INTERVALS['']);
  return { rootPc, intervals };
}

/** MIDI notes for pads 1-14, lowest first. */
export function chordPadNotes(symbol, transpose = 0) {
  const { rootPc, intervals } = parseChord(symbol);
  const start = LOWEST_PAD_OCTAVE_MIDI + ((((rootPc + transpose) % 12) + 12) % 12);
  const notes = [];
  for (let i = 0; i < NOTE_PAD_COUNT; i++) {
    notes.push(start + intervals[i % intervals.length] + 12 * Math.floor(i / intervals.length));
  }
  return notes;
}

/**
 * The chord the pads should follow: the one sounding now if the scheduler
 * cycle is known, otherwise the progression's first chord, otherwise the
 * current scale's home chord.
 */
export function currentChordSymbol(state, cycle = null) {
  const chords = state._arrangement?.chordArray || [];
  const firstChord = chords.find(([, sym]) => sym !== '~')?.[1];
  const fallback = SCALES[state.scaleMode]?.chordPool[0] || SCALES.minor.chordPool[0];

  if (cycle !== null && chords.length > 0) {
    // Mirrors buildStrudelCode: slowcat plays one chord per cycle, slowed to one per measure.
    const cyclesPerMeasure = (state.timeSigNum || 4) * (4 / (state.timeSigDen || 4));
    const index = Math.floor(cycle / cyclesPerMeasure) % chords.length;
    const sym = chords[index][1];
    if (sym !== '~') return sym;
  }
  return firstChord || fallback;
}

/** Chords the pads can be set to: the current key's chord set, so choices stay in key. */
export function chordChoices(state) {
  return (SCALES[state.scaleMode] || SCALES.minor).chordPool;
}

/** The performer's chosen pad chord, or null for "Auto" (follow the music). */
export function chosenPadChord(state) {
  // A choice from a previous key no longer fits, so it falls back to Auto.
  return chordChoices(state).includes(state.notePadChord) ? state.notePadChord : null;
}

/** Next pad-14 setting: Auto → each chord in the key → back to Auto. */
export function nextPadChordChoice(state) {
  const sequence = [null, ...chordChoices(state)];
  const index = sequence.indexOf(chosenPadChord(state));
  return sequence[(index + 1) % sequence.length];
}

export function sampleRateForNote(midi) {
  return Math.pow(2, (midi - SAMPLE_REFERENCE_MIDI) / 12);
}

export function noteName(midi) {
  return midiToNoteInfo(midi).noteName;
}

export function instrumentLabel(name) {
  return name.replace(/^gm_/, '').replace(/_/g, ' ');
}
