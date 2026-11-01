import '@fontsource/atkinson-hyperlegible/latin-400.css';
import '@fontsource/atkinson-hyperlegible/latin-700.css';
import './style.css';
import { installVisitCounter } from './counter.ts';
import { addDays, archiveDates, clampPuzzleDate, formatDuration, formatLongDate, LAUNCH_DATE, tokyoDateString } from './date.ts';
import { describeNonogramCell, nonogramBoardHtml, nonogramButtonClass } from './nonogram-board.ts';
import { lineClues, nonogramForDate, type NonogramPuzzle } from './nonogram.ts';
import { nonogramShareText, sudokuShareText, wordsearchShareText } from './share.ts';
import { recordIfToday, streakLabel, visibleStreak, type StreakRecord } from './streak.ts';
import {
  emptyNonogramProgress,
  emptySudokuProgress,
  emptyWordSearchProgress,
  isDaySolved,
  loadSave,
  trimDays,
  writeSave,
  type DayProgress,
  type NonogramProgress,
  type SudokuProgress,
  type WordSearchProgress,
} from './storage.ts';
import { wordsearchBoardHtml } from './wordsearch-board.ts';
import { selectionIndexes, wordsearchForDate, type WordSearchPuzzle } from './wordsearch.ts';
import { clueCount, sudokuBand, sudokuForDate, type SudokuPuzzle } from './sudoku.ts';

type Mode = 'sudoku' | 'nonogram' | 'wordsearch';
type Tool = 'fill' | 'cross' | 'erase';
type CellValue = 0 | 1 | 2;

type SudokuUndo = { index: number; value: number; notes: number };
type NonogramChange = { index: number; prev: number };

type Runtime = { runningSince: number | null };

const SUDOKU_HELP = `
  <p>Fill each row, column, and 3×3 box with the digits 1 to 9, once each.</p>
  <ul>
    <li>Tap a cell, then tap a number. Arrow keys move.</li>
    <li><kbd>1</kbd> to <kbd>9</kbd> enter a digit. <kbd>N</kbd> toggles notes. <kbd>Delete</kbd> clears the cell.</li>
    <li><kbd>U</kbd> undoes. Check mistakes marks an entry that does not match the solution.</li>
  </ul>
`;

const WORDSEARCH_HELP = `
  <p>Find every word in the list. Words read across, down, or diagonally down to the right. They are never written backwards.</p>
  <ul>
    <li>Tap the first letter, then the last letter. On a phone, scroll the grid if it does not fit.</li>
    <li>Arrow keys move. <kbd>Enter</kbd> sets the first letter, then the last. <kbd>Escape</kbd> clears the start.</li>
    <li>Sunday in Tokyo is a larger grid with more words. The grid for a date is the same on every screen.</li>
  </ul>
`;

const NONOGRAM_HELP = `
  <p>Fill cells so each row and column matches its numbers. A number is a run of filled cells. Runs in the same line have at least one empty cell between them. 0 means the line is empty.</p>
  <ul>
    <li>Tap or drag to fill. Cross marks a cell you want to leave empty. Right-click also marks a cross.</li>
    <li><kbd>1</kbd> fills, <kbd>2</kbd> marks a cross, <kbd>0</kbd> clears. <kbd>F</kbd>, <kbd>X</kbd>, and <kbd>E</kbd> choose the tool.</li>
    <li>A clue is struck through when the filled cells in that line match it.</li>
  </ul>
`;

const state = {
  today: '',
  puzzleDate: '',
  days: {} as Record<string, DayProgress>,
  mode: 'sudoku' as Mode,
  largePrint: false,
  checkMistakes: false,
  sudokuStreak: { count: 0, lastDate: null } as StreakRecord,
  nonogramStreak: { count: 0, lastDate: null } as StreakRecord,
  wordsearchStreak: { count: 0, lastDate: null } as StreakRecord,
  sudokuPuzzle: null as SudokuPuzzle | null,
  nonogramPuzzle: null as NonogramPuzzle | null,
  wordsearchPuzzle: null as WordSearchPuzzle | null,
  sudoku: emptySudokuProgress(),
  nonogram: emptyNonogramProgress(),
  wordsearch: emptyWordSearchProgress(),
  sudokuSelected: 0,
  nonogramSelected: 0,
  wordsearchSelected: 0,
  wordsearchAnchor: null as number | null,
  notesMode: false,
  tool: 'fill' as Tool,
  sudokuUndo: [] as SudokuUndo[],
  nonogramUndo: [] as NonogramChange[][],
  wordsearchUndo: [] as string[],
  sudokuError: false,
  nonogramError: false,
  wordsearchError: false,
};

const runtime: Record<Mode, Runtime> = {
  sudoku: { runningSince: null },
  nonogram: { runningSince: null },
  wordsearch: { runningSince: null },
};

let drag: { id: number; value: CellValue; changes: NonogramChange[]; seen: Set<number> } | null = null;

function must<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
}

function progressOf(mode: Mode): SudokuProgress | NonogramProgress | WordSearchProgress {
  if (mode === 'sudoku') return state.sudoku;
  if (mode === 'nonogram') return state.nonogram;
  return state.wordsearch;
}

function hasWork(mode: Mode): boolean {
  if (mode === 'sudoku') {
    return (
      state.sudoku.solved ||
      state.sudoku.elapsed > 0 ||
      state.sudoku.values.some(Boolean) ||
      state.sudoku.notes.some(Boolean)
    );
  }
  if (mode === 'nonogram') {
    return state.nonogram.solved || state.nonogram.elapsed > 0 || state.nonogram.cells.some(Boolean);
  }
  return state.wordsearch.solved || state.wordsearch.elapsed > 0 || state.wordsearch.found.length > 0;
}

function shouldRun(mode: Mode): boolean {
  const progress = progressOf(mode);
  return (
    mode === state.mode &&
    !document.hidden &&
    hasWork(mode) &&
    !progress.userPaused &&
    !progress.solved
  );
}

function syncClock(mode: Mode): void {
  const rt = runtime[mode];
  const progress = progressOf(mode);
  if (shouldRun(mode)) {
    if (rt.runningSince == null) rt.runningSince = Date.now();
    return;
  }
  if (rt.runningSince != null) {
    progress.elapsed += Date.now() - rt.runningSince;
    rt.runningSince = null;
  }
}

function shownElapsed(mode: Mode): number {
  const extra = runtime[mode].runningSince ? Date.now() - runtime[mode].runningSince! : 0;
  return progressOf(mode).elapsed + extra;
}

function freezeClocks(): void {
  for (const mode of ['sudoku', 'nonogram', 'wordsearch'] as const) {
    const rt = runtime[mode];
    if (rt.runningSince != null) {
      progressOf(mode).elapsed += Date.now() - rt.runningSince;
      rt.runningSince = null;
    }
  }
}

function sameClues(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function sudokuComplete(): boolean {
  const puzzle = state.sudokuPuzzle;
  if (!puzzle) return false;
  for (let i = 0; i < 81; i++) {
    const value = puzzle.givens[i] || state.sudoku.values[i];
    if (value !== puzzle.solution[i]) return false;
  }
  return true;
}

function nonogramComplete(): boolean {
  const puzzle = state.nonogramPuzzle;
  if (!puzzle) return false;
  const size = puzzle.size;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const filled = state.nonogram.cells[r * size + c] === 1;
      if (filled !== puzzle.solution[r]?.[c]) return false;
    }
  }
  return true;
}

