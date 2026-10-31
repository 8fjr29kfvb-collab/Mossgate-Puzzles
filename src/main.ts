import '@fontsource/atkinson-hyperlegible/latin-400.css';
import '@fontsource/atkinson-hyperlegible/latin-700.css';
import './style.css';
import { installVisitCounter } from './counter.ts';
import { formatDuration, formatLongDate, tokyoDateString } from './date.ts';
import { describeNonogramCell, nonogramBoardHtml, nonogramButtonClass } from './nonogram-board.ts';
import { lineClues, nonogramForDate, type NonogramPuzzle } from './nonogram.ts';
import { nonogramShareText, sudokuShareText } from './share.ts';
import { recordCompletion, streakLabel, visibleStreak, type StreakRecord } from './streak.ts';
import {
  emptyNonogramProgress,
  emptySudokuProgress,
  loadSave,
  writeSave,
  type NonogramProgress,
  type SudokuProgress,
} from './storage.ts';
import { clueCount, sudokuBand, sudokuForDate, type SudokuPuzzle } from './sudoku.ts';

type Mode = 'sudoku' | 'nonogram';
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
  mode: 'sudoku' as Mode,
  largePrint: false,
  checkMistakes: false,
  sudokuStreak: { count: 0, lastDate: null } as StreakRecord,
  nonogramStreak: { count: 0, lastDate: null } as StreakRecord,
  sudokuPuzzle: null as SudokuPuzzle | null,
  nonogramPuzzle: null as NonogramPuzzle | null,
  sudoku: emptySudokuProgress(),
  nonogram: emptyNonogramProgress(),
  sudokuSelected: 0,
  nonogramSelected: 0,
  notesMode: false,
  tool: 'fill' as Tool,
  sudokuUndo: [] as SudokuUndo[],
  nonogramUndo: [] as NonogramChange[][],
  sudokuError: false,
  nonogramError: false,
};

const runtime: Record<Mode, Runtime> = {
  sudoku: { runningSince: null },
  nonogram: { runningSince: null },
};

let drag: { id: number; value: CellValue; changes: NonogramChange[]; seen: Set<number> } | null = null;

function must<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
}

