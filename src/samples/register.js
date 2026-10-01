import { samples } from '@strudel/web';

// <strudel-editor> bundles its own copy of Strudel's audio engine, separate from
// @strudel/web's, and the tracks play through the editor's copy. Its samples()
// loader isn't exported: its prebake only installs it as globalThis.samples,
// which initStrudel() later overwrites with @strudel/web's. Capture it first.
let editorSamples = null;

export async function captureEditorSampleLoader() {
  const editor = document.querySelector('strudel-editor')?.editor;
  if (!editor) return;
  await editor.prebaked;
  if (typeof globalThis.samples === 'function' && globalThis.samples !== samples) {
    editorSamples = globalThis.samples;
  } else {
    console.warn("[samples] Couldn't find the code editor's sample loader; recorded samples won't play in tracks.");
  }
}

/** Register the local audience sample catalog with both audio engines. */
export async function registerAudienceSamples() {
  // Cache-bust so renames and new recordings are picked up; _base in the
  // catalog keeps sample URLs pointing at /samples/.
  const url = `${window.location.origin}/strudel.json?t=${Date.now()}`;
  await Promise.all([samples(url), editorSamples?.(url)]);
}