function isSudokuMistake(index: number): boolean {
  const puzzle = state.sudokuPuzzle;
  if (!state.checkMistakes || !puzzle) return false;
  if (puzzle.givens[index]) return false;
  const value = state.sudoku.values[index] ?? 0;
  return value !== 0 && value !== puzzle.solution[index];
}

function isNonogramMistake(index: number): boolean {
  const puzzle = state.nonogramPuzzle;
  if (!state.checkMistakes || !puzzle) return false;
  const size = puzzle.size;
  const should = puzzle.solution[Math.floor(index / size)]?.[index % size] ?? false;
  const cell = state.nonogram.cells[index] ?? 0;
  return (cell === 1 && !should) || (cell === 2 && should);
}

function selectedIndex(): number {
  if (state.mode === 'sudoku') return state.sudokuSelected;
  if (state.mode === 'nonogram') return state.nonogramSelected;
  return state.wordsearchSelected;
}

function shareText(): string {
  if (state.mode === 'sudoku' && state.sudokuPuzzle) {
    return sudokuShareText(state.puzzleDate, shownElapsed('sudoku'), state.sudokuPuzzle.givens);
  }
  if (state.mode === 'nonogram' && state.nonogramPuzzle) {
    return nonogramShareText(state.puzzleDate, shownElapsed('nonogram'), state.nonogramPuzzle.solution);
  }
  if (state.wordsearchPuzzle) {
    return wordsearchShareText(state.puzzleDate, shownElapsed('wordsearch'), state.wordsearchPuzzle.words);
  }
  return '';
}

function dayHasProgress(day: DayProgress): boolean {
  const sudoku = day.sudoku;
  const nonogram = day.nonogram;
  const sudokuWork = Boolean(
    sudoku && (sudoku.solved || sudoku.elapsed > 0 || sudoku.values.some(Boolean) || sudoku.notes.some(Boolean)),
  );
  const nonogramWork = Boolean(nonogram && (nonogram.solved || nonogram.elapsed > 0 || nonogram.cells.some(Boolean)));
  const wordsearch = day.wordsearch;
  const wordsearchWork = Boolean(wordsearch && (wordsearch.solved || wordsearch.elapsed > 0 || wordsearch.found.length > 0));
  return sudokuWork || nonogramWork || wordsearchWork;
}

function persist(): void {
  const day: DayProgress = { sudoku: state.sudoku, nonogram: state.nonogram, wordsearch: state.wordsearch };
  if (state.puzzleDate && dayHasProgress(day)) state.days[state.puzzleDate] = day;
  else if (state.puzzleDate) delete state.days[state.puzzleDate];
  state.days = trimDays(state.days, 60, state.puzzleDate);
  writeSave(localStorage, {
    version: 2,
    largePrint: state.largePrint,
    checkMistakes: state.checkMistakes,
    sudokuStreak: state.sudokuStreak,
    nonogramStreak: state.nonogramStreak,
    wordsearchStreak: state.wordsearchStreak,
    days: state.days,
  });
}

function announce(message: string): void {
  must('live').textContent = message;
}

function renderClock(): void {
  must('time').textContent = formatDuration(shownElapsed(state.mode));
  const progress = progressOf(state.mode);
  let note = '';
  if (progress.solved) note = 'solved';
  else if (progress.userPaused && hasWork(state.mode)) note = 'paused';
  must('clock-note').textContent = note;
  const pause = must<HTMLButtonElement>('pause');
  const running = runtime[state.mode].runningSince != null;
  pause.disabled = progress.solved || !hasWork(state.mode);
  pause.textContent = progress.userPaused && !progress.solved ? 'Resume' : 'Pause';
  pause.setAttribute('aria-pressed', String(progress.userPaused && !progress.solved));
  pause.setAttribute('aria-label', running ? 'Pause timer' : 'Resume timer');
}

function renderChrome(): void {
  const sudokuTab = must<HTMLButtonElement>('tab-sudoku');
  const nonogramTab = must<HTMLButtonElement>('tab-nonogram');
  const wordsearchTab = must<HTMLButtonElement>('tab-wordsearch');
  const sudokuOn = state.mode === 'sudoku';
  const nonogramOn = state.mode === 'nonogram';
  const wordsearchOn = state.mode === 'wordsearch';
  sudokuTab.setAttribute('aria-selected', String(sudokuOn));
  nonogramTab.setAttribute('aria-selected', String(nonogramOn));
  wordsearchTab.setAttribute('aria-selected', String(wordsearchOn));
  sudokuTab.tabIndex = sudokuOn ? 0 : -1;
  nonogramTab.tabIndex = nonogramOn ? 0 : -1;
  wordsearchTab.tabIndex = wordsearchOn ? 0 : -1;
  must('sudoku-done').hidden = !state.sudoku.solved;
  must('nonogram-done').hidden = !state.nonogram.solved;
  must('wordsearch-done').hidden = !state.wordsearch.solved;
  const labelledBy = sudokuOn ? 'tab-sudoku' : nonogramOn ? 'tab-nonogram' : 'tab-wordsearch';
  must('panel').setAttribute('aria-labelledby', labelledBy);
  const puzzleName = sudokuOn ? 'Sudoku' : nonogramOn ? 'Nonogram' : 'Word search';
  document.title = `${puzzleName} · Mossgate Puzzles`;
  const heading = document.getElementById('puzzle-heading');
  if (heading) heading.textContent = puzzleName;

  const streakRecord = sudokuOn ? state.sudokuStreak : nonogramOn ? state.nonogramStreak : state.wordsearchStreak;
  const streak = streakLabel(visibleStreak(streakRecord, state.today));
  const archive = state.puzzleDate && state.puzzleDate !== state.today ? 'Archive · ' : '';
  if (sudokuOn && state.sudokuPuzzle) {
    const clues = clueCount(state.sudokuPuzzle.givens);
    must('meta').textContent = `${archive}${sudokuBand(clues)} · ${streak}`;
  } else if (nonogramOn) {
    must('meta').textContent = `${archive}Daily · ${streak}`;
  } else if (state.wordsearchPuzzle) {
    const weekend = state.wordsearchPuzzle.weekend ? 'Sunday challenge · ' : '';
    const found = state.wordsearch.found.length;
    must('meta').textContent = `${archive}${weekend}${state.wordsearchPuzzle.theme} · ${found}/${state.wordsearchPuzzle.words.length} · ${streak}`;
  } else {
    must('meta').textContent = `${archive}${streak}`;
  }
  renderArchive();

  const mistakes = must<HTMLButtonElement>('mistakes');
  mistakes.setAttribute('aria-pressed', String(state.checkMistakes));
  const large = must<HTMLButtonElement>('large-print');
  large.setAttribute('aria-pressed', String(state.largePrint));
  document.body.classList.toggle('large-print', state.largePrint);
  const share = must<HTMLButtonElement>('share-open');
  share.hidden = !progressOf(state.mode).solved;
  renderClock();
  syncPadState();
}

function padLocked(): boolean {
  if (progressOf(state.mode).solved) return true;
  return state.mode === 'sudoku' && !state.sudokuPuzzle;
}

