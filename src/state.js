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
};

export function setStatus(next) {
  state.status = next;
}
