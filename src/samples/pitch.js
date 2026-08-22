/**
 * pitch.js — Fundamental frequency detection & tuning utilities for audio samples.
 *
 * Implements the YIN pitch detection algorithm with sub-sample parabolic
 * interpolation, energy gating, multi-frame median clustering, and Web Audio
 * OfflineAudioContext pitch-shifting to musical note C.
 */

const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

/**
 * Convert fundamental frequency (Hz) to exact MIDI note number (float).
 */
export function freqToMidi(freq) {
  if (!freq || freq <= 0) return null;
  return 69 + 12 * Math.log2(freq / 440);
}

/**
 * Convert MIDI note number to frequency (Hz).
 */
export function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * Convert exact MIDI note number to human-readable note name, octave, and cents offset.
 * E.g., 60.12 -> { noteName: 'C4', note: 'C', octave: 4, cents: 12, midi: 60 }
 */
export function midiToNoteInfo(midi) {
  if (midi === null || isNaN(midi)) {
    return { noteName: '—', note: '—', octave: 0, cents: 0, midi: 0 };
  }
  const roundedMidi = Math.round(midi);
  const cents = Math.round((midi - roundedMidi) * 100);
  const noteIndex = ((roundedMidi % 12) + 12) % 12;
  const octave = Math.floor(roundedMidi / 12) - 1;
  const note = NOTE_NAMES[noteIndex];
  const noteName = `${note}${octave}`;
  return {
    noteName,
    note,
    octave,
    cents,
    roundedMidi,
    exactMidi: midi,
  };
}

/**
 * Single-frame YIN pitch detection on a Float32Array slice.
 */
function yinFrame(buffer, sampleRate, { minFreq = 45, maxFreq = 2000, threshold = 0.15 } = {}) {
  const bufferSize = buffer.length;
  const tauMin = Math.max(2, Math.floor(sampleRate / maxFreq));
  const tauMax = Math.min(bufferSize - 1, Math.ceil(sampleRate / minFreq));

  // Step 1: Difference function
  const d = new Float32Array(tauMax + 1);
  for (let tau = 0; tau <= tauMax; tau++) {
    let sum = 0;
    const limit = bufferSize - tau;
    for (let i = 0; i < limit; i++) {
      const delta = buffer[i] - buffer[i + tau];
      sum += delta * delta;
    }
    d[tau] = sum;
  }

  // Step 2: Cumulative mean normalized difference function
  const dPrime = new Float32Array(tauMax + 1);
  dPrime[0] = 1;
  let runningSum = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    runningSum += d[tau];
    dPrime[tau] = runningSum > 0 ? (d[tau] * tau) / runningSum : 1;
  }

  // Step 3: Absolute thresholding
  let tauFound = -1;
  for (let tau = tauMin; tau <= tauMax; tau++) {
    if (dPrime[tau] < threshold) {
      // Find local minimum below threshold
      while (tau + 1 <= tauMax && dPrime[tau + 1] < dPrime[tau]) {
        tau++;
      }
      tauFound = tau;
      break;
    }
  }

  // If no tau was below threshold, find the global minimum within [tauMin, tauMax]
  if (tauFound === -1) {
    let minVal = 1.0;
    for (let tau = tauMin; tau <= tauMax; tau++) {
      if (dPrime[tau] < minVal) {
        minVal = dPrime[tau];
        tauFound = tau;
      }
    }
    // If even the global minimum is poor, consider unvoiced
    if (minVal > 0.45) {
      return null;
    }
  }

  // Step 4: Parabolic interpolation for sub-sample precision
  const tau = tauFound;
  let betterTau = tau;
  if (tau > 0 && tau < tauMax) {
    const s0 = dPrime[tau - 1];
    const s1 = dPrime[tau];
    const s2 = dPrime[tau + 1];
    const denom = 2 * (s0 - 2 * s1 + s2);
    if (denom !== 0) {
      const delta = (s0 - s2) / denom;
      betterTau = tau + delta;
    }
  }

  const freq = sampleRate / betterTau;
  if (freq < minFreq || freq > maxFreq) return null;

  const confidence = Math.max(0, Math.min(1, 1 - dPrime[tau]));
  return { freq, confidence, tau: betterTau };
}

/**
 * Analyze pitch of an AudioBuffer over the active cropped range.
 *
 * @param {AudioBuffer} audioBuffer
 * @param {Object} options - { trimStart: 0, trimEnd: 1, targetOctave: 'nearest', fineTuneCents: 0 }
 * @returns {Object} Analysis and tuning details
 */
