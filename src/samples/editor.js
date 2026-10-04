import { getAudioContext } from '@strudel/web';
import { detectPitch, pitchShiftBuffer } from './pitch.js';
import { registerAudienceSamples } from './register.js';
import { SAMPLE_LAYER_KEYS } from './layers.js';

let audioCtx;
let originalBuffer = null;
let currentSampleName = null;
let previewSource = null;
let currentPitchAnalysis = null;
let pitchAnalysisTimeout = null;

// UI Elements
let canvas, ctx;
let btnPrev, btnNext, selectSample;
let btnPreview, btnSave, btnDelete;
let playheadEl;
let inputRename, btnRename;

// Pitch UI Elements
let elDetectedPitch, elTargetPitch, elShiftAmount;
let inputTuneC, selectTargetOctave, inputFineTune, displayFineTune, btnReanalyze;

let catalogData = {};
let availableSamples = [];
let currentIndex = -1;
let onCatalogUpdatedCallback = null;
let onSampleDeletedCallback = null;

export function setOnCatalogUpdated(fn) {
  onCatalogUpdatedCallback = fn;
}

/** Called with the deleted sample's sound key (filename without extension). */
export function setOnSampleDeleted(fn) {
  onSampleDeletedCallback = fn;
}

function getSliders() {
  return {
    attack: parseFloat(document.getElementById('editor-attack')?.value || '0'),
    decay: parseFloat(document.getElementById('editor-decay')?.value || '0'),
    sustain: parseFloat(document.getElementById('editor-sustain')?.value || '1'),
    release: parseFloat(document.getElementById('editor-release')?.value || '0.1'),
    trimStart: parseFloat(document.getElementById('editor-trim-start')?.value || '0'),
    trimEnd: parseFloat(document.getElementById('editor-trim-end')?.value || '1'),
    fadeIn: parseFloat(document.getElementById('editor-fade-in')?.value || '0'),
    fadeOut: parseFloat(document.getElementById('editor-fade-out')?.value || '0'),
    crossfade: parseFloat(document.getElementById('editor-crossfade')?.value || '0'),
    normalize: document.getElementById('editor-normalize')?.checked ?? true,
    tuneToC: document.getElementById('editor-tune-c')?.checked ?? true,
    targetOctave: document.getElementById('editor-target-octave')?.value || 'nearest',
    fineTuneCents: parseFloat(document.getElementById('editor-fine-tune')?.value || '0'),
  };
}

