import { placementIndexes, type WordSearchPuzzle } from './wordsearch.ts';

export function wordsearchCellClass(found: boolean, anchor: boolean, cursor: boolean): string {
  const classes = ['letter'];
  if (found) classes.push('found');
  if (anchor) classes.push('anchor');
  if (cursor) classes.push('cursor');
  return classes.join(' ');
}

export function wordsearchBoardHtml(
  puzzle: WordSearchPuzzle,
  found: readonly string[],
  anchor: number | null,
  selected: number,
): string {
  const foundSet = new Set(found);
  const covered = new Set<number>();
  for (const placement of puzzle.placements) {
    if (!foundSet.has(placement.word)) continue;
    for (const index of placementIndexes(puzzle.size, placement)) covered.add(index);
  }
  const cells = puzzle.grid.map((letter, index) => {
    const row = Math.floor(index / puzzle.size);
    const col = index % puzzle.size;
    const isFound = covered.has(index);
    const isAnchor = anchor === index;
    const isCursor = selected === index;
    let label = `Row ${row + 1}, column ${col + 1}, letter ${letter}`;
    if (isFound) label += ', found';
    if (isAnchor) label += ', selection start';
    return `<button type="button" role="gridcell" data-i="${index}" aria-rowindex="${row + 1}" aria-colindex="${col + 1}" aria-label="${label}" aria-selected="${isCursor}" aria-pressed="${isAnchor}" tabindex="${isCursor ? 0 : -1}" class="${wordsearchCellClass(isFound, isAnchor, isCursor)}" style="grid-column: ${col + 1}; grid-row: ${row + 1}">${letter}</button>`;
  });
  return `<div class="wordsearch-scroll"><div class="wordsearch" role="grid" aria-label="${puzzle.theme} word search, ${puzzle.size} by ${puzzle.size}" style="grid-template-columns: repeat(${puzzle.size}, var(--letter)); grid-template-rows: repeat(${puzzle.size}, var(--letter))">${cells.join('')}</div></div>`;
}
