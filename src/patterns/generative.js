/**
 * Generative arrangement — port of strudel code/generative v0.0.12.js for @strudel/web evaluate().
 */

import { getAllSamples } from '../samples/catalog.js';

export const SCALES = {
  minor: { scaleStr: 'minor', chordPool: ['Cm7', 'Fm7', 'Gm7', 'Bb7', 'EbM7', 'AbM7'] },
  major: { scaleStr: 'major', chordPool: ['CM7', 'Dm7', 'Em7', 'FM7', 'G7', 'Am7'] },
  dorian: { scaleStr: 'dorian', chordPool: ['Cm7', 'Dm7', 'EbM7', 'F7', 'Gm7', 'Am7b5', 'BbM7'] },
  mixolydian: { scaleStr: 'mixolydian', chordPool: ['C7', 'Dm7', 'Em7b5', 'FM7', 'Gm7', 'Am7', 'BbM7'] },
};

export const defaultChordPool = SCALES.minor.chordPool;

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

/**
 * Generate the scale degree pool based on octave range (1, 3, or 5 octaves).
 * Diatonic / heptatonic scale in Strudel has 7 degrees per octave.
 * 1 octave = current octave.
 * 3 octaves = current octave + 1 octave above + 1 octave below.
 * 5 octaves = current octave + 2 octaves above + 2 octaves below.
 */