export async function initSampleEditor() {
  canvas = document.getElementById('editor-waveform');
  if (!canvas) return;
  ctx = canvas.getContext('2d');

  btnPrev = document.getElementById('editor-prev-btn');
  btnNext = document.getElementById('editor-next-btn');
  selectSample = document.getElementById('editor-sample-select');
  btnPreview = document.getElementById('editor-preview-btn');
  btnSave = document.getElementById('editor-save-btn');
  btnDelete = document.getElementById('editor-delete-btn');
  playheadEl = document.getElementById('editor-playhead');
  inputRename = document.getElementById('editor-rename-input');
  btnRename = document.getElementById('editor-rename-btn');

  // Pitch UI
  elDetectedPitch = document.getElementById('editor-detected-pitch');
  elTargetPitch = document.getElementById('editor-target-pitch');
  elShiftAmount = document.getElementById('editor-shift-amount');
  inputTuneC = document.getElementById('editor-tune-c');
  selectTargetOctave = document.getElementById('editor-target-octave');
  inputFineTune = document.getElementById('editor-fine-tune');
  displayFineTune = document.getElementById('editor-fine-tune-display');
  btnReanalyze = document.getElementById('editor-reanalyze-btn');

  // Resize canvas to physical pixels
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;

  // Bind events
  btnPrev?.addEventListener('click', () => selectIndex(currentIndex - 1));
  btnNext?.addEventListener('click', () => selectIndex(currentIndex + 1));
  selectSample?.addEventListener('change', (e) => selectFile(e.target.value));

  btnPreview?.addEventListener('click', togglePreview);
  btnSave?.addEventListener('click', saveSample);
  btnDelete?.addEventListener('click', deleteSample);
  btnRename?.addEventListener('click', renameSample);
  inputRename?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      renameSample();
    }
  });

  // Bind slider changes to re-draw & re-analyze
  const sliderIds = ['attack', 'decay', 'sustain', 'release', 'trim-start', 'trim-end', 'fade-in', 'fade-out', 'crossfade'];
  sliderIds.forEach((id) => {
    document.getElementById(`editor-${id}`)?.addEventListener('input', () => {
      if (id === 'trim-start') {
        const start = document.getElementById('editor-trim-start');
        const end = document.getElementById('editor-trim-end');
        if (parseFloat(start.value) >= parseFloat(end.value)) start.value = end.value - 0.001;
        debouncedPitchAnalysis();
      }
      if (id === 'trim-end') {
        const start = document.getElementById('editor-trim-start');
        const end = document.getElementById('editor-trim-end');
        if (parseFloat(end.value) <= parseFloat(start.value)) end.value = parseFloat(start.value) + 0.001;
        debouncedPitchAnalysis();
      }
      drawWaveform();
    });
  });

  document.getElementById('editor-normalize')?.addEventListener('change', drawWaveform);

  // Pitch tuning listeners
  inputTuneC?.addEventListener('change', () => {
    updatePitchUI(currentPitchAnalysis);
  });

  selectTargetOctave?.addEventListener('change', () => {
    debouncedPitchAnalysis();
  });

  inputFineTune?.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    if (displayFineTune) {
      displayFineTune.innerText = `${val > 0 ? '+' : ''}${val}¢`;
    }
    debouncedPitchAnalysis();
  });

  btnReanalyze?.addEventListener('click', () => {
    analyzePitchNow();
  });

  await refreshSampleList();
}

async function renameSample() {
  if (!currentSampleName || !inputRename || !btnRename) return;
  const newName = inputRename.value.trim();
  if (!newName) return;

  // Captured up front: selecting the renamed file below changes currentSampleName.
  const oldFilename = currentSampleName;
  const position = currentIndex;
  const resetButton = (label) => {
    btnRename.textContent = label;
    setTimeout(() => {
      btnRename.textContent = '✏️ Rename';
      btnRename.disabled = false;
    }, 1500);
  };

  btnRename.disabled = true;
  btnRename.textContent = 'Renaming...';

  try {
    const res = await fetch('/rename-sample', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldFilename, newName }),
    });

    if (isOutdatedServer(res)) {
      window.alert(RESTART_SERVER_MESSAGE);
      resetButton('✏️ Rename');
      return;
    }
    if (res.status === 409) {
      resetButton('Name taken!');
      return;
    }
    if (!res.ok) throw new Error(`Server returned ${res.status}`);

    const data = await res.json();
    btnRename.textContent = 'Renamed!';

    // Refresh Strudel
    try {
      await registerAudienceSamples();
    } catch (e) {
      console.warn('[editor] Strudel refresh warning:', e);
    }

    // A rename keeps the file's place in the list, so stay there rather than jumping to the first sample.
    await refreshSampleList(position);
    if (currentSampleName !== data.newFilename) await selectFile(data.newFilename);

    onCatalogUpdatedCallback?.(oldFilename.replace(/\.[^.]+$/, ''), data.newFilename.replace(/\.[^.]+$/, ''));
    resetButton('Renamed!');
  } catch (err) {
    console.error('[editor] Rename failed:', err);
    resetButton('Error!');
  }
}


// A plain 404 page (not our JSON error) means the endpoint itself is missing:
// the running server predates this page and needs a restart.
function isOutdatedServer(res) {
  return res.status === 404 && !(res.headers.get('content-type') || '').includes('application/json');
}