function canUndo(): boolean {
  if (progressOf(state.mode).solved) return false;
  if (state.mode === 'sudoku') return state.sudokuUndo.length > 0;
  if (state.mode === 'nonogram') return state.nonogramUndo.length > 0;
  return state.wordsearchUndo.length > 0;
}

function selectedDigit(): number {
  if (state.mode !== 'sudoku' || !state.sudokuPuzzle) return 0;
  const index = state.sudokuSelected;
  return state.sudokuPuzzle.givens[index] || state.sudoku.values[index] || 0;
}

function syncPadState(): void {
  const notes = document.getElementById('notes');
  notes?.setAttribute('aria-pressed', String(state.notesMode));
  for (const tool of ['fill', 'cross', 'erase'] as const) {
    document.getElementById(`tool-${tool}`)?.setAttribute('aria-pressed', String(state.tool === tool));
  }
  const digit = selectedDigit();
  document.querySelectorAll<HTMLButtonElement>('#pad [data-digit]').forEach((button) => {
    button.classList.toggle('current', Number(button.dataset.digit) === digit && digit !== 0);
    button.disabled = padLocked();
  });
  for (const id of ['notes', 'erase', 'tool-fill', 'tool-cross', 'tool-erase']) {
    const button = document.getElementById(id);
    if (button instanceof HTMLButtonElement) button.disabled = padLocked();
  }
  const undo = document.getElementById('undo');
  if (undo instanceof HTMLButtonElement) undo.disabled = !canUndo();
  const label = document.getElementById('pad-label');
  if (label) {
    if (state.mode === 'sudoku') label.textContent = state.notesMode ? 'Notes' : 'Digits';
    else if (state.mode === 'nonogram') label.textContent = state.tool === 'fill' ? 'Fill' : state.tool === 'cross' ? 'Cross' : 'Erase';
    else label.textContent = 'Words';
  }
  must('pad').hidden = state.mode === 'sudoku' && !state.sudokuPuzzle && !state.sudokuError;
}

function renderPad(): void {
  const pad = must('pad');
  if (state.mode === 'sudoku') {
    const numbers = [1, 2, 3, 4, 5, 6, 7, 8, 9]
      .map((digit) => `<button type="button" data-digit="${digit}">${digit}</button>`)
      .join('');
    pad.innerHTML = `
      <p class="pad-label" id="pad-label">Digits</p>
      <div class="pad-nums" aria-label="Digits">${numbers}</div>
      <div class="pad-tools">
        <button type="button" id="notes" aria-pressed="${state.notesMode}">Notes</button>
        <button type="button" id="erase">Erase</button>
        <button type="button" id="undo">Undo</button>
      </div>
    `;
  } else if (state.mode === 'nonogram') {
    pad.innerHTML = `
      <p class="pad-label" id="pad-label">Fill</p>
      <div class="pad-tools">
        <button type="button" id="tool-fill" data-tool="fill" aria-pressed="true">Fill</button>
        <button type="button" id="tool-cross" data-tool="cross" aria-pressed="false">Cross</button>
        <button type="button" id="tool-erase" data-tool="erase" aria-pressed="false">Erase</button>
        <button type="button" id="undo">Undo</button>
      </div>
    `;
  } else {
    const words = (state.wordsearchPuzzle?.words ?? []).slice().sort();
    const items = words
      .map((word) => `<li class="${state.wordsearch.found.includes(word) ? 'found' : ''}">${word}</li>`)
      .join('');
    pad.innerHTML = `
      <p class="pad-label" id="pad-label">Words</p>
      <ul class="word-list" aria-label="Words to find">${items}</ul>
      <div class="pad-tools">
        <button type="button" id="undo">Undo</button>
      </div>
    `;
  }
  syncPadState();
}

function renderHelp(): void {
  const help = state.mode === 'sudoku' ? SUDOKU_HELP : state.mode === 'nonogram' ? NONOGRAM_HELP : WORDSEARCH_HELP;
  must('help-body').innerHTML = help;
}

function describeSudoku(index: number): string {
  const row = Math.floor(index / 9) + 1;
  const col = (index % 9) + 1;
  const given = state.sudokuPuzzle?.givens[index] ?? 0;
  const value = state.sudoku.values[index] ?? 0;
  const notes = state.sudoku.notes[index] ?? 0;
  let detail = 'empty';
  if (given) detail = `given ${given}`;
  else if (value) detail = isSudokuMistake(index) ? `${value}, incorrect` : String(value);
  else if (notes) {
    const marks: string[] = [];
    for (let digit = 1; digit <= 9; digit++) if (notes & (1 << digit)) marks.push(String(digit));
    detail = `notes ${marks.join(', ')}`;
  }
  return `Row ${row}, column ${col}, ${detail}`;
}

function sudokuInner(index: number): string {
  const given = state.sudokuPuzzle?.givens[index] ?? 0;
  const value = given || state.sudoku.values[index] || 0;
  if (value) return String(value);
  const notes = state.sudoku.notes[index] ?? 0;
  if (!notes) return '';
  let html = '<span class="notes" aria-hidden="true">';
  for (let digit = 1; digit <= 9; digit++) {
    html += notes & (1 << digit) ? `<span>${digit}</span>` : '<span></span>';
  }
  return `${html}</span>`;
}

function sudokuClass(index: number): string {
  const classes = ['cell'];
  if (state.sudokuPuzzle?.givens[index]) classes.push('given');
  if (index === state.sudokuSelected) classes.push('selected');
  else if (sameHouse(index, state.sudokuSelected)) classes.push('peer');
  const shown = state.sudokuPuzzle?.givens[index] || state.sudoku.values[index] || 0;
  const selectedShown =
    state.sudokuPuzzle?.givens[state.sudokuSelected] || state.sudoku.values[state.sudokuSelected] || 0;
  if (shown && shown === selectedShown) classes.push('match');
  if (isSudokuMistake(index)) classes.push('mistake');
  return classes.join(' ');
}

function sameHouse(a: number, b: number): boolean {
  if (a === b) return false;
  if (Math.floor(a / 9) === Math.floor(b / 9)) return true;
  if (a % 9 === b % 9) return true;
  return Math.floor(a / 27) === Math.floor(b / 27) && Math.floor((a % 9) / 3) === Math.floor((b % 9) / 3);
}

function renderSudokuBoard(): void {
  const wrap = must('board-wrap');
  if (state.sudokuError) {
    wrap.innerHTML = `<p class="error" role="alert">Today’s sudoku could not be built. <button type="button" id="reload">Reload</button></p>`;
    return;
  }
  if (!state.sudokuPuzzle) {
    wrap.innerHTML = `<p class="loading" role="status">Preparing today’s sudoku…</p>`;
    return;
  }
  const rows: string[] = [];
  for (let r = 0; r < 9; r++) {
    const cells: string[] = [];
    for (let c = 0; c < 9; c++) {
      const index = r * 9 + c;
      cells.push(
        `<button type="button" role="gridcell" data-i="${index}" aria-rowindex="${r + 1}" aria-colindex="${c + 1}" aria-selected="${index === state.sudokuSelected}" aria-invalid="${isSudokuMistake(index)}" aria-label="${describeSudoku(index)}" tabindex="${index === state.sudokuSelected ? 0 : -1}" class="${sudokuClass(index)}">${sudokuInner(index)}</button>`,
      );
    }
    rows.push(`<div role="row">${cells.join('')}</div>`);
  }
  wrap.innerHTML = `<div class="sudoku" role="grid" aria-label="Today’s sudoku">${rows.join('')}</div>`;
}

