/**
 * Sample catalog — detects which audience sample banks and individual sample
 * files are available by fetching /strudel.json.
 */

import { SAMPLE_LAYERS, SAMPLE_LAYER_KEYS } from './layers.js';

/** Per recording layer (e.g. `audience_lines`): does it have any files? */
export const sampleAvailability = Object.fromEntries(SAMPLE_LAYER_KEYS.map((key) => [key, false]));

/** Instruments each track falls back to when it has no (or a deleted) recording. */
export const DEFAULT_INSTRUMENTS = {
  lead: 'triangle',
  bass: 'sawtooth',
  chord: 'sawtooth',
  drum: 'RolandTR909',
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

    for (const key of SAMPLE_LAYER_KEYS) {
      sampleAvailability[key] = hasFiles(catalogData, key);
    }

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

  for (const [layerKey, layerLabel] of Object.entries(SAMPLE_LAYERS)) {
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

const DEFAULT_NAME_PATTERN = new RegExp(`^(${SAMPLE_LAYER_KEYS.join('|')})_\\d+$`);

/** True for names the recorder gives before a sample is renamed, e.g. "audience_lead_1789044106422". */
export function isDefaultSampleName(soundKey) {
  return DEFAULT_NAME_PATTERN.test(soundKey);
}

/**
 * Renamed samples only, most recently recorded first. Falls back to catalog
 * order (which is also newest-first per layer) if dates are unavailable.
 */
export async function getRenamedSamplesNewestFirst() {
  const renamed = getAllSamples().filter((s) => !isDefaultSampleName(s.soundKey));
  let dates = {};
  try {
    const res = await fetch('/api/sample-dates');
    if (res.ok) dates = await res.json();
  } catch (err) {
    console.warn('[catalog] Could not load sample dates, using catalog order:', err);
  }
  return renamed
    .map((sample, index) => ({ sample, index, date: dates[sample.filename] ?? 0 }))
    .sort((a, b) => b.date - a.date || a.index - b.index)
    .map(({ sample }) => sample);
}

/**
 * Apply detected sample availability to the global state object.
 */
export function applyCatalogToState(state) {
  if (!state.sampleBanks) {
    state.sampleBanks = { ...DEFAULT_INSTRUMENTS };
  }
}