const RESTART_SERVER_MESSAGE =
  "The running server is older than this page and doesn't support this yet.\n\n" +
  'Restart it (Ctrl+C in its terminal, then npm run dev), then try again.';

async function deleteSample() {
  if (!currentSampleName || !btnDelete) return;
  const confirmed = window.confirm(
    `Delete "${currentSampleName}"?\n\nThis permanently removes the recording and can't be undone.`,
  );
  if (!confirmed) return;

  const deletedName = currentSampleName;
  const deletedIndex = currentIndex;
  btnDelete.disabled = true;

  try {
    const res = await fetch('/delete-sample', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: deletedName }),
    });
    if (isOutdatedServer(res)) {
      window.alert(RESTART_SERVER_MESSAGE);
      btnDelete.disabled = false;
      return;
    }
    if (!res.ok) throw new Error(`Server returned ${res.status}`);

    if (previewSource) togglePreview(); // stop a preview of the deleted file
    // Re-register so the "Full Bank" instruments drop the deleted file.
    try {
      await registerAudienceSamples();
    } catch (e) {
      console.warn('[editor] Strudel refresh warning:', e);
    }
    // Stay near where you were, so several bad takes can be deleted in a row.
    await refreshSampleList(deletedIndex);
    await onSampleDeletedCallback?.(deletedName.replace(/\.[^.]+$/, ''));
  } catch (err) {
    console.error('[editor] Delete failed:', err);
    btnDelete.textContent = 'Error!';
    setTimeout(() => {
      btnDelete.textContent = '🗑️ Delete';
      btnDelete.disabled = false;
    }, 1500);
  }
}

export async function refreshSampleList(selectIdx = 0) {
  try {
    const res = await fetch('/strudel.json');
    if (!res.ok) return;
    catalogData = await res.json();

    availableSamples = [];
    SAMPLE_LAYER_KEYS.forEach((layer) => {
      if (catalogData[layer]) {
        catalogData[layer].forEach((file) => availableSamples.push(file));
      }
    });

    if (!selectSample) return;
    selectSample.innerHTML = '';
    if (availableSamples.length === 0) {
      selectSample.innerHTML = '<option value="">No samples available</option>';
      selectSample.disabled = true;
      if (btnPrev) btnPrev.disabled = true;
      if (btnNext) btnNext.disabled = true;
      if (btnPreview) btnPreview.disabled = true;
      if (btnSave) btnSave.disabled = true;
      if (btnDelete) btnDelete.disabled = true;
      currentSampleName = null;
      if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);
      updatePitchUI(null);
      return;
    }

    selectSample.disabled = false;
    availableSamples.forEach((file) => {
      const opt = document.createElement('option');
      opt.value = file;
      opt.textContent = file;
      selectSample.appendChild(opt);
    });

    await selectIndex(Math.min(selectIdx, availableSamples.length - 1));
  } catch (err) {
    console.error('[editor] Error loading samples catalog:', err);
  }
}

async function selectIndex(idx) {
  if (availableSamples.length === 0) return;
  if (idx < 0) idx = availableSamples.length - 1;
  if (idx >= availableSamples.length) idx = 0;
  currentIndex = idx;
  if (selectSample) selectSample.value = availableSamples[idx];
  await selectFile(availableSamples[idx]);
}

// Each selection loads audio asynchronously; a slower earlier load must not
// overwrite a newer selection (e.g. quick arrow clicks), or the editor would show
// one sample while Rename/Save/Delete act on another.
let selectRequestId = 0;

