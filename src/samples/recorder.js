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

/**
 * Query available audio input devices and update the microphone name readout.
 * If an active audio track is provided, its label takes precedence.
 */
async function updateMicInfo(activeTrack = null) {
  const micNameEl = document.getElementById('record-mic-name');
  if (!micNameEl) return;

  if (activeTrack && activeTrack.label) {
    micNameEl.textContent = activeTrack.label;
    micNameEl.title = activeTrack.label;
    return;
  }

  if (!navigator.mediaDevices?.enumerateDevices) {
    micNameEl.textContent = 'Default Microphone';
    micNameEl.title = 'Default audio input device';
    return;
  }

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter((d) => d.kind === 'audioinput');
    const defaultMic = audioInputs.find((d) => d.deviceId === 'default') || audioInputs[0];
    if (defaultMic && defaultMic.label) {
      micNameEl.textContent = defaultMic.label;
      micNameEl.title = defaultMic.label;
    } else if (audioInputs.length > 0) {
      micNameEl.textContent = 'Default Microphone';
      micNameEl.title = 'Default audio input device (start recording to query detailed name)';
    } else {
      micNameEl.textContent = 'No microphone found';
      micNameEl.title = 'No audio input devices detected';
    }
  } catch (err) {
    console.warn('[recorder] Error detecting microphone:', err);
    micNameEl.textContent = 'Default Microphone';
  }
}

export function initSampleRecorder() {
  const recordBtn = document.getElementById('record-btn');
  const stopBtn = document.getElementById('stop-record-btn');
  const layerSelect = document.getElementById('record-layer-select');
  const statusEl = document.getElementById('recording-status');

  if (!recordBtn || !stopBtn) return;

  // Initialize microphone device name readout and listen for device changes
  updateMicInfo();
  navigator.mediaDevices?.addEventListener?.('devicechange', () => updateMicInfo());

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

      // Update microphone label from the active audio track
      const audioTrack = recordStream.getAudioTracks()[0];
      if (audioTrack) {
        updateMicInfo(audioTrack);
      }

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
