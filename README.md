# Mossgate Puzzles

A woodland front page and a daily sudoku, nonogram, and word search. The site is static: the landing page, plus puzzles built in the browser. There is no account, no server, and no puzzle API.

The front page is the gate. Today’s sudoku, nonogram, and word search are one click in, at `/play/`. Each puzzle has one solution. Progress and streaks stay in `localStorage` on the device. Earlier days are at `/play/?date=YYYY-MM-DD`, from the launch date 31 October 2026 through today in Tokyo.

## Run locally

```bash
npm install
npm test
npm run dev
```

Open [http://127.0.0.1:41773/](http://127.0.0.1:41773/) for the landing page and [http://127.0.0.1:41773/play/](http://127.0.0.1:41773/play/) for the daily puzzles.

`npm test` checks the solvers, the Tokyo date change, streaks, share text, the landing copy, and that every generated puzzle has exactly one solution.

`npm run build` writes the static site to `dist/`. The production build uses the project-site base `/Mossgate-Puzzles/`. `npm run preview` serves that folder.

## GitHub Pages

The site is meant for [https://8fjr29kfvb-collab.github.io/Mossgate-Puzzles/](https://8fjr29kfvb-collab.github.io/Mossgate-Puzzles/).

`.github/workflows/pages.yml` builds on pushes to `main` and deploys the `dist/` folder with `actions/upload-pages-artifact` and `actions/deploy-pages`. Asset paths use the base `/Mossgate-Puzzles/`, so the landing page, `/play/`, the fox picture, and the gate mark resolve on that project site.

Turning Pages on is a repository setting. This project does not change that setting. After Pages is set to GitHub Actions, the workflow can publish. Until then, the deploy job has nowhere to go.

`og:image` is the relative path `assets/mossgate-fox.webp`, which resolves from the page. Replace it with the absolute URL after the site is public. The comment in `index.html` has the expected address.

## Daily seeding

The puzzle day is the calendar date in **Asia/Tokyo** (Japan Standard Time, UTC+9, no daylight saving). Players in other timezones get that same puzzle, including after their own local midnight, until it is midnight in Tokyo.

`2026-10-31T14:59:59Z` is still 31 October in Tokyo. `2026-10-31T15:00:00Z` is 1 November.

### Sudoku

The seed is FNV-1a of `mossgate-sudoku-v1:YYYY-MM-DD`, expanded with mulberry32. The generator fills a complete grid, then removes clues (preferring 180° pairs) while a solver still finds exactly one solution. It stops in the low 40s, so the day’s sudoku stays in the easy band. The same date always rebuilds the same grid. A different date builds a different one.

### Nonogram

Pictures are a checked catalog of at least 60 hand-built 10×10 grids in `src/patterns.ts`. Names in that file are not shown on the page. The Tokyo day number since `2026-01-01` picks an entry. A step that shares no common factor with the catalog length walks through every picture before it repeats. Clues are the run lengths of that picture. Tests reject a picture unless line logic alone rebuilds it, which means the clues have one solution.

## Play

- Sudoku: tap a cell, then a digit. Notes are pencil marks. Check mistakes compares an entry with the solution and does not fill in the right digit.
- Nonogram: tap or drag to fill. Cross marks a cell to leave empty. A struck-through clue means that line matches its numbers.
- Word search: tap the first letter, then the last. The word list sits under the grid.
- The timer starts on the first edit, pauses when you leave the tab, and can be paused by hand.
- Large print switches the play page to Atkinson Hyperlegible (self-hosted, no font request to another site) at 18px and up, with larger digits.
- Arrow keys, digits, and the shortcuts in “How to play” work from the grid.
- When a puzzle is finished, the solved screen includes share text: an emoji grid and the time, with no link.

Streaks are per puzzle. Finishing the same Tokyo date twice does not add a day. Missing a day resets that streak. The count still shows on the following morning so it is clear what continuing would keep. Solving an earlier date does not change the streak. Share text names the puzzle’s date.

Previous day and Next day step through the archive. The Archive list runs from today back to launch and marks a day with a check when the sudoku, nonogram, and word search are all solved. The list is only on this device.

### Word search

The seed is FNV-1a of `mossgate-words-v1:YYYY-MM-DD`, expanded with mulberry32. Weekdays are a 20×20 grid with 22 words. Sundays in Tokyo are a 25×25 grid with 32 words. The size follows the date only, so a phone and a desktop get the same puzzle. The grid scales to the width of the screen, including in large print, and Zoom and Pan adjust the view. Words read across, down, or diagonally down-right, never backwards. If the random letters would spell a blocklisted word, or a placed word would appear twice, the generator retries with `mossgate-words-v1:YYYY-MM-DD#n`. Themes and word lists are hand-written in `src/words.ts`.

The save key is `mossgate-puzzles-v1`. The document version is 2: a map of date to that day’s progress, capped at 60 dates. A version 1 save, which stored only the latest day, is read into that day’s slot so it is not dropped.

## Visit counter

`src/counter.ts` exports `visitCounter.enabled`, which is `false`. Leave it false.

To enable a cookie-free [GoatCounter](https://www.goatcounter.com/) later, set `enabled` to `true` and `src` to the site count URL (`https://<code>.goatcounter.com/count`). The play page will then load `https://gc.zgo.at/count.js`. While the flag is false, that script is not added and no counter request is made.

## Privacy

No accounts, ads, payments, cookies, or third-party trackers. Puzzle generation and the timer run on the device. The landing page does not include a form or a store link.

© Mossgate Puzzles