export async function selectFile(filename) {
  const requestId = ++selectRequestId;
  currentSampleName = filename;
  currentIndex = availableSamples.indexOf(filename);
  // Keep the dropdown on the loaded file (e.g. after recording), so what's shown is what Delete acts on.
  if (selectSample) selectSample.value = filename;
  if (btnPrev) btnPrev.disabled = availableSamples.length <= 1;
  if (btnNext) btnNext.disabled = availableSamples.length <= 1;

  if (btnPreview) btnPreview.disabled = true;
  if (btnSave) btnSave.disabled = true;
  // Deletable and renamable even if the audio below fails to load: a broken file is a prime candidate.
  if (btnDelete) btnDelete.disabled = false;
  if (inputRename) inputRename.value = filename.replace(/\.[^.]+$/, '');

  // Fetch audio
  try {
    const res = await fetch(`/samples/${filename}`);
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    const arrayBuffer = await res.arrayBuffer();

    audioCtx = getAudioContext();
    const decoded = await audioCtx.decodeAudioData(arrayBuffer);
    if (requestId !== selectRequestId) return; // a newer selection took over
    originalBuffer = decoded;

    // Reset sliders
    const trimStartEl = document.getElementById('editor-trim-start');
    const trimEndEl = document.getElementById('editor-trim-end');
    if (trimStartEl) trimStartEl.value = 0;
    if (trimEndEl) trimEndEl.value = 1;

    const fineTuneEl = document.getElementById('editor-fine-tune');
    if (fineTuneEl) fineTuneEl.value = 0;
    if (displayFineTune) displayFineTune.innerText = '0¢';

    if (btnPreview) btnPreview.disabled = false;
    if (btnSave) btnSave.disabled = false;

    drawWaveform();
    analyzePitchNow();
  } catch (err) {
    if (requestId !== selectRequestId) return;
    console.error('[editor] Failed to load audio file', err);
    originalBuffer = null; // don't let Preview/Save act on the previous sample's audio
    if (ctx && canvas) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#ff6b6b';
      ctx.fillText('Failed to load sample', 10, 20);
    }
  }
}

// ─── Pitch Analysis & Readouts ────────────────────────
function debouncedPitchAnalysis() {
  if (pitchAnalysisTimeout) clearTimeout(pitchAnalysisTimeout);
  pitchAnalysisTimeout = setTimeout(() => {
    analyzePitchNow();
  }, 120);
}

function analyzePitchNow() {
  if (!originalBuffer) {
    updatePitchUI(null);
    return;
  }

  const params = getSliders();
  currentPitchAnalysis = detectPitch(originalBuffer, {
    trimStart: params.trimStart,
    trimEnd: params.trimEnd,
    targetOctave: params.targetOctave,
    fineTuneCents: params.fineTuneCents,
  });

  updatePitchUI(currentPitchAnalysis);
}

function updatePitchUI(analysis) {
  if (!elDetectedPitch) return;

  if (!analysis || !analysis.detected) {
    elDetectedPitch.innerText = analysis ? analysis.noteName : '—';
    if (elTargetPitch) elTargetPitch.innerText = '—';
    if (elShiftAmount) elShiftAmount.innerText = '0¢ (1.00x)';
    return;
  }

  const centsStr = analysis.cents >= 0 ? `+${analysis.cents}¢` : `${analysis.cents}¢`;
  const confPct = Math.round(analysis.confidence * 100);
  elDetectedPitch.innerText = `${analysis.noteName} (${centsStr}) · ${analysis.freq.toFixed(1)} Hz [${confPct}%]`;

  const tuneEnabled = inputTuneC ? inputTuneC.checked : true;
  if (tuneEnabled) {
    if (elTargetPitch) {
      elTargetPitch.innerText = `${analysis.targetNoteName} (${analysis.targetFreq.toFixed(1)} Hz)`;
    }
    if (elShiftAmount) {
      const shiftCentsStr = analysis.centsShift >= 0 ? `+${analysis.centsShift}¢` : `${analysis.centsShift}¢`;
      elShiftAmount.innerText = `${shiftCentsStr} (${analysis.pitchShiftRatio.toFixed(2)}x)`;
    }
  } else {
    if (elTargetPitch) elTargetPitch.innerText = 'Bypassed (Original)';
    if (elShiftAmount) elShiftAmount.innerText = '0¢ (1.00x)';
  }
}