export function detectPitch(audioBuffer, options = {}) {
  if (!audioBuffer || audioBuffer.length === 0) {
    return {
      detected: false,
      noteName: '—',
      freq: null,
      confidence: 0,
      targetMidi: 60,
      targetNoteName: 'C4',
      pitchShiftRatio: 1.0,
      centsShift: 0,
      semitonesShift: 0,
    };
  }

  const {
    trimStart = 0,
    trimEnd = 1,
    targetOctave = 'nearest', // 'nearest', 'C2', 'C3', 'C4', 'C5', 'C6'
    fineTuneCents = 0,
  } = options;

  const sampleRate = audioBuffer.sampleRate;
  const channelData = audioBuffer.getChannelData(0); // Mono or left channel

  const startIndex = Math.max(0, Math.floor(trimStart * channelData.length));
  const endIndex = Math.min(channelData.length, Math.ceil(trimEnd * channelData.length));
  const trimmedLength = endIndex - startIndex;

  if (trimmedLength < 512) {
    return {
      detected: false,
      noteName: '—',
      freq: null,
      confidence: 0,
      targetMidi: 60,
      targetNoteName: 'C4',
      pitchShiftRatio: 1.0,
      centsShift: 0,
      semitonesShift: 0,
    };
  }

  // Frame parameters
  const frameSize = 2048;
  const hopSize = 512;
  const frames = [];

  // Measure peak RMS in trimmed area
  let maxRms = 0;
  for (let offset = startIndex; offset + frameSize <= endIndex; offset += hopSize) {
    let sumSq = 0;
    for (let j = 0; j < frameSize; j++) {
      const v = channelData[offset + j];
      sumSq += v * v;
    }
    const rms = Math.sqrt(sumSq / frameSize);
    if (rms > maxRms) maxRms = rms;
  }

  const rmsThreshold = Math.max(0.005, maxRms * 0.12);

  // Analyze each frame
  for (let offset = startIndex; offset + frameSize <= endIndex; offset += hopSize) {
    const frame = new Float32Array(frameSize);
    let sumSq = 0;
    for (let j = 0; j < frameSize; j++) {
      const v = channelData[offset + j];
      frame[j] = v;
      sumSq += v * v;
    }
    const rms = Math.sqrt(sumSq / frameSize);
    if (rms < rmsThreshold) continue; // Skip quiet / unvoiced sections

    const result = yinFrame(frame, sampleRate, { minFreq: 45, maxFreq: 2200, threshold: 0.18 });
    if (result && result.confidence >= 0.5) {
      frames.push({
        freq: result.freq,
        confidence: result.confidence,
        rms,
        midi: freqToMidi(result.freq),
      });
    }
  }

  if (frames.length === 0) {
    return {
      detected: false,
      noteName: 'Unpitched / Percussive',
      freq: null,
      confidence: 0,
      targetMidi: 60,
      targetNoteName: 'C4',
      pitchShiftRatio: 1.0,
      centsShift: 0,
      semitonesShift: 0,
    };
  }

  // Sort by MIDI to find median pitch
  frames.sort((a, b) => a.midi - b.midi);
  const medianIndex = Math.floor(frames.length / 2);
  const medianMidi = frames[medianIndex].midi;

  // Filter inliers within +/- 1.2 semitones of median (rejects octave jumps)
  const inliers = frames.filter((f) => Math.abs(f.midi - medianMidi) <= 1.2);
  const activeFrames = inliers.length > 0 ? inliers : frames;

  // Weighted average pitch & confidence
  let totalWeight = 0;
  let weightedMidiSum = 0;
  let confSum = 0;
  for (const f of activeFrames) {
    const weight = f.confidence * f.rms;
    weightedMidiSum += f.midi * weight;
    confSum += f.confidence;
    totalWeight += weight;
  }

  const finalMidi = totalWeight > 0 ? weightedMidiSum / totalWeight : medianMidi;
  const finalFreq = midiToFreq(finalMidi);
  const finalConf = confSum / activeFrames.length;

  const noteInfo = midiToNoteInfo(finalMidi);

  // ─── Calculate Target C & Pitch Shift ──────────────────
  let targetMidi;
  if (targetOctave === 'nearest' || !targetOctave) {
    // Nearest C is the multiple of 12 closest to finalMidi
    targetMidi = Math.round(finalMidi / 12) * 12;
  } else {
    // Explicit octave e.g. 'C2', 'C3', 'C4', 'C5'
    const octMatch = targetOctave.match(/C(\d)/i);
    const oct = octMatch ? parseInt(octMatch[1], 10) : 4;
    targetMidi = (oct + 1) * 12; // C4 = (4+1)*12 = 60
  }

  // Apply user fine-tune adjustment in cents (-100 to +100)
  const adjustedTargetMidi = targetMidi + (fineTuneCents / 100);
  const semitonesShift = adjustedTargetMidi - finalMidi;
  const centsShift = Math.round(semitonesShift * 100);
  const pitchShiftRatio = Math.pow(2, semitonesShift / 12);

  const targetNoteInfo = midiToNoteInfo(targetMidi);

  return {
    detected: true,
    freq: finalFreq,
    midi: finalMidi,
    note: noteInfo.note,
    octave: noteInfo.octave,
    noteName: noteInfo.noteName,
    cents: noteInfo.cents,
    confidence: finalConf,
    targetMidi,
    targetNoteName: targetNoteInfo.noteName,
    targetFreq: midiToFreq(targetMidi),
    pitchShiftRatio,
    semitonesShift,
    centsShift,
  };
}

/**
 * High-quality pitch shift of an AudioBuffer via Web Audio OfflineAudioContext resampling.
 *
 * @param {AudioBuffer} audioBuffer
 * @param {number} ratio - Playback rate / pitch shift ratio (>1 shifts up, <1 shifts down)
 * @returns {Promise<AudioBuffer>} Shifted audio buffer
 */
export async function pitchShiftBuffer(audioBuffer, ratio) {
  if (!ratio || Math.abs(ratio - 1.0) < 0.0005) {
    return audioBuffer;
  }

  const outDuration = audioBuffer.duration / ratio;
  const sampleRate = audioBuffer.sampleRate;
  const numChannels = audioBuffer.numberOfChannels;
  const outLength = Math.max(1, Math.ceil(outDuration * sampleRate));

  const oac = new OfflineAudioContext(numChannels, outLength, sampleRate);
  const source = oac.createBufferSource();
  source.buffer = audioBuffer;
  source.playbackRate.value = ratio;
  source.connect(oac.destination);
  source.start(0);

  return await oac.startRendering();
}