function refreshSudokuButtons(): void {
  must('board-wrap')
    .querySelectorAll<HTMLButtonElement>('button[data-i]')
    .forEach((button) => {
      const index = Number(button.dataset.i);
      button.className = sudokuClass(index);
      button.setAttribute('aria-selected', String(index === state.sudokuSelected));
      button.setAttribute('aria-invalid', String(isSudokuMistake(index)));
      button.tabIndex = index === state.sudokuSelected ? 0 : -1;
      button.setAttribute('aria-label', describeSudoku(index));
      button.innerHTML = sudokuInner(index);
    });
  syncPadState();
}

function describeNonogram(index: number): string {
  const size = state.nonogramPuzzle?.size ?? 10;
  const cell = state.nonogram.cells[index] ?? 0;
  return describeNonogramCell(size, index, cell, isNonogramMistake(index));
}

function nonogramClass(index: number): string {
  const size = state.nonogramPuzzle?.size ?? 10;
  return nonogramButtonClass(size, index, state.nonogram.cells[index] ?? 0, state.nonogramSelected, isNonogramMistake(index));
}

function lineFilled(row: number | null, col: number | null): boolean[] {
  const size = state.nonogramPuzzle?.size ?? 10;
  const cells: boolean[] = [];
  for (let i = 0; i < size; i++) {
    const index = row == null ? i * size + (col ?? 0) : row * size + i;
    cells.push(state.nonogram.cells[index] === 1);
  }
  return cells;
}

function refreshClues(): void {
  const puzzle = state.nonogramPuzzle;
  if (!puzzle) return;
  for (let r = 0; r < puzzle.size; r++) {
    const done = sameClues(lineClues(lineFilled(r, null)), puzzle.rowClues[r] ?? []);
    const el = must('board-wrap').querySelector(`[data-clue="r-${r}"]`);
    el?.classList.toggle('done', done);
    el?.setAttribute(
      'aria-label',
      `Row ${r + 1} clue ${(puzzle.rowClues[r] ?? []).join(' ')}${done ? ', satisfied' : ''}`,
    );
  }
  for (let c = 0; c < puzzle.size; c++) {
    const done = sameClues(lineClues(lineFilled(null, c)), puzzle.colClues[c] ?? []);
    const el = must('board-wrap').querySelector(`[data-clue="c-${c}"]`);
    el?.classList.toggle('done', done);
    el?.setAttribute(
      'aria-label',
      `Column ${c + 1} clue ${(puzzle.colClues[c] ?? []).join(' ')}${done ? ', satisfied' : ''}`,
    );
  }
}

function renderNonogramBoard(): void {
  const wrap = must('board-wrap');
  const puzzle = state.nonogramPuzzle;
  if (state.nonogramError || !puzzle) {
    wrap.innerHTML = `<p class="error" role="alert">Today’s nonogram could not be built. <button type="button" id="reload">Reload</button></p>`;
    return;
  }
  wrap.innerHTML = nonogramBoardHtml({
    size: puzzle.size,
    rowClues: puzzle.rowClues,
    colClues: puzzle.colClues,
    cells: state.nonogram.cells,
    selected: state.nonogramSelected,
    mistakeAt: isNonogramMistake,
  });
}

function renderWordsearchBoard(): void {
  const wrap = must('board-wrap');
  const puzzle = state.wordsearchPuzzle;
  if (state.wordsearchError || !puzzle) {
    wrap.innerHTML = `<p class="error" role="alert">This word search could not be built. <button type="button" id="reload">Reload</button></p>`;
    return;
  }
  wrap.innerHTML = wordsearchBoardHtml(puzzle, state.wordsearch.found, state.wordsearchAnchor, state.wordsearchSelected);
}

function refreshWordsearchSurface(): void {
  const puzzle = state.wordsearchPuzzle;
  if (!puzzle) return;
  const html = wordsearchBoardHtml(puzzle, state.wordsearch.found, state.wordsearchAnchor, state.wordsearchSelected);
  const wrap = must('board-wrap');
  const scroller = wrap.querySelector('.wordsearch-scroll');
  const scrollLeft = scroller?.scrollLeft ?? 0;
  const scrollTop = scroller?.scrollTop ?? 0;
  wrap.innerHTML = html;
  const next = wrap.querySelector('.wordsearch-scroll');
  if (next) {
    next.scrollLeft = scrollLeft;
    next.scrollTop = scrollTop;
  }
  renderPad();
}

function renderBoard(): void {
  if (state.mode === 'sudoku') renderSudokuBoard();
  else if (state.mode === 'nonogram') renderNonogramBoard();
  else renderWordsearchBoard();
}

function focusSelected(preventScroll: boolean): void {
  const button = must('board-wrap').querySelector<HTMLButtonElement>(`button[data-i="${selectedIndex()}"]`);
  button?.focus({ preventScroll });
}

function finish(mode: Mode): void {
  const progress = progressOf(mode);
  if (progress.solved) return;
  progress.solved = true;
  progress.userPaused = false;
  syncClock(mode);
  if (mode === 'sudoku') state.sudokuStreak = recordIfToday(state.sudokuStreak, state.puzzleDate, state.today);
  else if (mode === 'nonogram') state.nonogramStreak = recordIfToday(state.nonogramStreak, state.puzzleDate, state.today);
  else state.wordsearchStreak = recordIfToday(state.wordsearchStreak, state.puzzleDate, state.today);
  persist();
  renderChrome();
  if (mode === 'sudoku') refreshSudokuButtons();
  else if (mode === 'nonogram') renderNonogramBoard();
  else refreshWordsearchSurface();
  const name = mode === 'sudoku' ? 'sudoku' : mode === 'nonogram' ? 'nonogram' : 'word search';
  const time = formatDuration(shownElapsed(mode));
  const streakRecord = mode === 'sudoku' ? state.sudokuStreak : mode === 'nonogram' ? state.nonogramStreak : state.wordsearchStreak;
  const streak = visibleStreak(streakRecord, state.today);
  must('solved-title').textContent = 'Solved';
  must('solved-detail').textContent = solvedSentence(name, time, streak);
  must<HTMLTextAreaElement>('share-text').value = shareText();
  const dialog = must<HTMLDialogElement>('solved-dialog');
  if (!dialog.open) dialog.showModal();
  must('solved-title').focus();
  announce(`${name[0]!.toUpperCase()}${name.slice(1)} solved in ${time}. ${streakLabel(streak)}.`);
}

function solvedSentence(name: string, time: string, streak: number): string {
  const when =
    state.puzzleDate === state.today ? `today’s ${name}` : `the ${formatLongDate(state.puzzleDate)} ${name}`;
  if (state.puzzleDate !== state.today) {
    return `You finished ${when} in ${time}. Past days do not count toward your streak.`;
  }
  return `You finished ${when} in ${time}. ${streakLabel(streak)}.`;
}