// ─── Waveform Rendering ───────────────────────────────
function drawWaveform() {
  if (!originalBuffer || !ctx || !canvas) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const data = originalBuffer.getChannelData(0);
  const step = Math.ceil(data.length / canvas.width);
  const amp = canvas.height / 2;

  const params = getSliders();
  const trimStartPx = params.trimStart * canvas.width;
  const trimEndPx = params.trimEnd * canvas.width;

  // Draw background waveform (untrimmed)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
  for (let i = 0; i < canvas.width; i++) {
    let min = 1.0, max = -1.0;
    for (let j = 0; j < step; j++) {
      const datum = data[i * step + j];
      if (datum < min) min = datum;
      if (datum > max) max = datum;
    }
    ctx.fillRect(i, (1 + min) * amp, 1, Math.max(1, (max - min) * amp));
  }

  // Draw selected region
  ctx.fillStyle = 'rgba(108, 140, 255, 0.6)';
  for (let i = Math.floor(trimStartPx); i < Math.ceil(trimEndPx); i++) {
    let min = 1.0, max = -1.0;
    for (let j = 0; j < step; j++) {
      const datum = data[i * step + j];
      if (datum < min) min = datum;
      if (datum > max) max = datum;
    }
    ctx.fillRect(i, (1 + min) * amp, 1, Math.max(1, (max - min) * amp));
  }

  // Draw Trim overlays
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(0, 0, trimStartPx, canvas.height);
  ctx.fillRect(trimEndPx, 0, canvas.width - trimEndPx, canvas.height);

  // Draw lines
  ctx.strokeStyle = '#6c8cff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(trimStartPx, 0);
  ctx.lineTo(trimStartPx, canvas.height);
  ctx.moveTo(trimEndPx, 0);
  ctx.lineTo(trimEndPx, canvas.height);
  ctx.stroke();

  // Draw Fades & ADSR approximation on top of trim region
  const w = trimEndPx - trimStartPx;
  const startX = trimStartPx;

  ctx.strokeStyle = 'rgba(61, 214, 140, 0.8)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(startX, canvas.height);

  // A D S R points
  const pxA = startX + params.attack * w;
  const pxD = pxA + params.decay * w;
  const pxR = trimEndPx - params.release * w;
  const yS = canvas.height - (params.sustain * canvas.height);

  ctx.lineTo(pxA, 0);
  ctx.lineTo(pxD, yS);
  ctx.lineTo(pxR, yS);
  ctx.lineTo(trimEndPx, canvas.height);
  ctx.stroke();
}

// ─── Preview Audio ────────────────────────────────────
async function togglePreview() {
  if (previewSource) {
    previewSource.stop();
    previewSource = null;
    if (btnPreview) {
      btnPreview.textContent = '► Preview';
      btnPreview.classList.remove('playing');
    }
    if (playheadEl) playheadEl.style.display = 'none';
    return;
  }

  if (btnPreview) {
    btnPreview.textContent = '■ Stop';
    btnPreview.classList.add('playing');
  }

  const processedBuffer = await processAudioOffline(originalBuffer, getSliders());

  audioCtx = getAudioContext();
  previewSource = audioCtx.createBufferSource();
  previewSource.buffer = processedBuffer;
  previewSource.connect(audioCtx.destination);

  const startTime = audioCtx.currentTime;
  const duration = processedBuffer.duration;

  previewSource.onended = () => {
    previewSource = null;
    if (btnPreview) {
      btnPreview.textContent = '► Preview';
      btnPreview.classList.remove('playing');
    }
    if (playheadEl) playheadEl.style.display = 'none';
  };

  previewSource.start();

  // Playhead animation
  if (playheadEl && canvas) {
    playheadEl.style.display = 'block';
    const params = getSliders();
    const trimStartPx = params.trimStart * canvas.width;
    const trimEndPx = params.trimEnd * canvas.width;
    const w = trimEndPx - trimStartPx;

    function anim() {
      if (!previewSource) return;
      const elapsed = audioCtx.currentTime - startTime;
      const progress = Math.min(1, elapsed / duration);
      playheadEl.style.left = `${trimStartPx + progress * w}px`;
      if (progress < 1) requestAnimationFrame(anim);
    }
    requestAnimationFrame(anim);
  }
}

