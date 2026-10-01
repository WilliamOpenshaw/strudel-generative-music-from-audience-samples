/** Shared 4×4 pad grid rendering for the dashboard's performer tab and pads.html. */

// Matches the physical controller: pad 1 is bottom-left, pad 16 top-right.
export const PAD_DISPLAY_ORDER = [
  12, 13, 14, 15, // Row 1 (Top): Pads 13-16
  8,  9,  10, 11, // Row 2: Pads 9-12
  4,  5,  6,  7,  // Row 3: Pads 5-8
  0,  1,  2,  3,  // Row 4 (Bottom): Pads 1-4
];

const KIND_CLASSES = {
  toggle: 'toggle-pad',
  cycle: 'cycle-pad',
  note: 'note-pad',
  assigned: 'assigned',
  empty: null,
};

/**
 * @param {HTMLElement} grid
 * @param {{ labels: Record<string,string>, kinds: Record<string,string>, onPadClick?: (pad:number)=>void }} opts
 *   labels/kinds are keyed `pad_1`…`pad_16`, as sent in SYNC_PADS.
 */
export function renderPadGrid(grid, { labels, kinds, onPadClick }) {
  grid.innerHTML = '';
  for (const i of PAD_DISPLAY_ORDER) {
    const padNum = i + 1;
    const item = document.createElement('div');
    item.className = 'performer-pad';
    const kindClass = KIND_CLASSES[kinds?.[`pad_${padNum}`]];
    if (kindClass) item.classList.add(kindClass);

    const num = document.createElement('div');
    num.className = 'pad-num';
    num.textContent = padNum;
    const name = document.createElement('div');
    name.className = 'pad-name';
    name.textContent = labels?.[`pad_${padNum}`] ?? '';
    item.append(num, name);

    if (onPadClick) item.addEventListener('click', () => onPadClick(padNum));
    grid.appendChild(item);
  }
}
