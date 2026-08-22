/**
 * Generative arrangement — port of strudel code/generative v0.0.12.js for @strudel/web evaluate().
 */

import { getAllSamples } from '../samples/catalog.js';

export const defaultChordPool = [
  'Cm7', 'Fm7', 'Gm7', 'Bb7', 'EbM7', 'AbM7',
];

export function randomChords(chordPool, length, silenceChance) {
  const a = [];
  for (let i = 0; i < length; i++) {
    const durations = [1, 1, 2, 2, 4];
    const dur = durations[Math.floor(Math.random() * durations.length)];
    if (Math.random() < silenceChance) {
      a.push([dur, '~']);
    } else {
      const chordSym = chordPool[Math.floor(Math.random() * chordPool.length)];
      a.push([dur, chordSym]);
    }
  }
  return a;
}

export function randomMelody(notes, length, silenceChance) {
  const a = [];
  for (let i = 0; i < length; i++) {
    const durations = [0.5, 1, 1, 1, 2, 2];
    const dur = durations[Math.floor(Math.random() * durations.length)];
    if (Math.random() < silenceChance) {
      a.push({ dur, note: null });
    } else {
      const note = notes[Math.floor(Math.random() * notes.length)];
      a.push({ dur, note });
    }
  }
  return a;
}

function formatChordPattern(chordArray) {
  return chordArray
    .map(([dur, sym]) =>
      sym === '~'
        ? `silence.legato(${dur})`
        : `chord("${sym}").legato(${dur})`,
    )
    .join(', ');
}

function formatMelodySeq(melodyArray) {
  return melodyArray
    .map(({ dur, note }) =>
      note === null ? `silence.legato(${dur})` : `pure(${note}).legato(${dur})`,
    )
    .join(', ');
}

function formatDrumFallback() {
  return [
    'pure(0).legato(0.25)',
    'silence.legato(0.25)',
    'pure(-7).legato(0.25)',
    'silence.legato(0.25)',
    'pure(0).legato(0.25)',
    'silence.legato(0.25)',
    'pure(-5).legato(0.25)',
    'silence.legato(0.25)',
  ].join(', ');
}

export const defaultDrumPatterns = [
  'bd [~ sd]*2 hh*2',
  'bd [~ sd] [bd bd] sd',
  '[bd ~] [sd ~] [bd bd] [sd ~]',
  'bd ~ [sd bd] ~',
  'bd*2 [~ sd] [~ bd] [sd*2 ~]',
  '[bd ~ bd ~] [~ sd ~ sd] [hh*4]',
  'bd [sd ~] bd [~ sd*2]',
  'bd [~ sd] [~ bd] [sd ~]',
  '[bd bd] sd bd [sd sd]',
  'bd [~ sd] bd*2 [~ sd]',
];

export const defaultAudienceDrumPatterns = [
  '0 [~ 0] 0 [~ 0]',
  '0 [~ 0]*2 0*2',
  '[0 ~] [0 0] [~ 0] 0',
  '0 ~ [0 0] ~',
  '0*2 [~ 0] [~ 0] 0',
  '[0 ~ 0 ~] [~ 0 ~ 0] [0*2]',
  '0 [0 ~] 0 [~ 0*2]',
  '[0 0] 0 [0 0] 0',
  '0 [~ 0] [0 0] [~ 0]',
  '0 ~ 0*2 [~ 0]',
];

export function randomDrumPattern() {
  return defaultDrumPatterns[Math.floor(Math.random() * defaultDrumPatterns.length)];
}

export function randomAudienceDrumPattern() {
  return defaultAudienceDrumPatterns[Math.floor(Math.random() * defaultAudienceDrumPatterns.length)];
}