function progressOf(mode: Mode): SudokuProgress | NonogramProgress {
  return mode === 'sudoku' ? state.sudoku : state.nonogram;
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
  return state.nonogram.solved || state.nonogram.elapsed > 0 || state.nonogram.cells.some(Boolean);
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
  for (const mode of ['sudoku', 'nonogram'] as const) {
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
  return state.mode === 'sudoku' ? state.sudokuSelected : state.nonogramSelected;
}

function shareText(): string {
  if (state.mode === 'sudoku' && state.sudokuPuzzle) {
    return sudokuShareText(state.today, shownElapsed('sudoku'), state.sudokuPuzzle.givens);
  }
  if (state.nonogramPuzzle) {
    return nonogramShareText(state.today, shownElapsed('nonogram'), state.nonogramPuzzle.solution);
  }
  return '';
}

function persist(): void {
  writeSave(localStorage, {
    version: 1,
    largePrint: state.largePrint,
    checkMistakes: state.checkMistakes,
    sudokuStreak: state.sudokuStreak,
    nonogramStreak: state.nonogramStreak,
    progressDate: state.today,
    sudoku: state.sudoku,
    nonogram: state.nonogram,
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
  const sudokuOn = state.mode === 'sudoku';
  sudokuTab.setAttribute('aria-selected', String(sudokuOn));
  nonogramTab.setAttribute('aria-selected', String(!sudokuOn));
  sudokuTab.tabIndex = sudokuOn ? 0 : -1;
  nonogramTab.tabIndex = sudokuOn ? -1 : 0;
  must('sudoku-done').hidden = !state.sudoku.solved;
  must('nonogram-done').hidden = !state.nonogram.solved;
  must('panel').setAttribute('aria-labelledby', sudokuOn ? 'tab-sudoku' : 'tab-nonogram');
  const puzzleName = sudokuOn ? 'Sudoku' : 'Nonogram';
  document.title = `${puzzleName} · Mossgate Puzzles`;
  const heading = document.getElementById('puzzle-heading');
  if (heading) heading.textContent = puzzleName;

  if (sudokuOn && state.sudokuPuzzle) {
    const clues = clueCount(state.sudokuPuzzle.givens);
    must('meta').textContent = `${sudokuBand(clues)} · ${streakLabel(visibleStreak(state.sudokuStreak, state.today))}`;
  } else if (!sudokuOn) {
    must('meta').textContent = `Daily · ${streakLabel(visibleStreak(state.nonogramStreak, state.today))}`;
  } else {
    must('meta').textContent = streakLabel(visibleStreak(state.sudokuStreak, state.today));
  }

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
  return state.mode === 'sudoku' ? state.sudokuUndo.length > 0 : state.nonogramUndo.length > 0;
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
    else label.textContent = state.tool === 'fill' ? 'Fill' : state.tool === 'cross' ? 'Cross' : 'Erase';
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
  } else {
    pad.innerHTML = `
      <p class="pad-label" id="pad-label">Fill</p>
      <div class="pad-tools">
        <button type="button" id="tool-fill" data-tool="fill" aria-pressed="true">Fill</button>
        <button type="button" id="tool-cross" data-tool="cross" aria-pressed="false">Cross</button>
        <button type="button" id="tool-erase" data-tool="erase" aria-pressed="false">Erase</button>
        <button type="button" id="undo">Undo</button>
      </div>
    `;
  }
  syncPadState();
}

function renderHelp(): void {
  must('help-body').innerHTML = state.mode === 'sudoku' ? SUDOKU_HELP : NONOGRAM_HELP;
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

function renderBoard(): void {
  if (state.mode === 'sudoku') renderSudokuBoard();
  else renderNonogramBoard();
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
  if (mode === 'sudoku') state.sudokuStreak = recordCompletion(state.sudokuStreak, state.today);
  else state.nonogramStreak = recordCompletion(state.nonogramStreak, state.today);
  persist();
  renderChrome();
  if (mode === 'sudoku') refreshSudokuButtons();
  else renderNonogramBoard();
  const name = mode === 'sudoku' ? 'sudoku' : 'nonogram';
  const time = formatDuration(shownElapsed(mode));
  const streak = visibleStreak(mode === 'sudoku' ? state.sudokuStreak : state.nonogramStreak, state.today);
  must('solved-title').textContent = 'Solved';
  must('solved-detail').textContent = `You finished today’s ${name} in ${time}. ${streakLabel(streak)}.`;
  must<HTMLTextAreaElement>('share-text').value = shareText();
  const dialog = must<HTMLDialogElement>('solved-dialog');
  if (!dialog.open) dialog.showModal();
  must('solved-title').focus();
  announce(`${name[0]!.toUpperCase()}${name.slice(1)} solved in ${time}. ${streakLabel(streak)}.`);
}

function openShare(): void {
  const name = state.mode === 'sudoku' ? 'sudoku' : 'nonogram';
  must('solved-detail').textContent = `You finished today’s ${name} in ${formatDuration(shownElapsed(state.mode))}. ${streakLabel(visibleStreak(state.mode === 'sudoku' ? state.sudokuStreak : state.nonogramStreak, state.today))}.`;
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

function onPointerDown(event: PointerEvent): void {
  const button = buttonFromTarget(event.target);
  if (!button) return;
  const index = Number(button.dataset.i);
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
  const size = state.mode === 'sudoku' ? 9 : (state.nonogramPuzzle?.size ?? 10);
  const current = selectedIndex();
  const row = Math.floor(current / size);
  const col = current % size;
  const nextRow = Math.min(size - 1, Math.max(0, row + rowDelta));
  const nextCol = Math.min(size - 1, Math.max(0, col + colDelta));
  const next = nextRow * size + nextCol;
  if (state.mode === 'sudoku') {
    state.sudokuSelected = next;
    refreshSudokuButtons();
  } else {
    state.nonogramSelected = next;
    refreshNonogramSurface();
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
    const next = event.key === 'ArrowRight' ? (state.mode === 'sudoku' ? 'nonogram' : 'sudoku') : state.mode === 'nonogram' ? 'sudoku' : 'nonogram';
    selectMode(next);
    must(next === 'sudoku' ? 'tab-sudoku' : 'tab-nonogram').focus();
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
  const hash = mode === 'nonogram' ? '#nonogram' : '#sudoku';
  if (location.hash !== hash) history.pushState(null, '', hash);
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
  return location.hash === '#nonogram' ? 'nonogram' : 'sudoku';
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
      state.sudokuStreak = recordCompletion(state.sudokuStreak, state.today);
    } else if (!complete) state.sudoku.solved = false;
  }
  if (mode === 'nonogram' && state.nonogramPuzzle) {
    const complete = nonogramComplete();
    if (complete && !state.nonogram.solved) {
      state.nonogram.solved = true;
      state.nonogramStreak = recordCompletion(state.nonogramStreak, state.today);
    } else if (!complete) state.nonogram.solved = false;
  }
}

function checkRollover(): void {
  must('rollover').hidden = tokyoDateString() === state.today;
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
        <p class="lede">A daily sudoku and a daily nonogram. Everyone playing on this date gets the same puzzles. Each one has a single solution.</p>
        <p class="dateline"><time id="date-line"></time></p>
        <div class="tabs" role="tablist" aria-label="Puzzles">
          <button type="button" id="tab-sudoku" role="tab" aria-selected="true" aria-controls="panel">Sudoku <span id="sudoku-done" class="done" hidden>Done</span></button>
          <button type="button" id="tab-nonogram" role="tab" aria-selected="false" aria-controls="panel" tabindex="-1">Nonogram <span id="nonogram-done" class="done" hidden>Done</span></button>
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
  const dateLine = must<HTMLTimeElement>('date-line');
  dateLine.dateTime = state.today;
  dateLine.textContent = formatLongDate(state.today);

  const save = loadSave(localStorage);
  state.largePrint = save.largePrint;
  state.checkMistakes = save.checkMistakes;
  state.sudokuStreak = save.sudokuStreak;
  state.nonogramStreak = save.nonogramStreak;
  if (save.progressDate === state.today) {
    if (save.sudoku) state.sudoku = save.sudoku;
    if (save.nonogram) state.nonogram = save.nonogram;
  }

  try {
    state.nonogramPuzzle = nonogramForDate(state.today);
  } catch {
    state.nonogramError = true;
  }
  reconcile('nonogram');
  state.mode = readMode();

  must('tab-sudoku').addEventListener('click', () => selectMode('sudoku'));
  must('tab-nonogram').addEventListener('click', () => selectMode('nonogram'));
  must('load-today').addEventListener('click', () => location.reload());
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
    else if (state.nonogramPuzzle) refreshNonogramSurface();
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
  window.addEventListener('popstate', () => applyMode(readMode()));
  window.addEventListener('hashchange', () => applyMode(readMode()));

  renderHelp();
  renderPad();
  renderBoard();
  syncClock(state.mode);
  renderChrome();
  installVisitCounter();

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      try {
        state.sudokuPuzzle = sudokuForDate(state.today);
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
