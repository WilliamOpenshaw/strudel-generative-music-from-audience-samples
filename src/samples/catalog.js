/**
 * Sample catalog — detects which audience sample banks and individual sample
 * files are available by fetching /strudel.json.
 */

export const sampleAvailability = {
  lead: false,
  bass: false,
  chord: false,
  drum: false,
};

/** Raw catalog data (populated after loadCatalog). */
export let catalogData = null;

/**
 * Fetch /strudel.json and determine which audience sample banks and files exist.
 * Pass force=true to re-fetch from server.
 */
export async function loadCatalog(force = false) {
  if (!force && catalogData !== null) return sampleAvailability;

  try {
    const res = await fetch(`/strudel.json?t=${Date.now()}`);
    if (!res.ok) {
      console.info('[catalog] No /strudel.json found — using synth fallback for all layers.');
      catalogData = {};
      return sampleAvailability;
    }

    catalogData = await res.json();

    // Check each role for non-empty file arrays
    sampleAvailability.lead = hasFiles(catalogData, 'audience_lead');
    sampleAvailability.bass = hasFiles(catalogData, 'audience_bass');
    sampleAvailability.chord = hasFiles(catalogData, 'audience_chord');
    sampleAvailability.drum = hasFiles(catalogData, 'audience_drum');

    console.info('[catalog] Sample availability:', { ...sampleAvailability });
  } catch (err) {
    console.warn('[catalog] Failed to load /strudel.json:', err);
    catalogData = {};
  }

  return sampleAvailability;
}

/**
 * Check if a bank key in the catalog has at least one file entry.
 */
function hasFiles(catalog, key) {
  const entry = catalog[key];
  if (Array.isArray(entry) && entry.length > 0) return true;
  if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
    return Object.keys(entry).length > 0;
  }
  return false;
}

/**
 * Get all individual sample files with friendly names and layer metadata.
 */
export function getAllSamples() {
  if (!catalogData) return [];

  const items = [];
  const seenFiles = new Set();

  const layerMap = {
    audience_lead: 'Lead',
    audience_bass: 'Bass',
    audience_chord: 'Chords',
    audience_drum: 'Drums',
  };

  for (const [layerKey, layerLabel] of Object.entries(layerMap)) {
    const files = catalogData[layerKey];
    if (Array.isArray(files)) {
      files.forEach((filename) => {
        if (!seenFiles.has(filename)) {
          seenFiles.add(filename);
          const soundKey = filename.replace(/\.[^.]+$/, '');
          items.push({
            filename,
            soundKey,
            layerKey,
            layerLabel,
            displayName: soundKey,
          });
        }
      });
    }
  }

  return items;
}

/**
 * Apply detected sample availability to the global state object.
 */
export function applyCatalogToState(state) {
  if (!state.sampleBanks) {
    state.sampleBanks = {
      lead: 'triangle',
      bass: 'sawtooth',
      chord: 'sawtooth',
      drum: 'RolandTR909',
    };
  }
}
