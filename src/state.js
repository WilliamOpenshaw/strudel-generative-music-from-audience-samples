/** Shared performance state — dashboard writes, Strudel patterns read. */
export const state = {
  cpm: 120,
  gain: 0.8,
  speed: 1.0,
  transpose: 0,
  drumsOn: true,
  chordsOn: true,
  bassOn: true,
  melodyOn: true,
  currentChord: '—',
  currentScale: '—',
  currentNote: '—',
  status: 'Stopped',
  
  // Per-layer gain
  drumsGain: 0.50,
  chordsGain: 0.20,
  bassGain: 1.00,
  melodyGain: 1.00,

  // Per-layer effects
  drumsPan: 0.5, drumsDelay: 0, drumsLpf: 20000, drumsHpf: 0, drumsRoom: 0, drumsDistort: 0, drumsAttack: 0.01, drumsDecay: 0.1, drumsSustain: 1.0, drumsRelease: 0.1,
  chordsPan: 0.5, chordsDelay: 0, chordsLpf: 1100, chordsHpf: 0, chordsRoom: 0.4, chordsDistort: 0, chordsAttack: 0.01, chordsDecay: 0.1, chordsSustain: 1.0, chordsRelease: 0.1,
  bassPan: 0.5, bassDelay: 0, bassLpf: 500, bassHpf: 0, bassRoom: 0, bassDistort: 0, bassAttack: 0.01, bassDecay: 0.1, bassSustain: 1.0, bassRelease: 0.1,
  melodyPan: 0.5, melodyDelay: 0.3, melodyLpf: 20000, melodyHpf: 0, melodyRoom: 0, melodyDistort: 0, melodyAttack: 0.01, melodyDecay: 0.1, melodySustain: 1.0, melodyRelease: 0.1,

  // Per-layer independent transpose (in semitone steps)
  leadTranspose: 0,
  melodyTranspose: 0,
  chordsTranspose: 0,
  bassTranspose: 0,
  drumsTranspose: 0,

  // Per-layer octave offset (in octaves: -2, -1, 0, 1, 2 etc.)
  leadOctave: 0,
  melodyOctave: 0,
  chordsOctave: 0,
  bassOctave: 0,
  drumsOctave: 0,

  // Active Pad Bank (1 or 2)
  activePadBank: 1,

  // Pad Bank assignments (Pads 1-15 -> sample key) for two banks
  padBanks: {
    1: {},
    2: {}
  },

  // Note density — target number of note/silence elements per generation
  melodyDensity: 8,
  bassDensity: 8,
  drumsDensity: 8,

  // Octave range for random note generation (1, 3, or 5 octaves)
  melodyOctaveRange: 1,
  bassOctaveRange: 1,

  // Time signature
  timeSigNum: 4,
  timeSigDen: 4,

  // Current instrument selection for each layer
  instruments: {
    lead: 'triangle',
    bass: 'sawtooth',
    chord: 'sawtooth',
    drum: 'RolandTR909',
  },

  // Active sample banks / sound names
  sampleBanks: {
    lead: 'triangle',
    bass: 'sawtooth',
    chord: 'sawtooth',
    drum: 'RolandTR909',
  },
};

export function setStatus(next) {
  state.status = next;
}