function openShare(): void {
  const name = state.mode === 'sudoku' ? 'sudoku' : state.mode === 'nonogram' ? 'nonogram' : 'word search';
  const streakRecord = state.mode === 'sudoku' ? state.sudokuStreak : state.mode === 'nonogram' ? state.nonogramStreak : state.wordsearchStreak;
  const streak = visibleStreak(streakRecord, state.today);
  must('solved-detail').textContent = solvedSentence(name, formatDuration(shownElapsed(state.mode)), streak);
  must<HTMLTextAreaElement>('share-text').value = shareText();
  const dialog = must<HTMLDialogElement>('solved-dialog');
  if (!dialog.open) dialog.showModal();
  must('copy-share').focus();
}

function placeSudoku(digit: number | null): void {
  const puzzle = state.sudokuPuzzle;
  if (!puzzle || state.sudoku.solved) return;
  const index = state.sudokuSelected;
  if (puzzle.givens[index]) return;
  const prevValue = state.sudoku.values[index] ?? 0;
  const prevNotes = state.sudoku.notes[index] ?? 0;
  let nextValue = prevValue;
  let nextNotes = prevNotes;
  if (state.notesMode && digit) {
    nextValue = 0;
    nextNotes = prevNotes ^ (1 << digit);
  } else if (digit) {
    nextValue = digit;
    nextNotes = 0;
  } else {
    nextValue = 0;
    nextNotes = 0;
  }
  if (nextValue === prevValue && nextNotes === prevNotes) return;
  state.sudokuUndo.push({ index, value: prevValue, notes: prevNotes });
  if (state.sudokuUndo.length > 80) state.sudokuUndo.shift();
  state.sudoku.values[index] = nextValue;
  state.sudoku.notes[index] = nextNotes;
  syncClock('sudoku');
  refreshSudokuButtons();
  renderClock();
  if (sudokuComplete()) finish('sudoku');
  else persist();
}

function undo(): void {
  if (state.mode === 'wordsearch') {
    if (state.wordsearch.solved) return;
    const word = state.wordsearchUndo.pop();
    if (!word) return;
    state.wordsearch.found = state.wordsearch.found.filter((item) => item !== word);
    refreshWordsearchSurface();
    syncPadState();
    persist();
    return;
  }
  if (state.mode === 'sudoku') {
    if (state.sudoku.solved) return;
    const item = state.sudokuUndo.pop();
    if (!item) return;
    state.sudoku.values[item.index] = item.value;
    state.sudoku.notes[item.index] = item.notes;
    state.sudokuSelected = item.index;
    refreshSudokuButtons();
    focusSelected(false);
  } else {
    if (state.nonogram.solved) return;
    const stroke = state.nonogramUndo.pop();
    if (!stroke) return;
    for (let i = stroke.length - 1; i >= 0; i--) {
      const change = stroke[i];
      if (!change) continue;
      state.nonogram.cells[change.index] = change.prev;
    }
    const last = stroke[stroke.length - 1];
    if (last) state.nonogramSelected = last.index;
    renderNonogramBoard();
    focusSelected(false);
  }
  syncPadState();
  persist();
}

function paintNonogram(index: number, value: CellValue): void {
  if (!drag || state.nonogram.solved) return;
  const prev = (state.nonogram.cells[index] ?? 0) as CellValue;
  state.nonogramSelected = index;
  if (prev !== value) {
    if (!drag.seen.has(index)) {
      drag.changes.push({ index, prev });
      drag.seen.add(index);
    }
    state.nonogram.cells[index] = value;
  }
  refreshNonogramSurface();
  if (nonogramComplete()) commitStroke();
}

function refreshNonogramSurface(): void {
  must('board-wrap')
    .querySelectorAll<HTMLButtonElement>('button[data-i]')
    .forEach((button) => {
      const index = Number(button.dataset.i);
      button.className = nonogramClass(index);
      button.innerHTML = state.nonogram.cells[index] === 2 ? '×' : '';
      button.setAttribute('aria-label', describeNonogram(index));
      button.setAttribute('aria-invalid', String(isNonogramMistake(index)));
      button.setAttribute('aria-selected', String(index === state.nonogramSelected));
      button.tabIndex = index === state.nonogramSelected ? 0 : -1;
    });
  refreshClues();
}

function commitStroke(): void {
  if (!drag) return;
  const changes = drag.changes;
  drag = null;
  if (changes.length) {
    state.nonogramUndo.push(changes);
    if (state.nonogramUndo.length > 80) state.nonogramUndo.shift();
  }
  syncClock('nonogram');
  renderClock();
  if (nonogramComplete()) finish('nonogram');
  else {
    syncPadState();
    persist();
  }
}

function applyCross(index: number): void {
  if (state.nonogram.solved) return;
  const prev = (state.nonogram.cells[index] ?? 0) as CellValue;
  const value: CellValue = prev === 2 ? 0 : 2;
  if (prev === value) return;
  state.nonogram.cells[index] = value;
  state.nonogramSelected = index;
  state.nonogramUndo.push([{ index, prev }]);
  refreshNonogramSurface();
  syncClock('nonogram');
  renderClock();
  if (nonogramComplete()) finish('nonogram');
  else persist();
}

function strokeValue(index: number): CellValue {
  const current = (state.nonogram.cells[index] ?? 0) as CellValue;
  if (state.tool === 'erase') return 0;
  if (state.tool === 'fill') return current === 1 ? 0 : 1;
  return current === 2 ? 0 : 2;
}

function buttonFromTarget(target: EventTarget | null): HTMLButtonElement | null {
  if (!(target instanceof Element)) return null;
  const button = target.closest('button[data-i]');
  return button instanceof HTMLButtonElement ? button : null;
}

function onWordsearchPick(index: number): void {
  const puzzle = state.wordsearchPuzzle;
  if (!puzzle) return;
  state.wordsearchSelected = index;
  if (state.wordsearch.solved) {
    refreshWordsearchSurface();
    return;
  }
  if (state.wordsearchAnchor == null || state.wordsearchAnchor === index) {
    state.wordsearchAnchor = state.wordsearchAnchor === index ? null : index;
    refreshWordsearchSurface();
    return;
  }
  const indexes = selectionIndexes(puzzle.size, state.wordsearchAnchor, index);
  if (!indexes) {
    announce('Choose the last letter across, down, or on a diagonal.');
    refreshWordsearchSurface();
    return;
  }
  const text = indexes.map((cell) => puzzle.grid[cell] ?? '').join('');
  state.wordsearchAnchor = null;
  if (!puzzle.words.includes(text)) {
    announce(`${text} is not in the list.`);
    refreshWordsearchSurface();
    return;
  }
  if (state.wordsearch.found.includes(text)) {
    announce(`${text} is already found.`);
    refreshWordsearchSurface();
    return;
  }
  state.wordsearchUndo.push(text);
  state.wordsearch.found = [...state.wordsearch.found, text];
  syncClock('wordsearch');
  refreshWordsearchSurface();
  renderClock();
  if (state.wordsearch.found.length === puzzle.words.length) finish('wordsearch');
  else {
    persist();
    focusSelected(true);
  }
}