/** Create a new random arrangement and update dashboard readouts on state. */
export function createArrangement(state, { regenChords = true, regenMelody = true, regenBass = true, regenDrums = true } = {}) {
  if (!state._arrangement) {
    state._arrangement = {};
  }
  const arr = state._arrangement;

  // Density = how many note/silence elements to generate
  const melodyCount = Math.max(1, Math.min(64, state.melodyDensity ?? 16));
  const bassCount   = Math.max(1, Math.min(64, state.bassDensity   ?? 16));

  if (regenChords) {
    arr.chordArray = randomChords(defaultChordPool, 4, 0);
    state.currentChord =
      arr.chordArray
        .map(([, sym]) => sym)
        .filter((sym) => sym !== '~')
        .join(' / ') || '—';
  }
  if (regenMelody) {
    arr.melodyArray = randomMelody([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], melodyCount, 0.25);
  }
  if (regenBass) {
    arr.bassArray = randomMelody([-7, -6, -5, -4, -3, -2, -1, 0, 1, 2], bassCount, 0.25);
  }
  if (regenDrums || !arr.drumPattern) {
    arr.drumPattern = randomDrumPattern();
    arr.audienceDrumPattern = randomAudienceDrumPattern();
  }

  return arr;
}

/** Build Strudel code for evaluate() from shared state + arrangement. */
export function buildStrudelCode(state) {
  const arr = state._arrangement;
  if (!arr?.chordArray) {
    createArrangement(state);
  }
  const { chordArray, melodyArray, bassArray } = state._arrangement;

  // ─── Time signature → cycles per measure ───
  // In Strudel with setcpm(), 1 cycle ≈ 1 beat.
  // A measure in X/Y time = X beats of Y-note value.
  // cyclesPerMeasure = timeSigNum × (4 / timeSigDen)
  //   4/4 → 4,  3/4 → 3,  6/8 → 3,  7/8 → 3.5,  5/4 → 5
  const tsNum = state.timeSigNum || 4;
  const tsDen = state.timeSigDen || 4;
  const cyclesPerMeasure = tsNum * (4 / tsDen);

  // ─── Slow values (FIXED — density does NOT change these) ───
  // Melody & bass span 2 measures (matching original v0.0.12 behavior).
  // More notes in the same span = audibly denser/faster.
  const noteSpan = cyclesPerMeasure * 2;    // 8 in 4/4 — matches original slow(8)

  // Chords: slowcat gives 1 chord per cycle; adding .slow(cyclesPerMeasure)
  // makes each chord last 1 full measure → 4 chords = 4 measures total.
  const chordSlow = cyclesPerMeasure;       // 4 in 4/4 — matches original slow(16)/4 chords

  // Drums: density adjusts the drum loop speed.
  // Default density 16 = 1 measure per loop. Higher = faster loop.
  const drumDensity = Math.max(1, Math.min(64, state.drumsDensity ?? 16));
  const drumSlow = cyclesPerMeasure * (16 / drumDensity);

  // ─── Per-track transpose ───
  const globalT = state.transpose || 0;
  const drumT = globalT + (state.drumsTranspose || 0) + ((state.drumsOctave || 0) * 12);
  const chordT = globalT + (state.chordsTranspose || 0) + ((state.chordsOctave || 0) * 12);
  const bassT = globalT + (state.bassTranspose || 0) + ((state.bassOctave || 0) * 12);
  const leadT = globalT + (state.melodyTranspose ?? state.leadTranspose ?? 0) + (((state.melodyOctave ?? state.leadOctave) || 0) * 12);

  const masterGain = state.gain.toFixed(2);
  const parts = [];

  // ─── Debug logging ───
  console.debug(`[generative] timeSig=${tsNum}/${tsDen}  cyclesPerMeasure=${cyclesPerMeasure}  noteSpan=${noteSpan}  chordSlow=${chordSlow}  drumSlow=${drumSlow}`);
  console.debug(`[generative] melodyDensity=${state.melodyDensity} (${melodyArray?.length} notes)  bassDensity=${state.bassDensity} (${bassArray?.length} notes)  drumsDensity=${drumDensity}`);

  // ─── Drums ───
  if (state.drumsOn) {
    const drumTransStr = drumT !== 0 ? `.transpose(${drumT})` : '';
    const drumSound = state.sampleBanks?.drum || state.instruments?.drum || 'RolandTR909';

    // Check if the selected drum sound is an audience-recorded sample
    const allAudienceSamples = getAllSamples();
    const isAudienceSample =
      drumSound === 'audience_drum' ||
      drumSound.startsWith('audience_') ||
      allAudienceSamples.some((s) => s.soundKey === drumSound);

    if (drumSound === 'synth' || drumSound === 'default') {
      parts.push(
        `n(seq(${formatDrumFallback()})).s("triangle")${drumTransStr}.release(0.05).gain(${state.drumsGain}).slow(${drumSlow})`,
      );
    } else if (isAudienceSample) {
      // For user-recorded audience drum samples
      const pattern = arr.audienceDrumPattern || '0 [~ 0] 0 [~ 0]';
      parts.push(
        `s("${pattern}").s("${drumSound}")${drumTransStr}.gain(${state.drumsGain}).slow(${drumSlow})`,
      );
    } else {
      // For all built-in drum kits (RolandTR909, RolandTR808, rolandtr909, linn, akaimpc60, rolandr8, etc.)
      // Use standard drum notation without commas
      const pattern = arr.drumPattern || 'bd [~ sd]*2 hh*2';
      parts.push(
        `s("${pattern}").bank("${drumSound}")${drumTransStr}.gain(${state.drumsGain}).slow(${drumSlow})`,
      );
    }
  }

  // ─── Chords ───
  // slowcat = 1 chord per cycle.  .slow(chordSlow) stretches each chord to
  // fill one full measure.  4 chords × 1 measure each = 4-measure cycle.
  if (state.chordsOn) {
    const chordSound = state.sampleBanks?.chord || state.instruments?.chord || 'sawtooth';
    parts.push(
      `slowcat(${formatChordPattern(chordArray)}).voicing().s("${chordSound}").transpose(${chordT}).lpf(${state.chordsLpf}).room(${state.chordsRoom}).gain(${state.chordsGain}).slow(${chordSlow})`,
    );
  }

  // ─── Bass ───
  // Fixed slow(noteSpan). Density only changes note count.
  // 16 notes in slow(8) = 2 notes/cycle = 8 notes/measure (busy)
  //  8 notes in slow(8) = 1 note/cycle  = 4 notes/measure (quarter-note bass)
  if (state.bassOn) {
    const bassSound = state.sampleBanks?.bass || state.instruments?.bass || 'sawtooth';
    parts.push(
      `n(seq(${formatMelodySeq(bassArray)})).scale("C:minor").s("${bassSound}").transpose(${bassT}).lpf(${state.bassLpf}).gain(${state.bassGain}).slow(${noteSpan})`,
    );
  }

  // ─── Melody ───
  // Fixed slow(noteSpan). Density only changes note count.
  // 16 notes in slow(8) = 2 notes/cycle = 8 notes/measure (eighth-note melody)
  // 32 notes in slow(8) = 4 notes/cycle = 16 notes/measure (sixteenth-note melody)
  //  8 notes in slow(8) = 1 note/cycle  = 4 notes/measure (quarter-note melody)
  if (state.melodyOn) {
    const leadSound = state.sampleBanks?.lead || state.instruments?.lead || 'triangle';
    parts.push(
      `n(seq(${formatMelodySeq(melodyArray)})).scale("C:minor").s("${leadSound}").slow(${noteSpan}).transpose(${leadT}).gain(${state.melodyGain}).delay(${state.melodyDelay})`,
    );
  }

  if (parts.length === 0) {
    return 'silence.play()';
  }

  return `
setcpm(${state.cpm});
stack(
  ${parts.join(',\n  ')}
).gain(${masterGain}).speed(${state.speed.toFixed(2)}).play()
`.trim();
}

