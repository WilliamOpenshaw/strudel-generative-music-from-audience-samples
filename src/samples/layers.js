/**
 * Recording categories ("layers"): the recorder's dropdown, the strudel.json
 * catalog arrays, and default recording names (`<layer>_<timestamp>`) all use
 * these keys. Shared by server.js and browser code, so plain JS only.
 */
export const SAMPLE_LAYERS = {
  audience_lead: 'Lead',
  audience_bass: 'Bass',
  audience_chord: 'Chords',
  audience_drum: 'Drums',
  audience_lines: 'Lines',
  audience_effects: 'Effects',
};

export const SAMPLE_LAYER_KEYS = Object.keys(SAMPLE_LAYERS);

/** Recording categories that feed a pad bank directly (pad bank number). */
export const LAYER_PAD_BANKS = {
  audience_lines: 1, // Lines
  audience_effects: 2, // Effects
};