function onPointerDown(event: PointerEvent): void {
  const button = buttonFromTarget(event.target);
  if (!button) return;
  const index = Number(button.dataset.i);
  if (state.mode === 'wordsearch') {
    event.preventDefault();
    onWordsearchPick(index);
    return;
  }
  if (state.mode === 'sudoku') {
    if (!state.sudokuPuzzle) return;
    state.sudokuSelected = index;
    refreshSudokuButtons();
    return;
  }
  if (state.nonogram.solved) {
    state.nonogramSelected = index;
    refreshNonogramSurface();
    return;
  }
  if (event.button === 2) {
    event.preventDefault();
    applyCross(index);
    return;
  }
  if (event.button !== 0) return;
  event.preventDefault();
  button.focus({ preventScroll: true });
  if (drag) commitStroke();
  try {
    must('board-wrap').setPointerCapture(event.pointerId);
  } catch {
    // The pointer can vanish before capture on some browsers.
  }
  drag = { id: event.pointerId, value: strokeValue(index), changes: [], seen: new Set() };
  paintNonogram(index, drag.value);
}

function onPointerMove(event: PointerEvent): void {
  if (!drag || event.pointerId !== drag.id || state.mode !== 'nonogram') return;
  const button = buttonFromTarget(document.elementFromPoint(event.clientX, event.clientY));
  if (!button) return;
  paintNonogram(Number(button.dataset.i), drag.value);
}

function moveSelection(rowDelta: number, colDelta: number): void {
  const size = state.mode === 'sudoku' ? 9 : state.mode === 'nonogram' ? (state.nonogramPuzzle?.size ?? 10) : (state.wordsearchPuzzle?.size ?? 20);
  const current = selectedIndex();
  const row = Math.floor(current / size);
  const col = current % size;
  const nextRow = Math.min(size - 1, Math.max(0, row + rowDelta));
  const nextCol = Math.min(size - 1, Math.max(0, col + colDelta));
  const next = nextRow * size + nextCol;
  if (state.mode === 'sudoku') {
    state.sudokuSelected = next;
    refreshSudokuButtons();
  } else if (state.mode === 'nonogram') {
    state.nonogramSelected = next;
    refreshNonogramSurface();
  } else {
    state.wordsearchSelected = next;
    refreshWordsearchSurface();
  }
  focusSelected(false);
}

function onKey(event: KeyboardEvent): void {
  const dialog = must<HTMLDialogElement>('solved-dialog');
  if (dialog.open) return;
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (target.closest('textarea, input, summary')) return;
  if (event.metaKey || event.ctrlKey) {
    if (event.key.toLowerCase() === 'z') {
      event.preventDefault();
      undo();
    }
    return;
  }
  if (event.altKey) return;
  if (target.closest('[role="tablist"]') && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
    event.preventDefault();
    const order: Mode[] = ['sudoku', 'nonogram', 'wordsearch'];
    const step = event.key === 'ArrowRight' ? 1 : -1;
    const next = order[(order.indexOf(state.mode) + step + order.length) % order.length] ?? 'sudoku';
    selectMode(next);
    must(`tab-${next}`).focus();
    return;
  }
  const inGrid = Boolean(target.closest('#board-wrap'));
  if ((event.key === ' ' || event.key === 'Enter') && !inGrid) return;

  if (event.key === 'ArrowUp') return moveAndStop(event, -1, 0);
  if (event.key === 'ArrowDown') return moveAndStop(event, 1, 0);
  if (event.key === 'ArrowLeft') return moveAndStop(event, 0, -1);
  if (event.key === 'ArrowRight') return moveAndStop(event, 0, 1);

  if (event.key.toLowerCase() === 'u') {
    event.preventDefault();
    undo();
    return;
  }

  if (state.mode === 'wordsearch') {
    if (event.key === 'Escape') {
      event.preventDefault();
      state.wordsearchAnchor = null;
      refreshWordsearchSurface();
      return;
    }
    if ((event.key === 'Enter' || event.key === ' ') && inGrid) {
      event.preventDefault();
      onWordsearchPick(state.wordsearchSelected);
    }
    return;
  }

  if (state.mode === 'sudoku') {
    if (event.repeat && /^[0-9]$/.test(event.key)) return;
    if (event.key.toLowerCase() === 'n') {
      event.preventDefault();
      state.notesMode = !state.notesMode;
      syncPadState();
      return;
    }
    if (event.key === 'Backspace' || event.key === 'Delete' || event.key === '0') {
      event.preventDefault();
      placeSudoku(null);
      return;
    }
    if (/^[1-9]$/.test(event.key)) {
      event.preventDefault();
      placeSudoku(Number(event.key));
    }
    return;
  }

  if (event.key === ' ' && inGrid) {
    event.preventDefault();
    const index = state.nonogramSelected;
    drag = { id: -1, value: strokeValue(index), changes: [], seen: new Set() };
    paintNonogram(index, drag.value);
    commitStroke();
    return;
  }
  if (event.key === '1' || event.key === '2' || event.key === '0' || event.key === 'Backspace' || event.key === 'Delete') {
    event.preventDefault();
    const value: CellValue = event.key === '1' ? 1 : event.key === '2' ? 2 : 0;
    state.tool = value === 1 ? 'fill' : value === 2 ? 'cross' : 'erase';
    drag = { id: -1, value, changes: [], seen: new Set() };
    paintNonogram(state.nonogramSelected, value);
    commitStroke();
    return;
  }
  const key = event.key.toLowerCase();
  if (key === 'f' || key === 'x' || key === 'e') {
    event.preventDefault();
    state.tool = key === 'f' ? 'fill' : key === 'x' ? 'cross' : 'erase';
    syncPadState();
  }
}

function moveAndStop(event: KeyboardEvent, rowDelta: number, colDelta: number): void {
  event.preventDefault();
  moveSelection(rowDelta, colDelta);
}

function selectMode(mode: Mode): void {
  if (mode === state.mode) return;
  const url = new URL(location.href);
  url.hash = mode === 'nonogram' ? 'nonogram' : mode === 'wordsearch' ? 'wordsearch' : 'sudoku';
  history.pushState(null, '', `${url.pathname}${url.search}${url.hash}`);
  applyMode(mode);
}

function applyMode(mode: Mode): void {
  if (mode === state.mode) return;
  syncClock(state.mode);
  state.mode = mode;
  syncClock(mode);
  renderHelp();
  renderPad();
  renderBoard();
  renderChrome();
  persist();
}

function readMode(): Mode {
  if (location.hash === '#nonogram') return 'nonogram';
  if (location.hash === '#wordsearch') return 'wordsearch';
  return 'sudoku';
}

function firstEditable(): number {
  const givens = state.sudokuPuzzle?.givens ?? [];
  for (let i = 0; i < 81; i++) if (!givens[i]) return i;
  return 0;
}