// ─── Process Audio Offline (ADSR + Trim + Fades + Normalize + Pitch to C) ───
export async function processAudioOffline(buffer, params) {
  const duration = buffer.duration;
  const startSec = params.trimStart * duration;
  const endSec = params.trimEnd * duration;
  let newDuration = endSec - startSec;
  if (newDuration <= 0) newDuration = 0.1;

  const oac = new OfflineAudioContext(
    buffer.numberOfChannels,
    Math.max(1, Math.ceil(newDuration * buffer.sampleRate)),
    buffer.sampleRate
  );

  const source = oac.createBufferSource();
  source.buffer = buffer;

  const gainNode = oac.createGain();
  const fadeNode = oac.createGain();

  source.connect(gainNode);
  gainNode.connect(fadeNode);
  fadeNode.connect(oac.destination);

  // ADSR
  const A = params.attack * newDuration;
  const D = params.decay * newDuration;
  const S = params.sustain;
  const R = params.release * newDuration;

  gainNode.gain.setValueAtTime(0, 0);
  if (A > 0) {
    gainNode.gain.linearRampToValueAtTime(1, A);
  } else {
    gainNode.gain.setValueAtTime(1, 0);
  }
  gainNode.gain.linearRampToValueAtTime(S, A + D);

  if (R > 0 && newDuration - R > A + D) {
    gainNode.gain.setValueAtTime(S, newDuration - R);
    gainNode.gain.linearRampToValueAtTime(0, newDuration);
  } else {
    gainNode.gain.setValueAtTime(S, newDuration);
  }

  // Fades
  const fadeIn = params.fadeIn * newDuration;
  const fadeOut = params.fadeOut * newDuration;

  fadeNode.gain.setValueAtTime(0, 0);
  if (fadeIn > 0) {
    fadeNode.gain.linearRampToValueAtTime(1, fadeIn);
  } else {
    fadeNode.gain.setValueAtTime(1, 0);
  }

  if (fadeOut > 0 && newDuration - fadeOut > fadeIn) {
    fadeNode.gain.setValueAtTime(1, newDuration - fadeOut);
    fadeNode.gain.linearRampToValueAtTime(0, newDuration);
  } else {
    fadeNode.gain.setValueAtTime(1, newDuration);
  }

  source.start(0, startSec, newDuration);

  let renderedBuffer = await oac.startRendering();

  // Crossfade (looping blend)
  if (params.crossfade > 0) {
    const xfSec = params.crossfade * newDuration;
    const xfSamples = Math.floor(xfSec * renderedBuffer.sampleRate);
    if (xfSamples > 0 && xfSamples < renderedBuffer.length) {
      const loopedBuffer = new OfflineAudioContext(
        renderedBuffer.numberOfChannels,
        renderedBuffer.length - xfSamples,
        renderedBuffer.sampleRate
      ).createBuffer(
        renderedBuffer.numberOfChannels,
        renderedBuffer.length - xfSamples,
        renderedBuffer.sampleRate
      );
      for (let c = 0; c < renderedBuffer.numberOfChannels; c++) {
        const inData = renderedBuffer.getChannelData(c);
        const outData = loopedBuffer.getChannelData(c);
        for (let i = 0; i < outData.length; i++) {
          outData[i] = inData[i];
        }
        const tailStart = renderedBuffer.length - xfSamples;
        for (let i = 0; i < xfSamples; i++) {
          const ratio = i / xfSamples;
          outData[i] = (outData[i] * ratio) + (inData[tailStart + i] * (1 - ratio));
        }
      }
      renderedBuffer = loopedBuffer;
    }
  }

  // Normalization
  if (params.normalize) {
    let maxAmp = 0;
    for (let c = 0; c < renderedBuffer.numberOfChannels; c++) {
      const data = renderedBuffer.getChannelData(c);
      for (let i = 0; i < data.length; i++) {
        if (Math.abs(data[i]) > maxAmp) maxAmp = Math.abs(data[i]);
      }
    }
    if (maxAmp > 0 && maxAmp !== 1) {
      const multiplier = 1.0 / maxAmp;
      for (let c = 0; c < renderedBuffer.numberOfChannels; c++) {
        const data = renderedBuffer.getChannelData(c);
        for (let i = 0; i < data.length; i++) {
          data[i] *= multiplier;
        }
      }
    }
  }

  // Pitch Shift / Tuning to C
  if (params.tuneToC) {
    const pitchResult = detectPitch(renderedBuffer, {
      trimStart: 0,
      trimEnd: 1,
      targetOctave: params.targetOctave,
      fineTuneCents: params.fineTuneCents,
    });

    if (pitchResult && pitchResult.detected && pitchResult.pitchShiftRatio) {
      const ratio = pitchResult.pitchShiftRatio;
      if (ratio > 0.05 && ratio < 20.0) {
        renderedBuffer = await pitchShiftBuffer(renderedBuffer, ratio);
      }
    }
  }

  return renderedBuffer;
}

