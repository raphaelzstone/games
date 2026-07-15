# Grader

A daily "End View" logic puzzle (a.k.a. "Easy as ABC") — place each letter
exactly once in every row and column; the outside letters tell you which
letter you'd see first looking into that row or column from that side.

## Modes

- **Easy** — a 5×5 grid, letters A–C.
- **Hard** — a 7×7 grid, letters A–D.

Both boards are date-seeded picks from pre-verified pools (`puzzles.js`,
`puzzles-hard.js`), so everyone gets the same fresh puzzle each day.

## The rule, precisely

Each of the K letters appears exactly once in every row and every column; the
remaining N-K cells in that row/column stay blank. A clue on the outside of a
row or column shows the first non-blank letter you'd encounter scanning in
from that side — so a clue right next to the edge can only be that letter or
blank, never any other letter.

## Solvability

Every shipped puzzle is solvable by pure logic — never by guessing. The
generator (`generate.py`) builds a random valid solution, derives its clues,
and only ships the puzzle if a solver that never branches — just constraint
propagation (row/column all-different, blank-count budgets, the clue-edge
scan rule) plus single-cell proof-by-contradiction ("assume this cell is X;
if that's contradictory, it can't be") — can fully determine every cell.
Because that solver never guesses, a full solve also proves the solution is
unique. Cross-checked against an independent brute-force solution counter on
sampled output.

Yield differs sharply by size: ~44% of random 5×5/A-C grids are pure-logic
solvable; only ~3.6% of random 7×7/A-D grids are (and every one of those
needed the contradiction step) — Hard is a meaningfully harder puzzle class,
not just a bigger board.

## Controls

- **Tap** a square to cycle it: blank ✗ → A → B → C (→ D on Hard) → empty.
- **Press & hold** a square to mark it **?** when unsure; tap once to clear.
- **Press & drag** to mark a run of squares blank (✗) at once.

## Identity (bird names)

The first time someone opens the site they're auto-assigned a random bird
name, stored in `localStorage` — the same identity shared across every game
in the arcade — so the next day on the same device they keep the same name.
Click the name on the menu to rename.

## Leaderboard (Firebase)

Optional. With no config the leaderboard view says "not configured" and the
rest of the site works fine. Scores live in their own Firestore collection
(`grader_scores`), keyed `${date}_${userId}_${mode}` — one row per player per
mode per day.

```
match /grader_scores/{docId} {
  allow read: if true;
  allow create, update: if
    request.resource.data.keys().hasOnly(['userId','name','date','seconds','mode','createdAt'])
    && request.resource.data.keys().hasAll(['userId','name','date','seconds','mode'])
    && request.resource.data.userId is string
    && request.resource.data.name is string
    && request.resource.data.name.size() <= 20
    && request.resource.data.date is string
    && request.resource.data.seconds is number
    && request.resource.data.seconds > 0
    && request.resource.data.mode in ['easy', 'hard']
    && docId == request.resource.data.date + '_' + request.resource.data.userId
                + '_' + request.resource.data.mode;
  allow delete: if false;
}
```

## Install as an app (PWA)

The site is a Progressive Web App. On iOS Safari, "Share → Add to Home
Screen"; on Android Chrome, the menu offers "Install app". You get an icon,
fullscreen mode, and offline play (the game shell is cached; the leaderboard
needs network).

## Run locally

Plain HTML/CSS/JS, no build step. Serve the folder over HTTP:

```sh
python3 -m http.server 4173
# open http://localhost:4173
```

## Streaks

Solving at least one board each day extends a 🔥 streak counter on the menu.
Miss a day and it resets to 0; the longest streak is also kept in
`localStorage`.

## Files

- `index.html`, `styles.css`, `app.js` — the game.
- `puzzles.js`, `puzzles-hard.js` — pre-verified daily pools (`GRADER_PUZZLES`,
  `GRADER_PUZZLES_HARD`).
- `identity.js` — player identity (random bird name + user id, localStorage).
- `firebase-config.js` — optional Firebase web config.
- `leaderboard.js` — Firestore submit + fetch (ES module, loads Firebase SDK
  from CDN).
- `manifest.json`, `sw.js`, `icon.svg` — PWA shell (installable, offline).

## Regenerating puzzles

```sh
python3 generate.py easy   # -> puzzles.js       (GRADER_PUZZLES)
python3 generate.py hard   # -> puzzles-hard.js  (GRADER_PUZZLES_HARD)
python3 generate.py hard 42   # ... with an explicit RNG seed
```

Hard mode's low pure-logic yield (~3.6%) means it takes noticeably longer to
build a full pool than Easy — budget a few minutes, not seconds.