function reconcile(mode: Mode): void {
  if (mode === 'sudoku' && state.sudokuPuzzle) {
    const complete = sudokuComplete();
    if (complete && !state.sudoku.solved) {
      state.sudoku.solved = true;
      state.sudokuStreak = recordIfToday(state.sudokuStreak, state.puzzleDate, state.today);
    } else if (!complete) state.sudoku.solved = false;
  }
  if (mode === 'nonogram' && state.nonogramPuzzle) {
    const complete = nonogramComplete();
    if (complete && !state.nonogram.solved) {
      state.nonogram.solved = true;
      state.nonogramStreak = recordIfToday(state.nonogramStreak, state.puzzleDate, state.today);
    } else if (!complete) state.nonogram.solved = false;
  }
  if (mode === 'wordsearch' && state.wordsearchPuzzle) {
    const complete = state.wordsearch.found.length === state.wordsearchPuzzle.words.length;
    if (complete && !state.wordsearch.solved) {
      state.wordsearch.solved = true;
      state.wordsearchStreak = recordIfToday(state.wordsearchStreak, state.puzzleDate, state.today);
    } else if (!complete) state.wordsearch.solved = false;
  }
}

function checkRollover(): void {
  must('rollover').hidden = tokyoDateString() === state.today;
}

function renderArchive(): void {
  const prev = document.getElementById('prev-day');
  const next = document.getElementById('next-day');
  if (prev instanceof HTMLButtonElement) prev.disabled = state.puzzleDate <= LAUNCH_DATE;
  if (next instanceof HTMLButtonElement) next.disabled = !state.puzzleDate || state.puzzleDate >= state.today;
  const list = document.getElementById('archive-list');
  if (!list || !state.today) return;
  const items = archiveDates(state.today).map((iso) => {
    const solved = isDaySolved(state.days[iso]);
    const current = iso === state.puzzleDate;
    const label = `${formatLongDate(iso)}${solved ? ', solved' : ''}`;
    return `<li><button type="button" data-date="${iso}" aria-label="${label}"${current ? ' aria-current="date"' : ''}>${formatLongDate(iso)}${solved ? ' <span aria-hidden="true">✓</span>' : ''}</button></li>`;
  });
  list.innerHTML = items.join('');
}

function loadDayProgress(date: string): void {
  const day = state.days[date];
  state.sudoku = day?.sudoku ?? emptySudokuProgress();
  state.nonogram = day?.nonogram ?? emptyNonogramProgress();
  state.wordsearch = day?.wordsearch ?? emptyWordSearchProgress();
  state.sudokuUndo = [];
  state.nonogramUndo = [];
  state.wordsearchUndo = [];
  state.wordsearchAnchor = null;
  drag = null;
  runtime.sudoku.runningSince = null;
  runtime.nonogram.runningSince = null;
  runtime.wordsearch.runningSince = null;
  state.sudokuSelected = 0;
  state.nonogramSelected = 0;
  state.wordsearchSelected = 0;
}

let sudokuTicket = 0;

function scheduleSudoku(date: string): void {
  const ticket = ++sudokuTicket;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (ticket !== sudokuTicket || state.puzzleDate !== date) return;
      try {
        state.sudokuPuzzle = sudokuForDate(date);
        state.sudokuSelected = firstEditable();
        reconcile('sudoku');
        syncClock('sudoku');
      } catch {
        state.sudokuError = true;
      }
      if (state.mode === 'sudoku') renderBoard();
      renderChrome();
      persist();
    });
  });
}

function switchToDate(date: string): void {
  if (date === state.puzzleDate) return;
  freezeClocks();
  persist();
  state.puzzleDate = date;
  state.sudokuError = false;
  state.nonogramError = false;
  state.wordsearchError = false;
  state.sudokuPuzzle = null;
  loadDayProgress(date);
  try {
    state.nonogramPuzzle = nonogramForDate(date);
  } catch {
    state.nonogramError = true;
    state.nonogramPuzzle = null;
  }
  try {
    state.wordsearchPuzzle = wordsearchForDate(date);
    state.wordsearch.found = state.wordsearch.found.filter((word) => state.wordsearchPuzzle?.words.includes(word));
  } catch {
    state.wordsearchError = true;
    state.wordsearchPuzzle = null;
  }
  reconcile('nonogram');
  reconcile('wordsearch');
  const line = must<HTMLTimeElement>('date-line');
  line.dateTime = date;
  line.textContent = formatLongDate(date);
  renderHelp();
  renderPad();
  renderBoard();
  renderChrome();
  scheduleSudoku(date);
}

function navigateDate(date: string): void {
  const clamped = clampPuzzleDate(date, state.today);
  if (clamped === state.puzzleDate) return;
  const url = new URL(location.href);
  if (clamped === state.today) url.searchParams.delete('date');
  else url.searchParams.set('date', clamped);
  history.pushState(null, '', `${url.pathname}${url.search}${url.hash}`);
  switchToDate(clamped);
}

function syncFromUrl(): void {
  const date = clampPuzzleDate(new URLSearchParams(location.search).get('date'), state.today);
  if (date !== state.puzzleDate) switchToDate(date);
  const mode = readMode();
  if (mode !== state.mode) applyMode(mode);
}

