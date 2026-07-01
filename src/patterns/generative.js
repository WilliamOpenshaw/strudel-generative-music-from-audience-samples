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

function formatChordSeq(chordArray) {
  return chordArray.map(([dur, sym]) => `[${dur},"${sym}"]`).join(', ');
}

function formatMelodySeq(melodyArray) {
  return melodyArray
    .map(({ dur, note }) =>
      note === null ? `silence.legato(${dur})` : `pure(${note}).legato(${dur})`,
    )
    .join(', ');
}

/** Create a new random arrangement and update dashboard readouts on state. */
export function createArrangement(state, { regenChords = true, regenMelody = true, regenBass = true } = {}) {
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
  const masterGain = state.gain.toFixed(2);
  const parts = [];

  if (state.drumsOn) {
    const drumBank = state.sampleBanks?.drum ? `"${state.sampleBanks.drum}"` : '"bd, [~ sd]*2, hh*2"';
    const drumMod = state.sampleBanks?.drum ? '' : '.bank("RolandTR909")';
    parts.push(`s(${drumBank})${drumMod}.gain(${state.drumsGain}).slow(4)`);
  }
  if (state.chordsOn) {
    const chordBank = state.sampleBanks?.chord || 'sawtooth';
    parts.push(
      `chord(seq(${formatChordSeq(chordArray)})).voicing().s("${chordBank}").transpose(${t}).lpf(${state.chordsLpf}).room(${state.chordsRoom}).gain(${state.chordsGain}).slow(16)._pianoroll({ labels: 1 })`,
    );
  }
  if (state.bassOn) {
    const bassBank = state.sampleBanks?.bass || 'sawtooth';
    parts.push(
      `n(seq(${formatMelodySeq(bassArray)})).scale("C:minor").s("${bassBank}").transpose(${t}).lpf(${state.bassLpf}).gain(${state.bassGain}).slow(8)._pianoroll({ labels: 1 })`,
    );
  }
  if (state.melodyOn) {
    const leadBank = state.sampleBanks?.lead || 'triangle';
    parts.push(
      `n(seq(${formatMelodySeq(melodyArray)})).scale("C:minor").s("${leadBank}").slow(8).transpose(${t}).gain(${state.melodyGain}).delay(${state.melodyDelay})._pianoroll({ labels: 1 })`,
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