export function getScaleDegreePool(track, octaveRange = 1) {
  const span = octaveRange === 5 ? 2 : (octaveRange === 3 ? 1 : 0);

  if (track === 'bass') {
    // Current octave for bass is [-7..0]
    // 1 octave: -7 to 0
    // 3 octaves: -14 to 7
    // 5 octaves: -21 to 14
    const min = -7 - span * 7;
    const max = 0 + span * 7;
    const pool = [];
    for (let d = min; d <= max; d++) {
      pool.push(d);
    }
    return pool;
  } else {
    // Current octave for melody is [0..7]
    // 1 octave: 0 to 7
    // 3 octaves: -7 to 14
    // 5 octaves: -14 to 21
    const min = 0 - span * 7;
    const max = 7 + span * 7;
    const pool = [];
    for (let d = min; d <= max; d++) {
      pool.push(d);
    }
    return pool;
  }
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

/**
 * Generate a procedural drum pattern based on density and time signature beats.
 * Density (1-128) determines the probability of hits and subdivisions.
 */
export function generateProceduralDrumPattern(density, beats, isAudience) {
  const elements = [];
  // 1.0 at 64; 128 goes past it to add even more subdivisions.
  const normalizedDensity = Math.max(1, Math.min(128, density)) / 64;

  const insts = isAudience ? ['0'] : ['bd', 'sd', 'hh'];

  for (let b = 0; b < beats; b++) {
    // Determine complexity of this beat
    const rand = Math.random();

    if (rand > normalizedDensity + 0.3) {
      // Rest
      elements.push('~');
    } else if (rand < normalizedDensity * 0.4) {
      // Subdivision (2, 3, or 4 hits)
      const subCount = Math.random() > 0.8 ? 4 : (Math.random() > 0.5 ? 3 : 2);
      const subElements = [];
      for (let i = 0; i < subCount; i++) {
        if (Math.random() > 0.8) {
          subElements.push('~');
        } else {
          subElements.push(insts[Math.floor(Math.random() * insts.length)]);
        }
      }
      elements.push(`[${subElements.join(' ')}]`);
    } else {
      // Single hit
      elements.push(insts[Math.floor(Math.random() * insts.length)]);
    }
  }

  return elements.join(' ');
}

/** Create a new random arrangement and update dashboard readouts on state. */
export function createArrangement(state, { regenChords = true, regenMelody = true, regenBass = true, regenDrums = true } = {}) {
  if (!state._arrangement) {
    state._arrangement = {};
  }
  const arr = state._arrangement;

  // Density = how many note/silence elements to generate
  const melodyCount = Math.max(1, Math.min(128, state.melodyDensity ?? 8));
  const bassCount = Math.max(1, Math.min(128, state.bassDensity ?? 8));

  if (regenChords) {
    const scaleMode = state.scaleMode || 'minor';
    const chordPool = SCALES[scaleMode]?.chordPool || SCALES.minor.chordPool;
    
    let length = state.chordProgressionLength || 4;
    if (length === 'random') {
      length = Math.random() > 0.5 ? 4 : 6;
    } else {
      length = parseInt(length, 10);
    }
    
    arr.chordArray = randomChords(chordPool, length, 0);
    state.currentChord =
      arr.chordArray
        .map(([, sym]) => sym)
        .filter((sym) => sym !== '~')
        .join(' / ') || '—';
  }
  const melodyOctRange = state.melodyOctaveRange ?? 1;
  const bassOctRange = state.bassOctaveRange ?? 1;

  if (regenMelody) {
    const melodyPool = getScaleDegreePool('melody', melodyOctRange);
    arr.melodyArray = randomMelody(melodyPool, melodyCount, 0.25);
  }
  if (regenBass) {
    const bassPool = getScaleDegreePool('bass', bassOctRange);
    arr.bassArray = randomMelody(bassPool, bassCount, 0.25);
  }
  if (regenDrums || !arr.drumPattern) {
    const tsNum = state.timeSigNum || 4;
    const drumDensity = Math.max(1, Math.min(128, state.drumsDensity ?? 8));
    arr.drumPattern = generateProceduralDrumPattern(drumDensity, tsNum, false);
    arr.audienceDrumPattern = generateProceduralDrumPattern(drumDensity, tsNum, true);
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

  // Drums: density is handled by the procedural generator, so we just span it over 1 measure.
  const drumDensity = Math.max(1, Math.min(128, state.drumsDensity ?? 16));
  const drumSlow = cyclesPerMeasure;

  // ─── Per-track transpose ───
  const globalT = state.transpose || 0;
  const drumT = globalT + (state.drumsTranspose || 0) + ((state.drumsOctave || 0) * 12);
  const chordT = globalT + (state.chordsTranspose || 0) + ((state.chordsOctave || 0) * 12);
  const bassT = globalT + (state.bassTranspose || 0) + ((state.bassOctave || 0) * 12);
  const leadT = globalT + (state.melodyTranspose ?? state.leadTranspose ?? 0) + (((state.melodyOctave ?? state.leadOctave) || 0) * 12);

  const masterGain = state.gain !== undefined ? Number(state.gain) : 1.0;
  const parts = [];

  // ─── Debug logging ───
  console.debug(`[generative] timeSig=${tsNum}/${tsDen}  cyclesPerMeasure=${cyclesPerMeasure}  noteSpan=${noteSpan}  chordSlow=${chordSlow}  drumSlow=${drumSlow}`);
  console.debug(`[generative] melodyDensity=${state.melodyDensity} (${melodyArray?.length} notes)  bassDensity=${state.bassDensity} (${bassArray?.length} notes)  drumsDensity=${drumDensity}`);


  function getFx(track) {
    const pan = state[`${track}Pan`] ?? 0.5;
    const delay = state[`${track}Delay`] ?? 0;
    const lpf = state[`${track}Lpf`] ?? 20000;
    const hpf = state[`${track}Hpf`] ?? 0;
    const room = state[`${track}Room`] ?? 0;
    const distort = state[`${track}Distort`] ?? 0;
    const atk = state[`${track}Attack`] ?? 0.01;
    const dec = state[`${track}Decay`] ?? 0.1;
    const sus = state[`${track}Sustain`] ?? 1.0;
    const rel = state[`${track}Release`] ?? 0.1;

    // Formatting exact newlines per user request
    return `\n.pan(${pan})\n.delay(${delay})\n.lpf(${lpf}).hpf(${hpf})\n.room(${room})\n.shape(${distort})\n.attack(${atk}).decay(${dec}).sustain(${sus}).release(${rel})`;
  }

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

    const dGain = (Number(state.drumsGain ?? 0.5) * masterGain).toFixed(2);
    if (drumSound === 'synth' || drumSound === 'default') {
      parts.push(
        `\n//drums\n  n(seq(${formatDrumFallback()})).s("triangle")${drumTransStr}\n.gain(${dGain})${getFx("drums")}\n.slow(${drumSlow})`
      );
    } else if (isAudienceSample) {
      // For user-recorded audience drum samples
      const pattern = arr.audienceDrumPattern || '0 [~ 0] 0 [~ 0]';
      parts.push(
        `\n//drums\n  s("${pattern}").s("${drumSound}")${drumTransStr}\n.gain(${dGain})${getFx("drums")}\n.slow(${drumSlow})`
      );
    } else {
      // For all built-in drum kits (RolandTR909, RolandTR808, rolandtr909, linn, akaimpc60, rolandr8, etc.)
      // Use standard drum notation without commas
      const pattern = arr.drumPattern || 'bd [~ sd]*2 hh*2';
      parts.push(
        `\n//drums\n  s("${pattern}").bank("${drumSound}")${drumTransStr}\n.gain(${dGain})${getFx("drums")}\n.slow(${drumSlow})`
      );
    }
  }

  // ─── Chords ───
  // slowcat = 1 chord per cycle.  .slow(chordSlow) stretches each chord to
  // fill one full measure.  4 chords × 1 measure each = 4-measure cycle.
  if (state.chordsOn) {
    const chordSound = state.sampleBanks?.chord || state.instruments?.chord || 'sawtooth';
    const cGain = (Number(state.chordsGain ?? 0.9) * masterGain).toFixed(2);
    
    let chordModifier = '.voicing()';
    if (state.chordStyle === 'arp_up') {
      chordModifier += '.arp("0 1 2 3").fast(2)';
    } else if (state.chordStyle === 'arp_pendulum') {
      chordModifier += '.arp("0 1 2 3 2 1").fast(2)';
    } else if (state.chordStyle === 'stabs') {
      chordModifier += '.struct("x [~ x] ~ x")';
    }

    parts.push(
      `\n//chords\n  slowcat(${formatChordPattern(chordArray)})\n${chordModifier}\n.s("${chordSound}")\n.transpose(${chordT})\n.gain(${cGain})${getFx("chords")}\n.slow(${chordSlow})`,
    );
  }

  const globalScaleMode = state.scaleMode || 'minor';
  const scaleStr = `C:${SCALES[globalScaleMode]?.scaleStr || 'minor'}`;

  // ─── Bass ───
  // Fixed slow(noteSpan). Density only changes note count.
  // 16 notes in slow(8) = 2 notes/cycle = 8 notes/measure (busy)
  //  8 notes in slow(8) = 1 note/cycle  = 4 notes/measure (quarter-note bass)
  if (state.bassOn) {
    const bassSound = state.sampleBanks?.bass || state.instruments?.bass || 'sawtooth';
    const bGain = (Number(state.bassGain ?? 0.15) * masterGain).toFixed(2);
    parts.push(
      `\n//bass\n  n(seq(${formatMelodySeq(bassArray)}))\n.scale("${scaleStr}")\n.s("${bassSound}")\n.transpose(${bassT})\n.gain(${bGain})${getFx("bass")}\n.slow(${noteSpan})`,
    );
  }

  // ─── Melody ───
  // Fixed slow(noteSpan). Density only changes note count.
  // 16 notes in slow(8) = 2 notes/cycle = 8 notes/measure (eighth-note melody)
  // 32 notes in slow(8) = 4 notes/cycle = 16 notes/measure (sixteenth-note melody)
  //  8 notes in slow(8) = 1 note/cycle  = 4 notes/measure (quarter-note melody)
  if (state.melodyOn) {
    const leadSound = state.sampleBanks?.lead || state.instruments?.lead || 'triangle';
    const mGain = (Number(state.melodyGain ?? 0.5) * masterGain).toFixed(2);
    parts.push(
      `\n//melody\n  n(seq(${formatMelodySeq(melodyArray)}))\n.scale("${scaleStr}")\n.s("${leadSound}")\n.transpose(${leadT})\n.gain(${mGain})${getFx("melody")}\n.slow(${noteSpan})`,
    );
  }

  if (parts.length === 0) {
    return 'silence.play()';
  }

  return `
setcpm(${state.cpm});
stack(
  ${parts.join(',\n  ')}

).fast(${state.speed.toFixed(2)}).play()
`.trim();
}

