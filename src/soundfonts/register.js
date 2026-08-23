/**
 * Local soundfont registration — ensures all strudel functions come from the
 * SAME @strudel/web module instance that evaluate() uses, avoiding the module
 * duplication bug where @strudel/soundfonts ships its own pre-built copies of
 * @strudel/core and @strudel/webaudio.
 *
 * The GM instrument data (gm.mjs) is pure data with no strudel dependencies,
 * so it's safe to import directly from the package.
 */

import {
  noteToMidi,
  getSoundIndex,
  getAudioContext,
  registerSound,
  getParamADSR,
  getADSRValues,
  getPitchEnvelope,
  getVibratoOscillator,
  onceEnded,
  releaseAudioNode,
} from '@strudel/web';

/**
 * Convert a frequency in Hz to a MIDI note number.
 * @param {number} freq
 * @returns {number}
 */
function freqToMidi(freq) {
  return Math.round(12 * Math.log2(freq / 440) + 69);
}

// GM instrument data — pure object, no strudel module dependencies
import gm from '@strudel/soundfonts/gm.mjs';

// ─── Soundfont loader (mirrors @strudel/soundfonts/fontloader.mjs) ──────────

const defaultSoundfontUrl = 'https://felixroos.github.io/webaudiofontdata/sound';
let soundfontUrl = defaultSoundfontUrl;

let loadCache = {};
async function loadFont(name) {
  if (loadCache[name]) {
    return loadCache[name];
  }
  const load = async () => {
    const url = `${soundfontUrl}/${name}.js`;
    const preset = await fetch(url).then((res) => res.text());
    let [_, data] = preset.split('={');
    return eval('{' + data);
  };
  loadCache[name] = load();
  return loadCache[name];
}

function findZone(preset, pitch) {
  return preset.find((zone) => {
    return zone.keyRangeLow <= pitch && zone.keyRangeHigh + 1 >= pitch;
  });
}

async function getBuffer(zone, audioContext) {
  if (zone.sample) {
    const decoded = atob(zone.sample);
    zone.buffer = audioContext.createBuffer(1, decoded.length / 2, zone.sampleRate);
    const float32Array = zone.buffer.getChannelData(0);
    let b1, b2, n;
    for (var i = 0; i < decoded.length / 2; i++) {
      b1 = decoded.charCodeAt(i * 2);
      b2 = decoded.charCodeAt(i * 2 + 1);
      if (b1 < 0) b1 = 256 + b1;
      if (b2 < 0) b2 = 256 + b2;
      n = b2 * 256 + b1;
      if (n >= 65536 / 2) n = n - 65536;
      float32Array[i] = n / 65536.0;
    }
  } else {
    if (zone.file) {
      const datalen = zone.file.length;
      const arraybuffer = new ArrayBuffer(datalen);
      const view = new Uint8Array(arraybuffer);
      const decoded = atob(zone.file);
      let b;
      for (let i = 0; i < decoded.length; i++) {
        b = decoded.charCodeAt(i);
        view[i] = b;
      }
      return new Promise((resolve) => audioContext.decodeAudioData(arraybuffer, resolve));
    }
  }
}

let bufferCache = {};
async function getFontPitch(name, pitch, ac) {
  const key = `${name}:::${pitch}`;
  if (bufferCache[key]) {
    return bufferCache[key];
  }
  const load = async () => {
    const preset = await loadFont(name);
    if (!preset) {
      throw new Error(`Could not load soundfont ${name}`);
    }
    const zone = findZone(preset, pitch);
    if (!zone) {
      throw new Error(`no soundfont zone found for preset ${name}, pitch ${pitch}`);
    }
    const buffer = await getBuffer(zone, ac);
    if (!buffer) {
      throw new Error(`no soundfont buffer found for preset ${name}, pitch: ${pitch}`);
    }
    return { buffer, zone };
  };
  bufferCache[key] = load();
  return bufferCache[key];
}

async function getFontBufferSource(name, value, ac) {
  let { note = 'c3', freq } = value;
  let midi;
  if (freq) {
    midi = freqToMidi(freq);
  } else if (typeof note === 'string') {
    midi = noteToMidi(note);
  } else if (typeof note === 'number') {
    midi = note;
  } else {
    throw new Error(`unexpected "note" type "${typeof note}"`);
  }

  const { buffer, zone } = await getFontPitch(name, midi, ac);
  const src = ac.createBufferSource();
  src.buffer = buffer;
  const baseDetune = zone.originalPitch - 100.0 * zone.coarseTune - zone.fineTune;
  const playbackRate = 1.0 * Math.pow(2, (100.0 * midi - baseDetune) / 1200.0);
  src.playbackRate.value = playbackRate;
  const loop = zone.loopStart > 1 && zone.loopStart < zone.loopEnd;
  if (loop) {
    src.loop = true;
    src.loopStart = zone.loopStart / zone.sampleRate;
    src.loopEnd = zone.loopEnd / zone.sampleRate;
  }
  return src;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Register all General MIDI soundfont instruments on the same sound map
 * that @strudel/web's evaluate() reads from.
 */
export function registerSoundfonts() {
  Object.entries(gm).forEach(([name, fonts]) => {
    registerSound(
      name,
      async (time, value, onended) => {
        const [attack, decay, sustain, release] = getADSRValues([
          value.attack,
          value.decay,
          value.sustain,
          value.release,
        ]);

        const { duration } = value;
        const holdEnd = time + (duration || 0.1);
        const n = getSoundIndex(value.n, fonts.length);
        const font = fonts[n];
        const ctx = getAudioContext();
        const bufferSource = await getFontBufferSource(font, value, ctx);
        bufferSource.start(time);
        const envGain = ctx.createGain();
        const node = bufferSource.connect(envGain);
        const peakGain = 0.3 * (typeof value.gain === 'number' ? value.gain : 1);
        getParamADSR(node.gain, attack, decay, sustain, release, 0, peakGain, time, holdEnd, 'linear');
        const envEnd = holdEnd + release + 0.01;

        // vibrato
        const vibratoHandle = getVibratoOscillator(bufferSource.detune, value, time);
        // pitch envelope
        getPitchEnvelope(bufferSource.detune, value, time, holdEnd);

        bufferSource.stop(envEnd);
        const stop = (_releaseTime) => {};
        onceEnded(bufferSource, () => {
          releaseAudioNode(bufferSource);
          vibratoHandle?.stop();
          onended();
        });
        return { node, stop, nodes: { source: [bufferSource], ...vibratoHandle?.nodes } };
      },
      { type: 'soundfont', prebake: true, fonts },
    );
  });
}
