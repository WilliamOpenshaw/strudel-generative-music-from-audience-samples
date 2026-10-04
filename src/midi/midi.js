/**
 * Web MIDI integration for M-VAVE SMC-PAD (or any standard MIDI controller)
 */

import { arePadsClaimed, watchPadClaim } from './hostClaim.js';

// If you don't know the CC numbers, watch the browser console while twisting a knob.
// Then update these numbers to match your hardware.
const CC_MAP = {
  // Encoders Bank 1 (CC 1-8)
  1: 'gain',         // Master Gain
  2: 'speed',        // Speed (Playback Rate)
  3: 'cpm',          // CPM (Tempo)
  5: 'drumsGain',
  6: 'chordsGain',
  7: 'bassGain',
  8: 'melodyGain',

  // Encoders Bank 2 (CC 9-16)
  9: 'drumsRoom',
  10: 'chordsRoom',
  11: 'bassRoom',
  12: 'melodyRoom',
  13: 'drumsLpf',
  14: 'chordsLpf',
  15: 'bassLpf',
  16: 'melodyLpf',
};

// Map MIDI Note numbers (from pads) to actions
const PAD_MAP = {
  // Pad Bank 1 (Notes 1-16)
  1: 'toggle:drumsOn',
  2: 'toggle:chordsOn',
  3: 'toggle:bassOn',
  4: 'toggle:melodyOn',
  5: 'rand:drum',
  6: 'rand:chord',
  7: 'rand:bass',
  8: 'rand:lead',
  9: 'regen:all',
  10: 'regen:drums',
  11: 'regen:chords',
  12: 'regen:bass',
  13: 'regen:melody',
  14: 'pitch:down',
  15: 'pitch:reset',
  16: 'pitch:up',

  // Pad Bank 2 (Notes 21-36, physically Pads 1-16)
  21: 'padSample:1',
  22: 'padSample:2',
  23: 'padSample:3',
  24: 'padSample:4',
  25: 'padSample:5',
  26: 'padSample:6',
  27: 'padSample:7',
  28: 'padSample:8',
  29: 'padSample:9',
  30: 'padSample:10',
  31: 'padSample:11',
  32: 'padSample:12',
  33: 'padSample:13',
  34: 'padSample:14',
  35: 'padSample:15',
  36: 'padBank:toggle', // Pad 16 toggles the active pad bank
};

// Additional button actions triggered via CC (value > 0)
const CC_BUTTON_MAP = {
  27: 'transport:start', // Play
  28: 'transport:stop',  // Pause
  29: 'record:toggle'    // Record
};

// Parameter ranges to scale CC (0-127) to application values
const RANGES = {
  gain: [0, 1],
  speed: [0.25, 2],
  cpm: [60, 180],
  drumsGain: [0, 1],
  chordsGain: [0, 1],
  bassGain: [0, 1],
  melodyGain: [0, 1],
  chordsLpf: [100, 5000],
  chordsRoom: [0, 1],
  bassLpf: [100, 2000],
  melodyDelay: [0, 1],
  drumsRoom: [0, 1],
  bassRoom: [0, 1],
  melodyRoom: [0, 1],
  drumsLpf: [100, 20000],
  melodyLpf: [100, 20000]
};

// Utility to map 0-127 to a target range
function scaleCC(value, min, max, isInteger = false) {
  const scaled = min + (value / 127) * (max - min);
  return isInteger ? Math.round(scaled) : scaled;
}

