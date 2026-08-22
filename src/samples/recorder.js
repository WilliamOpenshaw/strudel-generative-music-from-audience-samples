/**
 * recorder.js — Live mic recording for audience samples in Strudel Dashboard.
 *
 * Records audio using MediaRecorder, uploads to /upload-sample, refreshes
 * Strudel catalog, and selects the newly recorded sample in the editor.
 */

import { refreshSampleList, selectFile } from './editor.js';
import { loadCatalog, applyCatalogToState } from './catalog.js';
import { state } from '../state.js';

let mediaRecorder = null;
let audioChunks = [];
let recordStream = null;

export function initSampleRecorder() {
  const recordBtn = document.getElementById('record-btn');
  const stopBtn = document.getElementById('stop-record-btn');
  const layerSelect = document.getElementById('record-layer-select');
  const statusEl = document.getElementById('recording-status');

  if (!recordBtn || !stopBtn) return;

  function setStatus(text, isError = false) {
    if (statusEl) {
      statusEl.textContent = text;
      statusEl.style.color = isError ? 'var(--danger)' : 'var(--text-secondary)';
    }
  }

  recordBtn.addEventListener('click', async () => {
    try {
      setStatus('Requesting microphone access...');
      recordStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunks = [];

      const options = {};
      if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
        options.mimeType = 'audio/webm;codecs=opus';
      } else if (MediaRecorder.isTypeSupported('audio/webm')) {
        options.mimeType = 'audio/webm';
      } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
        options.mimeType = 'audio/mp4';
      }

      mediaRecorder = new MediaRecorder(recordStream, options);

      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunks.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        setStatus('Processing and uploading sample...');
        recordBtn.disabled = false;
        stopBtn.disabled = true;

        // Stop stream tracks
        if (recordStream) {
          recordStream.getTracks().forEach((track) => track.stop());
          recordStream = null;
        }

        const mimeType = mediaRecorder.mimeType || 'audio/webm';
        const blob = new Blob(audioChunks, { type: mimeType });
        const reader = new FileReader();

        reader.onloadend = async () => {
          const dataUri = reader.result;
          const layer = layerSelect ? layerSelect.value : 'audience_lead';

          try {
            const res = await fetch('/upload-sample', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ layer, dataUri }),
            });

            if (res.ok) {
              const data = await res.json();
              setStatus(`Saved: ${data.filename}`);

              // Reload catalog & editor
              await loadCatalog(true);
              applyCatalogToState(state);

              try {
                const { samples } = await import('@strudel/web');
                await samples(`${window.location.origin}/strudel.json`);
              } catch (e) {
                console.warn('[recorder] Strudel refresh warning:', e);
              }

              await refreshSampleList();

              // Select the new file in the editor
              if (data.filename) {
                await selectFile(data.filename);
              }
            } else {
              throw new Error(`Server returned ${res.status}`);
            }
          } catch (err) {
            console.error('[recorder] Upload error:', err);
            setStatus(`Upload failed: ${err.message || err}`, true);
          }
        };

        reader.readAsDataURL(blob);
      };

      mediaRecorder.start();
      recordBtn.disabled = true;
      stopBtn.disabled = false;
      setStatus('🔴 Recording... Speak or play now!');
    } catch (err) {
      console.error('[recorder] Mic access error:', err);
      setStatus(`Mic error: ${err.message || 'Access denied'}`, true);
      recordBtn.disabled = false;
      stopBtn.disabled = true;
    }
  });

  stopBtn.addEventListener('click', () => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
    }
  });
}
