/**
 * Web MIDI integration for M-VAVE SMC-PAD (or any standard MIDI controller)
 */

// If you don't know the CC numbers, watch the browser console while twisting a knob.
// Then update these numbers to match your hardware.
const CC_MAP = {
  // Pad A Knobs (example)
  1: 'gain',         // CC 1 -> Master Gain
  2: 'speed',        // CC 2 -> Speed
  // Pad B Knobs (example)
  3: 'cpm',          // CC 3 -> CPM
  4: 'transpose',    // CC 4 -> Transpose
  
  // Other potential knobs:
  // 5: 'drumsGain', 6: 'chordsGain', 7: 'bassGain', 8: 'melodyGain'
  // 9: 'chordsLpf', 10: 'chordsRoom', 11: 'bassLpf', 12: 'melodyDelay'
};

// Map MIDI Note numbers (from pads) to actions
// Action string format: 'toggle:drumsOn' or 'regen:all'
const PAD_MAP = {
  // Example Notes (update these after checking console logs)
  36: 'toggle:drumsOn',  // Note 36 (C2)
  37: 'toggle:chordsOn', 
  38: 'toggle:bassOn',   
  39: 'toggle:melodyOn', 
  
  40: 'regen:all',
  41: 'regen:chords',
  42: 'regen:bass',
  43: 'regen:melody',
};

// Parameter ranges to scale CC (0-127) to application values
const RANGES = {
  gain: [0, 1],
  speed: [0.25, 2],
  cpm: [60, 180],
  transpose: [-12, 12],
  drumsGain: [0, 1],
  chordsGain: [0, 1],
  bassGain: [0, 1],
  melodyGain: [0, 1],
  chordsLpf: [100, 5000],
  chordsRoom: [0, 1],
  bassLpf: [100, 2000],
  melodyDelay: [0, 1]
};

// Utility to map 0-127 to a target range
function scaleCC(value, min, max, isInteger = false) {
  const scaled = min + (value / 127) * (max - min);
  return isInteger ? Math.round(scaled) : scaled;
}

export async function initMIDI({ onParameterChange, onAction, onStatusUpdate }) {
  if (!navigator.requestMIDIAccess) {
    onStatusUpdate('MIDI: Not Supported');
    console.warn('[MIDI] Web MIDI API not supported in this browser.');
    return;
  }

  try {
    const midiAccess = await navigator.requestMIDIAccess();
    const inputs = midiAccess.inputs.values();
    let connectedCount = 0;

    for (let input of inputs) {
      console.info(`[MIDI] Found device: ${input.name} (ID: ${input.id})`);
      input.onmidimessage = (msg) => handleMIDIMessage(msg, onParameterChange, onAction);
      connectedCount++;
    }

    if (connectedCount > 0) {
      onStatusUpdate(`MIDI: ${connectedCount} device(s) connected`);
    } else {
      onStatusUpdate('MIDI: No devices found');
    }

    midiAccess.onstatechange = (e) => {
      console.info(`[MIDI] Device state changed: ${e.port.name}, ${e.port.state}`);
      // Simple recount logic could go here
    };

  } catch (err) {
    console.error('[MIDI] Failed to get MIDI access:', err);
    onStatusUpdate('MIDI: Access Denied');
  }
}

function handleMIDIMessage(message, onParameterChange, onAction) {
  const [commandData, data1, data2] = message.data;
  
  // Strip MIDI channel (0-15) from command byte (upper 4 bits is the type)
  const command = commandData >> 4; 
  // const channel = commandData & 0xf; // Not currently needed, but good to know

  // Note On (command 9). Some devices send Note On with velocity 0 instead of Note Off
  if (command === 9 && data2 > 0) {
    const noteNumber = data1;
    // const velocity = data2;
    
    if (PAD_MAP[noteNumber]) {
      const actionStr = PAD_MAP[noteNumber];
      const [type, key] = actionStr.split(':');
      onAction(type, key);
    } else {
      console.log(`[MIDI] Unmapped Note On: ${noteNumber}`);
    }
  }

  // Control Change (command 11)
  if (command === 11) {
    const ccNumber = data1;
    const value = data2; // 0-127
    
    if (CC_MAP[ccNumber]) {
      const paramKey = CC_MAP[ccNumber];
      const range = RANGES[paramKey];
      if (range) {
        // e.g. cpm and transpose are integers
        const isInt = paramKey === 'cpm' || paramKey === 'transpose' || paramKey.endsWith('Lpf');
        const scaledVal = scaleCC(value, range[0], range[1], isInt);
        onParameterChange(paramKey, scaledVal);
      }
    } else {
      console.log(`[MIDI] Unmapped CC: ${ccNumber} (Value: ${value})`);
    }
  }
}
