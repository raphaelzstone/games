# Abodes

A daily **Tents** logic puzzle. Two fresh boards every day, the same for
everyone — race the clock and solve them as fast as you can.

- **Today's Camp** — the original **8×8** board. A quick daily solve (about a
  minute).
- **Hard Camp** — a **14×14** board, roughly triple the area. A distinctly
  longer, tougher sit-down (think several minutes).

Each mode has its own daily puzzle and its own leaderboard.

Place a tent next to every tree so that:

- each tent pairs one-to-one with an orthogonally-adjacent tree,
- no two tents touch (not even diagonally),
- each row and column holds the clued number of tents.

Every puzzle is **solvable by pure logic — no guessing required**. (Tents
mechanics are a generic, uncopyrightable puzzle type; the name, art, and code
here are original.)

## Play locally

It's a static site — no build step. Serve the folder and open it:

```sh
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Files

| File                 | Purpose |
|----------------------|---------|
| `index.html`         | App shell (menu / game / results / leaderboard views). |
| `styles.css`         | Theme + board styling. |
| `app.js`             | Game logic: per-mode daily pick, board, timer, win check, share. |
| `puzzles.js`         | Auto-generated pool of validated 8×8 puzzles (`ABODES_PUZZLES`). |
| `puzzles-hard.js`    | Auto-generated pool of validated 14×14 puzzles (`ABODES_PUZZLES_HARD`). |
| `generate.py`        | Puzzle generator + logic solver, both modes (see below). |
| `identity.js`        | Local player identity (random name + id). |
| `leaderboard.js`     | Firestore submit + fetch, split by mode (normal / hard). |
| `firebase-config.js` | Firebase web config for the leaderboard (public by design). |
| `sw.js`, `manifest.json`, `icon.svg` | PWA shell (installable, offline). |

## Generating puzzles

```sh
python3 generate.py            # normal → puzzles.js       (ABODES_PUZZLES)
python3 generate.py hard       # hard   → puzzles-hard.js  (ABODES_PUZZLES_HARD)
python3 generate.py hard 42    # ... with an explicit RNG seed
```

The first argument selects a preset (`normal`, the default, or `hard`); an
optional second argument overrides the RNG seed. The two presets differ only in
grid size, tent density, and pool size — see `PRESETS` at the top of
`generate.py`.

The generator builds a random valid solution, derives the row/column clues, and
then runs a **deduction solver** that only makes forced moves — ordinary
constraint propagation plus single-cell proof-by-contradiction (valid logic, not
guessing). A board is shipped only if the solver determines every cell, which
also proves the solution is unique. Every shipped board genuinely needs the
contradiction step, and boards are varied via a random seed so there's no
memorizable pattern across days.

## Leaderboard (Firebase / Firestore)

Daily fastest-solve rankings are backed by Cloud Firestore. The web config lives
in `firebase-config.js` (public by design — see the note in that file), and
`leaderboard.js` reads/writes a dedicated `abodes_scores` collection.

Each mode has its own leaderboard, kept in the same collection and told apart by
a `mode` field:

- **Normal** documents keep the original id/shape (`${date}_${userId}`, no
  `mode` field). Nothing about normal mode changed, so existing scores and the
  existing security rule keep working untouched.
- **Hard** documents are id'd `${date}_${userId}_hard` and carry `mode: "hard"`.

`fetchBoard(date)` pulls the day's rows with a single date-equality query and
splits them into `{ normal, hard }` client-side (documents with no `mode` field
count as normal), so there's still no composite index to set up.

To enable it:

1. **Firestore** — in the Firebase console, open *Firestore Database* and create a
   database if you don't have one.
2. **Config** — paste your project's web config into `firebase-config.js`. (It's
   currently set to the shared `word-split` project; swap in an Abodes-specific
   project if you'd prefer them fully separate.)
3. **Security rules** — Abodes uses an anonymous per-device id (no Firebase Auth),
   so writes are open but shape-validated. **Replace your existing
   `abodes_scores` block** with the one below (it accepts both the original
   normal documents *and* the new hard ones — leave any other apps' rules
   alone). Until you do this, hard-mode times won't record — normal mode keeps
   working with the old rule in place, so there's no rush and nothing else
   breaks:

   ```
   match /abodes_scores/{docId} {
     allow read: if true;
     allow create, update: if
       request.resource.data.keys().hasOnly(['userId','name','date','seconds','createdAt','mode'])
       && request.resource.data.keys().hasAll(['userId','name','date','seconds'])
       && request.resource.data.userId is string
       && request.resource.data.name is string
       && request.resource.data.name.size() <= 20
       && request.resource.data.date is string
       && request.resource.data.seconds is number
       && request.resource.data.seconds > 0
       && (
         // Normal: no mode field, id = date_userId
         (!('mode' in request.resource.data)
           && docId == request.resource.data.date + '_' + request.resource.data.userId)
         // Hard (or any moded score): id = date_userId_mode
         || (request.resource.data.mode in ['normal', 'hard']
           && docId == request.resource.data.date + '_' + request.resource.data.userId
                       + '_' + request.resource.data.mode)
       );
     allow delete: if false;
   }
   ```

   This is a casual-game posture: anyone could in principle spoof a score since
   there's no auth. Fine for a friends board; add Firebase Auth if you ever need
   it to be tamper-proof.

That's it — once configured, the menu's 🏆 Leaderboard shows Normal and Hard,
each with Today and Yesterday ranked by fastest time, with your own row
highlighted.