export async function initMIDI({ getState, onParameterChange, onAction, onStatusUpdate, onRawMessage }) {
  if (!navigator.requestMIDIAccess) {
    onStatusUpdate('MIDI: Not Supported');
    console.warn('[MIDI] Web MIDI API not supported in this browser.');
    return;
  }

  try {
    const midiAccess = await navigator.requestMIDIAccess();

    const refresh = () => {
      const names = [];
      for (const input of midiAccess.inputs.values()) {
        if (input.state !== 'connected') continue;
        if (!input.onmidimessage) {
          console.info(`[MIDI] Found device: ${input.name} (ID: ${input.id})`);
          input.onmidimessage = (msg) => handleMIDIMessage(msg, getState, onParameterChange, onAction, onRawMessage);
        }
        names.push(input.name);
      }

      const hostNote = arePadsClaimed() ? ' · pads → Host Messages' : '';
      if (names.length > 0) {
        onStatusUpdate(`MIDI: ${names.length} device(s) connected${hostNote}`, names.join('\n'));
      } else {
        onStatusUpdate(`MIDI: No devices found${hostNote}`, '');
      }
    };

    refresh();
    watchPadClaim(refresh);

    midiAccess.onstatechange = (e) => {
      if (e.port.type !== 'input') return;
      console.info(`[MIDI] Device state changed: ${e.port.name}, ${e.port.state}`);
      refresh();
    };

  } catch (err) {
    console.error('[MIDI] Failed to get MIDI access:', err);
    onStatusUpdate('MIDI: Access Denied');
  }
}

const lastCcValue = {};

function handleMIDIMessage(message, getState, onParameterChange, onAction, onRawMessage) {
  const [commandData, data1, data2] = message.data;
  
  // Strip MIDI channel (0-15) from command byte (upper 4 bits is the type)
  const command = commandData >> 4; 

  if (onRawMessage) {
    if (command === 9 && data2 > 0) {
      const action = PAD_MAP[data1] || 'Unmapped';
      onRawMessage(`Pad Note ${data1} (${action})`);
    } else if (command === 11) {
      const param = CC_MAP[data1] || 'Unmapped';
      onRawMessage(`Encoder CC ${data1}: ${data2} (${param})`);
    }
  }

  // Note On (command 9)
  if (command === 9 && data2 > 0) {
    // The Host Messages page owns the pads while it's started; knobs and buttons stay here.
    if (arePadsClaimed()) {
      onRawMessage?.(`Pad Note ${data1} → Host Messages`);
      return;
    }
    const noteNumber = data1;
    if (PAD_MAP[noteNumber]) {
      const actionStr = PAD_MAP[noteNumber];
      const [type, key] = actionStr.split(':');
      onAction(type, key);
    }
  }

  // Control Change (command 11)
  if (command === 11) {
    const ccNumber = data1;
    const value = data2; // 0-127

    // Check if it's a CC Button (e.g. Left, Right, Play, Pause, Record)
    if (CC_BUTTON_MAP[ccNumber] && value > 0) {
      const actionStr = CC_BUTTON_MAP[ccNumber];
      const [type, key] = actionStr.split(':');
      onAction(type, key);
      return;
    }
    
    if (CC_MAP[ccNumber]) {
      const paramKey = CC_MAP[ccNumber];
      const range = RANGES[paramKey];
      if (range) {
        // Initialize baseline to prevent jumping on the very first tweak
        if (lastCcValue[ccNumber] === undefined) {
          lastCcValue[ccNumber] = value;
          return; 
        }

        let delta = value - lastCcValue[ccNumber];
        lastCcValue[ccNumber] = value;
        
        // Endless encoder wrap-around detection (optional, handles if the hardware loops 0 <-> 127)
        if (delta > 63) delta -= 128;
        if (delta < -63) delta += 128;

        if (delta !== 0) {
          // For cpm/LPF we want integer steps, else float
          const isInt = paramKey === 'cpm' || paramKey.endsWith('Lpf');
          const stepSize = (range[1] - range[0]) / 127;
          
          let currentVal = getState ? getState(paramKey) : undefined;
          if (currentVal === undefined) currentVal = range[0];
          
          let newVal = currentVal + (delta * stepSize);
          
          // Clamp to boundaries
          newVal = Math.max(range[0], Math.min(range[1], newVal));
          
          if (isInt) newVal = Math.round(newVal);
          
          onParameterChange(paramKey, newVal);
        }
      }
    } else {
      console.log(`[MIDI] Unmapped CC: ${ccNumber} (Value: ${value})`);
    }
  }
}
