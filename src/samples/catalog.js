/**
 * Sample catalog — detects which audience sample banks are available
 * by fetching /strudel.json and inspecting each role's file list.
 */

/** Which roles have at least one audience sample loaded. */
export const sampleAvailability = {
  lead: false,
  bass: false,
  chord: false,
  drum: false,
};

/** Raw catalog data (populated after loadCatalog). */
export let catalogData = null;

/**
 * Fetch /strudel.json and determine which audience sample banks exist.
 * Safe to call multiple times — only fetches once.
 * Returns the availability object.
 */
export async function loadCatalog() {
  if (catalogData !== null) return sampleAvailability;

  try {
    const res = await fetch('/strudel.json');
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
  // Also handle object-style mapping { note: 'file.wav', ... }
  if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
    return Object.keys(entry).length > 0;
  }
  return false;
}

/**
 * Apply sample availability to the shared state's sampleBanks.
 * Call this after loadCatalog() to populate state.sampleBanks.
 */
export function applyCatalogToState(state) {
  state.sampleBanks.lead = sampleAvailability.lead ? 'audience_lead' : null;
  state.sampleBanks.bass = sampleAvailability.bass ? 'audience_bass' : null;
  state.sampleBanks.chord = sampleAvailability.chord ? 'audience_chord' : null;
  state.sampleBanks.drum = sampleAvailability.drum ? 'audience_drum' : null;
}
