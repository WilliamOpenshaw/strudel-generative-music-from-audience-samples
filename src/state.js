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
  drumsGain: 0.5,
  chordsGain: 0.9,
  bassGain: 0.15,
  melodyGain: 0.5,

  // Per-layer effects
  chordsLpf: 1100,
  chordsRoom: 0.4,
  bassLpf: 500,
  melodyDelay: 0.3,

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

  // Note density — target number of note/silence elements per generation
  melodyDensity: 16,
  bassDensity: 16,
  drumsDensity: 16,

  // Time signature
  timeSigNum: 4,
  timeSigDen: 4,

  // Current instrument selection for each layer
  instruments: {
    lead: 'triangle',
    bass: 'sawtooth',
    chord: 'sawtooth',
    drum: 'default',
  },

  // Active sample banks / sound names
  sampleBanks: {
    lead: null,
    bass: null,
    chord: null,
    drum: null,
  },
};

export function setStatus(next) {
  state.status = next;
}