// ─── Save Sample ──────────────────────────────────────
async function saveSample() {
  if (!btnSave) return;
  btnSave.disabled = true;
  btnSave.textContent = 'Saving...';

  try {
    const processedBuffer = await processAudioOffline(originalBuffer, getSliders());
    const wavBlob = audioBufferToWav(processedBuffer);

    const reader = new FileReader();
    reader.readAsDataURL(wavBlob);
    reader.onloadend = async () => {
      const base64data = reader.result;

      const res = await fetch('/replace-sample', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: currentSampleName,
          dataUri: base64data,
        }),
      });

      if (res.ok) {
        btnSave.textContent = 'Saved & Tuned!';
        // Update Strudel
        try {
          await registerAudienceSamples();
        } catch (e) {
          console.warn('[editor] Strudel refresh warning:', e);
        }

        if (onCatalogUpdatedCallback) {
          onCatalogUpdatedCallback();
        }

        setTimeout(() => {
          btnSave.textContent = '💾 Apply & Save';
          btnSave.disabled = false;
        }, 2000);
      } else {
        throw new Error(`Server returned ${res.status}`);
      }
    };
  } catch (err) {
    console.error('Save failed:', err);
    btnSave.textContent = 'Error!';
    setTimeout(() => {
      btnSave.textContent = '💾 Apply & Save';
      btnSave.disabled = false;
    }, 2000);
  }
}

// ─── WAV Encoder ──────────────────────────────────────
function audioBufferToWav(buffer) {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;

  let result;
  if (numChannels === 2) {
    const inputL = buffer.getChannelData(0);
    const inputR = buffer.getChannelData(1);
    const length = inputL.length + inputR.length;
    result = new Float32Array(length);
    let index = 0, inputIndex = 0;
    while (index < length) {
      result[index++] = inputL[inputIndex];
      result[index++] = inputR[inputIndex];
      inputIndex++;
    }
  } else {
    result = buffer.getChannelData(0);
  }

  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const wavBuffer = new ArrayBuffer(44 + result.length * bytesPerSample);
  const view = new DataView(wavBuffer);

  function writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + result.length * bytesPerSample, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(view, 36, 'data');
  view.setUint32(40, result.length * bytesPerSample, true);

  let offset = 44;
  for (let i = 0; i < result.length; i++, offset += 2) {
    let s = Math.max(-1, Math.min(1, result[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }

  return new Blob([view], { type: 'audio/wav' });
}
