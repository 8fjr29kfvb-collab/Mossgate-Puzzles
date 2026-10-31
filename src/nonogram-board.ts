import { lineClues } from './nonogram.ts';

export type NonogramBoardInput = {
  size: number;
  rowClues: readonly (readonly number[])[];
  colClues: readonly (readonly number[])[];
  cells: readonly number[];
  selected: number;
  mistakeAt: (index: number) => boolean;
};

function sameClues(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function lineFilled(cells: readonly number[], size: number, row: number | null, col: number | null): boolean[] {
  const line: boolean[] = [];
  for (let i = 0; i < size; i++) {
    const index = row == null ? i * size + (col ?? 0) : row * size + i;
    line.push(cells[index] === 1);
  }
  return line;
}

/** Classes for one play cell. Rule marks are inset shadows, so they stay in this list across repaints. */
export function nonogramButtonClass(
  size: number,
  index: number,
  cell: number,
  selected: number,
  mistake: boolean,
): string {
  const classes = ['cell'];
  const row = Math.floor(index / size);
  const col = index % size;
  if (col === 0) classes.push('rule-left');
  if ((col + 1) % 5 === 0) classes.push('rule-right');
  if (row === 0) classes.push('rule-top');
  if ((row + 1) % 5 === 0) classes.push('rule-bottom');
  if (cell === 1) classes.push('filled');
  if (cell === 2) classes.push('cross');
  if (index === selected) classes.push('selected');
  else if (selected >= 0 && (Math.floor(selected / size) === row || selected % size === col)) classes.push('peer');
  if (mistake) classes.push('mistake');
  return classes.join(' ');
}

export function describeNonogramCell(size: number, index: number, cell: number, mistake: boolean): string {
  const row = Math.floor(index / size) + 1;
  const col = (index % size) + 1;
  let detail = cell === 1 ? 'filled' : cell === 2 ? 'marked empty' : 'blank';
  if (mistake) detail += ', incorrect';
  return `Row ${row}, column ${col}, ${detail}`;
}

function clueLabel(kind: 'Row' | 'Column', index: number, clues: readonly number[], done: boolean): string {
  return `${kind} ${index + 1} clue ${clues.join(' ')}${done ? ', satisfied' : ''}`;
}

/**
 * Fixed-track nonogram. Every column and row, including clue tracks, is one
 * `var(--cell)` grid track. Group lines are classes on the cells, not extra columns.
 */
export function nonogramBoardHtml(input: NonogramBoardInput): string {
  const { size, cells, selected, mistakeAt } = input;
  const rowClues = input.rowClues;
  const colClues = input.colClues;
  const clueCols = Math.max(1, ...rowClues.map((clues) => clues.length));
  const clueRows = Math.max(1, ...colClues.map((clues) => clues.length));
  const colTracks = clueCols + size;
  const rowTracks = clueRows + size;

  const columns = colClues
    .map((clues, c) => {
      const done = sameClues(lineClues(lineFilled(cells, size, null, c)), clues);
      const numbers = clues.map((clue) => `<span>${clue}</span>`).join('');
      return `<div class="clue col-clue${done ? ' done' : ''}" role="columnheader" data-clue="c-${c}" aria-label="${clueLabel('Column', c, clues, done)}" style="grid-column: ${clueCols + c + 1}; grid-row: 1 / span ${clueRows}">${numbers}</div>`;
    })
    .join('');

  const rows = rowClues
    .map((clues, r) => {
      const done = sameClues(lineClues(lineFilled(cells, size, r, null)), clues);
      const numbers = clues.map((clue) => `<span>${clue}</span>`).join('');
      return `<div class="clue row-clue${done ? ' done' : ''}" role="rowheader" data-clue="r-${r}" aria-label="${clueLabel('Row', r, clues, done)}" style="grid-column: 1 / span ${clueCols}; grid-row: ${clueRows + r + 1}">${numbers}</div>`;
    })
    .join('');

  const buttons = Array.from({ length: size * size }, (_, index) => {
    const row = Math.floor(index / size);
    const col = index % size;
    const cell = cells[index] ?? 0;
    const mistake = mistakeAt(index);
    const label = describeNonogramCell(size, index, cell, mistake);
    return `<button type="button" role="gridcell" data-i="${index}" aria-rowindex="${row + 1}" aria-colindex="${col + 1}" aria-label="${label}" aria-invalid="${mistake}" aria-selected="${index === selected}" tabindex="${index === selected ? 0 : -1}" class="${nonogramButtonClass(size, index, cell, selected, mistake)}" style="grid-column: ${clueCols + col + 1}; grid-row: ${clueRows + row + 1}">${cell === 2 ? '×' : ''}</button>`;
  }).join('');

  return `<div class="board-scroll"><div class="nonogram" role="grid" aria-label="Nonogram grid. Numbers above each column and beside each row are the clues." style="--tracks: ${colTracks}; grid-template-columns: repeat(${colTracks}, var(--cell)); grid-template-rows: repeat(${rowTracks}, var(--cell))">${columns}${rows}${buttons}</div></div>`;
}
