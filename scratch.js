import { Key, Chord } from '@tonaljs/tonal';

const roots = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const root = roots[Math.floor(Math.random() * roots.length)];
const mode = Math.random() > 0.5 ? 'major' : 'minor';

console.log(`Key: ${root} ${mode}`);

// 2. Get diatonic chords
const keyData = mode === 'major' ? Key.majorKey(root) : Key.minorKey(root);
const diatonicChords = mode === 'major' ? keyData.chords : keyData.natural.chords;

console.log('Diatonic chords:', diatonicChords);

// Let's create a progression by picking indices: e.g. I-vi-IV-V (0, 5, 3, 4)
// Major progressions (indices):
const majorProgressions = [
  [0, 3, 4, 0], // I IV V I
  [1, 4, 0, 0], // ii V I I
  [0, 5, 3, 4], // I vi IV V
  [0, 4, 5, 3]  // I V vi IV
];

const minorProgressions = [
  [0, 3, 4, 0], // i iv v i
  [0, 5, 2, 6], // i VI III VII
  [0, 3, 6, 2], // i iv VII III
  [5, 6, 0, 0]  // VI VII i i
];

const progressions = mode === 'major' ? majorProgressions : minorProgressions;
const prog = progressions[Math.floor(Math.random() * progressions.length)];

const chords = prog.map(idx => diatonicChords[idx]);
console.log('Progression Chords:', chords);

chords.forEach(chordName => {
  const c = Chord.get(chordName);
  console.log(`Chord ${chordName}: notes=${c.notes}`);
});
