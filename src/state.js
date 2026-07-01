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
  currentNote: '—',
  status: 'Stopped',
  
  // Per-layer gain
  drumsGain: 0.1,
  chordsGain: 0.9,
  bassGain: 0.15,
  melodyGain: 0.5,

  // Per-layer effects
  chordsLpf: 1100,
  chordsRoom: 0.4,
  bassLpf: 500,
  melodyDelay: 0.3,

  // Sample bank selection (null = use synth fallback)
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
