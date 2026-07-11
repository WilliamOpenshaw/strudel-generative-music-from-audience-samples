/**
 * Generative arrangement — port of strudel code/generative v0.0.12.js for @strudel/web evaluate().
 */

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

const kickPool = [
  "bd", "bd(3,8)", "bd(5,8)", "[bd bd]", "bd*2", "[bd ~ bd ~]", "bd(3,8,1)"
];
const snarePool = [
  "[~ sd]*2", "~ sd", "[~ sd ~ [sd*2]]", "[~ sd]*4", "[~ sd] ~", "~ [sd sd]"
];
const hihatPool = [
  "hh*2", "hh*4", "hh*8", "[hh hh hh ~]*2", "[~ hh]*4", "[hh*2 hh hh ~]*2"
];

export function randomDrums() {
  const kick = kickPool[Math.floor(Math.random() * kickPool.length)];
  const snare = snarePool[Math.floor(Math.random() * snarePool.length)];
  const hihat = hihatPool[Math.floor(Math.random() * hihatPool.length)];
  return `${kick}, ${snare}, ${hihat}`;
}

// Simple chord-to-notes mapping for synth playback
const CHORD_NOTES = {
  'Cm7':  '"C3, Eb3, G3, Bb3"',
  'Fm7':  '"F3, Ab3, C4, Eb4"',
  'Gm7':  '"G3, Bb3, D4, F4"',
  'Bb7':  '"Bb2, D3, F3, Ab3"',
  'EbM7': '"Eb3, G3, Bb3, D4"',
  'AbM7': '"Ab2, C3, Eb3, G3"',
  'Dm7':  '"D3, F3, A3, C4"',
  'Em7':  '"E3, G3, B3, D4"',
  'Am7':  '"A2, C3, E3, G3"',
  'BbM7': '"Bb2, D3, F3, A3"',
  'CM7':  '"C3, E3, G3, B3"',
  'FM7':  '"F3, A3, C4, E4"',
  'GM7':  '"G3, B3, D4, F#4"',
};

function formatChordPattern(chordArray) {
  return chordArray
    .map(([dur, sym]) => {
      if (sym === '~') return `silence`;
      const notes = CHORD_NOTES[sym];
      if (notes) {
        return `note(${notes}).legato(1)`;
      }
      // Fallback: try to use chord().voicing() for unknown chords
      return `chord("${sym}").voicing().legato(1)`;
    })
    .join(', ');
}

function formatMelodySeq(melodyArray) {
  return melodyArray
    .map(({ dur, note }) =>
      note === null ? `silence` : `pure(${note}).legato(1)`,
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

/** Create a new random arrangement and update dashboard readouts on state. */
export function createArrangement(state, { regenChords = true, regenMelody = true, regenBass = true, regenDrums = true } = {}) {
  if (!state._arrangement) {
    state._arrangement = {};
  }
  const arr = state._arrangement;

  if (regenChords) {
    arr.chordArray = randomChords(defaultChordPool, 4, 0);
    state.currentChord =
      arr.chordArray
        .map(([, sym]) => sym)
        .filter((sym) => sym !== '~')
        .join(' / ') || '—';
  }
  if (regenMelody) {
    arr.melodyArray = randomMelody([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 16, 0.25);
  }
  if (regenBass) {
    arr.bassArray = randomMelody([-7, -6, -5, -4, -3, -2, -1, 0, 1, 2], 8, 0.25);
  }
  if (regenDrums) {
    arr.drumString = randomDrums();
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
  const t = state.transpose;
  const masterGain = state.gain;
  const parts = [];

  const dGain = (state.drumsGain * masterGain).toFixed(2);
  const cGain = (state.chordsGain * masterGain).toFixed(2);
  const bGain = (state.bassGain * masterGain).toFixed(2);
  const mGain = (state.melodyGain * masterGain).toFixed(2);

  if (state.drumsOn) {
    const dString = arr.drumString || "bd, [~ sd]*2, hh*2";
    if (state.sampleBanks?.drum) {
      parts.push(
        `s("${dString}").bank("${state.sampleBanks.drum}").gain(${dGain}).slow(4)`,
      );
    } else {
      parts.push(
        `s("${dString}").gain(${dGain}).slow(4)`,
      );
    }
  }
  if (state.chordsOn) {
    const chordSource = state.sampleBanks?.chord
      ? `.s("piano").bank("${state.sampleBanks.chord}")`
      : '.s("sawtooth")';
    parts.push(
      `seq(${formatChordPattern(chordArray)})${chordSource}.transpose(${t}).lpf(${state.chordsLpf}).room(${state.chordsRoom}).gain(${cGain}).slow(16).pianoroll({ labels: 1 })`,
    );
  }
  if (state.bassOn) {
    const bassSource = state.sampleBanks?.bass
      ? `s("piano").bank("${state.sampleBanks.bass}")`
      : 's("sawtooth")';
    parts.push(
      `n(seq(${formatMelodySeq(bassArray)})).scale("C:minor").${bassSource}.transpose(${t}).lpf(${state.bassLpf}).gain(${bGain}).slow(8).pianoroll({ labels: 1 })`,
    );
  }
  if (state.melodyOn) {
    const leadSource = state.sampleBanks?.lead
      ? `s("piano").bank("${state.sampleBanks.lead}")`
      : 's("triangle")';
    parts.push(
      `n(seq(${formatMelodySeq(melodyArray)})).scale("C:minor").${leadSource}.slow(8).transpose(${t}).gain(${mGain}).delay(${state.melodyDelay}).pianoroll({ labels: 1 })`,
    );
  }

  if (parts.length === 0) {
    return 'silence.play()';
  }

  return `
setcpm(${Math.round(state.cpm * state.speed)});
stack(
  ${parts.join(',\n  ')}
).onTrigger(h => {
  if (window.updateStateFromStrudel) {
    window.updateStateFromStrudel(h);
  }
}, false)
`.trim();
}