function boot(): void {
  const app = must('app');
  app.innerHTML = `
    <div class="wrap">
      <header class="site-head">
        <a class="brand" href="${import.meta.env.BASE_URL}">
          <img src="${import.meta.env.BASE_URL}assets/gate-mark.svg" width="42" height="42" alt="">
          <span>Mossgate<small>PUZZLES</small></span>
        </a>
        <a class="home-link" href="${import.meta.env.BASE_URL}">The gate</a>
      </header>
      <main id="main">
        <p class="eyebrow">Daily puzzles</p>
        <h1 id="puzzle-heading">Sudoku</h1>
        <p class="lede">A daily sudoku, a daily nonogram, and a daily word search. Everyone playing on this date gets the same puzzles. Each one has a single solution.</p>
        <p class="dateline"><time id="date-line"></time></p>
        <div class="day-nav">
          <button type="button" id="prev-day">Previous day</button>
          <button type="button" id="next-day">Next day</button>
        </div>
        <details id="archive">
          <summary>Archive</summary>
          <ul id="archive-list" class="archive-list"></ul>
        </details>
        <div class="tabs" role="tablist" aria-label="Puzzles">
          <button type="button" id="tab-sudoku" role="tab" aria-selected="true" aria-controls="panel">Sudoku <span id="sudoku-done" class="done" hidden>Done</span></button>
          <button type="button" id="tab-nonogram" role="tab" aria-selected="false" aria-controls="panel" tabindex="-1">Nonogram <span id="nonogram-done" class="done" hidden>Done</span></button>
          <button type="button" id="tab-wordsearch" role="tab" aria-selected="false" aria-controls="panel" tabindex="-1">Word search <span id="wordsearch-done" class="done" hidden>Done</span></button>
        </div>
        <p id="rollover" class="banner" hidden>A new puzzle day has started in Tokyo. <button type="button" id="load-today">Load today’s puzzles</button></p>
        <div id="panel" role="tabpanel" aria-labelledby="tab-sudoku">
          <div class="toolbar">
            <p class="meta" id="meta"></p>
            <p class="clock" role="timer"><span id="time">0:00</span> <span id="clock-note" class="clock-note"></span></p>
            <div class="toggles">
              <button type="button" id="pause" disabled>Pause</button>
              <button type="button" id="mistakes" aria-pressed="false">Check mistakes</button>
              <button type="button" id="large-print" aria-pressed="false">Large print</button>
              <button type="button" id="share-open" hidden>Share</button>
            </div>
          </div>
          <details id="help">
            <summary>How to play</summary>
            <div id="help-body"></div>
          </details>
          <div id="board-wrap"></div>
          <div id="pad"></div>
        </div>
      </main>
      <footer>
        <p>© Mossgate Puzzles</p>
        <p class="fine">Puzzles are built on this device. Progress stays in this browser.</p>
      </footer>
    </div>
    <dialog id="solved-dialog" aria-labelledby="solved-title">
      <h2 id="solved-title" tabindex="-1">Solved</h2>
      <p id="solved-detail"></p>
      <label for="share-text">Share text</label>
      <textarea id="share-text" readonly></textarea>
      <div class="dialog-actions">
        <button type="button" id="copy-share">Copy</button>
        <button type="button" id="close-solved">Close</button>
      </div>
    </dialog>
    <div id="live" class="sr-only" aria-live="polite"></div>
  `;

  state.today = tokyoDateString();
  state.puzzleDate = clampPuzzleDate(new URLSearchParams(location.search).get('date'), state.today);
  const cleaned = new URL(location.href);
  if (state.puzzleDate === state.today) cleaned.searchParams.delete('date');
  else cleaned.searchParams.set('date', state.puzzleDate);
  const cleanedHref = `${cleaned.pathname}${cleaned.search}${cleaned.hash}`;
  if (cleanedHref !== `${location.pathname}${location.search}${location.hash}`) {
    history.replaceState(null, '', cleanedHref);
  }
  const dateLine = must<HTMLTimeElement>('date-line');
  dateLine.dateTime = state.puzzleDate;
  dateLine.textContent = formatLongDate(state.puzzleDate);

  const save = loadSave(localStorage);
  state.largePrint = save.largePrint;
  state.checkMistakes = save.checkMistakes;
  state.sudokuStreak = save.sudokuStreak;
  state.nonogramStreak = save.nonogramStreak;
  state.wordsearchStreak = save.wordsearchStreak;
  state.days = save.days;
  loadDayProgress(state.puzzleDate);

  try {
    state.nonogramPuzzle = nonogramForDate(state.puzzleDate);
  } catch {
    state.nonogramError = true;
  }
  try {
    state.wordsearchPuzzle = wordsearchForDate(state.puzzleDate);
    state.wordsearch.found = state.wordsearch.found.filter((word) => state.wordsearchPuzzle?.words.includes(word));
  } catch {
    state.wordsearchError = true;
  }
  reconcile('nonogram');
  reconcile('wordsearch');
  state.mode = readMode();

  must('tab-sudoku').addEventListener('click', () => selectMode('sudoku'));
  must('tab-nonogram').addEventListener('click', () => selectMode('nonogram'));
  must('tab-wordsearch').addEventListener('click', () => selectMode('wordsearch'));
  must('prev-day').addEventListener('click', () => navigateDate(addDays(state.puzzleDate, -1)));
  must('next-day').addEventListener('click', () => navigateDate(addDays(state.puzzleDate, 1)));
  must('archive-list').addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('button[data-date]') : null;
    if (!(button instanceof HTMLButtonElement) || !button.dataset.date) return;
    navigateDate(button.dataset.date);
  });
  must('load-today').addEventListener('click', () => {
    const url = new URL(location.href);
    url.searchParams.delete('date');
    location.assign(`${url.pathname}${url.search}${url.hash}`);
  });
  must('pause').addEventListener('click', () => {
    const progress = progressOf(state.mode);
    if (progress.solved || !hasWork(state.mode)) return;
    progress.userPaused = !progress.userPaused;
    syncClock(state.mode);
    renderClock();
    persist();
  });
  must('mistakes').addEventListener('click', () => {
    state.checkMistakes = !state.checkMistakes;
    renderChrome();
    if (state.mode === 'sudoku' && state.sudokuPuzzle) refreshSudokuButtons();
    else if (state.mode === 'nonogram' && state.nonogramPuzzle) refreshNonogramSurface();
    else if (state.wordsearchPuzzle) refreshWordsearchSurface();
    persist();
    announce(state.checkMistakes ? 'Mistake checking on.' : 'Mistake checking off.');
  });
  must('large-print').addEventListener('click', () => {
    state.largePrint = !state.largePrint;
    renderChrome();
    persist();
    announce(state.largePrint ? 'Large print on.' : 'Large print off.');
  });
  must('share-open').addEventListener('click', openShare);
  must('copy-share').addEventListener('click', () => {
    void copyShare();
  });
  must('close-solved').addEventListener('click', () => must<HTMLDialogElement>('solved-dialog').close());
  must<HTMLDialogElement>('solved-dialog').addEventListener('close', () => {
    if (!must('share-open').hidden) must('share-open').focus();
  });

  const board = must('board-wrap');
  board.addEventListener('pointerdown', onPointerDown);
  board.addEventListener('pointermove', onPointerMove);
  board.addEventListener('pointerup', () => commitStroke());
  board.addEventListener('pointercancel', () => commitStroke());
  board.addEventListener('contextmenu', (event) => {
    if (state.mode === 'nonogram') event.preventDefault();
  });
  board.addEventListener('click', (event) => {
    if (event.target instanceof HTMLElement && event.target.id === 'reload') location.reload();
  });

  must('pad').addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('button') : null;
    if (!(button instanceof HTMLButtonElement)) return;
    if (button.dataset.digit) placeSudoku(Number(button.dataset.digit));
    else if (button.dataset.tool === 'fill' || button.dataset.tool === 'cross' || button.dataset.tool === 'erase') {
      state.tool = button.dataset.tool;
      syncPadState();
    } else if (button.id === 'notes') {
      state.notesMode = !state.notesMode;
      syncPadState();
    } else if (button.id === 'erase') {
      placeSudoku(null);
    } else if (button.id === 'undo') undo();
    if (button.dataset.digit || button.id === 'erase' || button.id === 'undo') focusSelected(true);
  });

  document.addEventListener('keydown', onKey);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      freezeClocks();
      persist();
    } else {
      syncClock('sudoku');
      syncClock('nonogram');
      syncClock('wordsearch');
      renderClock();
      checkRollover();
    }
  });
  window.addEventListener('pagehide', () => {
    freezeClocks();
    persist();
  });
  window.addEventListener('pageshow', () => {
    syncClock(state.mode);
    renderClock();
  });
  window.addEventListener('popstate', () => syncFromUrl());
  window.addEventListener('hashchange', () => syncFromUrl());

  renderHelp();
  renderPad();
  renderBoard();
  syncClock(state.mode);
  renderChrome();
  installVisitCounter();

  scheduleSudoku(state.puzzleDate);

  window.setInterval(() => {
    if (runtime[state.mode].runningSince != null) renderClock();
    checkRollover();
  }, 250);
}

boot();

async function copyShare(): Promise<void> {
  const text = must<HTMLTextAreaElement>('share-text').value;
  const button = must<HTMLButtonElement>('copy-share');
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = 'Copied';
    announce('Share text copied.');
  } catch {
    const area = must<HTMLTextAreaElement>('share-text');
    area.focus();
    area.select();
    let copied = false;
    try {
      copied = document.execCommand('copy');
    } catch {
      copied = false;
    }
    if (copied) {
      button.textContent = 'Copied';
      announce('Share text copied.');
    } else {
      announce('Select the share text and copy it.');
    }
  }
  window.setTimeout(() => {
    button.textContent = 'Copy';
  }, 2000);
}
