# Square Up

A daily dissection puzzle. One fresh 25-cell shape a day, the same for
everyone.

Split the shape into two pieces — tap cells to toggle which piece each one
belongs to — that can be rotated and/or reflected to reassemble into a
perfect 5×5 square. Every shipped puzzle has been verified to have **exactly
one** such split.

## Scoring

One count-up timer runs until you solve it; your time is the score (lower is
better). Stuck? **Skip** shows the answer, but earns no score — no leaderboard
entry, no streak. Results persist per day and copy as a spoiler-free summary
(time only, never the shape or the split).

## Files

| File | Purpose |
|------|---------|
| `index.html` | App shell (menu / game / results / leaderboard views). |
| `styles.css` | Theme + board styling. |
| `app.js` | Game logic: daily pick, board, tap-to-toggle, check/reveal, share. |
| `puzzles.js` | Auto-generated pool of validated puzzles (`SQUAREUP_PUZZLES`). |
| `generate.py` | Puzzle generator + uniqueness solver (see below). |
| `identity.js` | Shared arcade player identity (bird name + id). |
| `leaderboard.js` | Firestore submit + fetch for the daily leaderboard. |
| `firebase-config.js` | Firebase web config (public by design — see the note in that file). |
| `sw.js`, `manifest.json`, `icon.svg` | PWA shell (installable, offline). |

## Generating puzzles

```sh
python3 generate.py [pool_size] [seed]
# e.g. python3 generate.py 300
```

The generator works backwards from a known answer, so a solution always
exists by construction:

1. **Cut** a plain 5×5 square with a random staircase line into two pieces.
2. **Move** one piece — rotate and/or reflect it, then slide it to a new spot
   touching the other piece — so together they form a new, irregular but
   still-connected 25-cell shape with no gaps or overlaps. That shape is the
   puzzle; the solution is recovering the original two pieces.
3. **Verify uniqueness.** This is the part that matters: a full search over
   *every* way to split the shown shape into two connected pieces (a
   bitmask-based search over the 25 cells, with an early exit the instant a
   second, different valid split is found). A powerful prune makes this fast —
   a piece's bounding box can never exceed 5 in either axis under *any* of the
   8 square symmetries, so the moment a partial piece's box does, that whole
   branch is abandoned immediately, since no cells added to it later could ever
   bring it back into range. A puzzle ships only if the one split it was built
   from is the *only* one that reforms a square; every shape in the pool has
   also been independently re-verified from its saved data, not just trusted
   from generation time.

## Leaderboard (Firebase / Firestore)

Same shared Firebase project as the other games; Square Up scores live in
their own `squareup_scores` collection, one document per player per day
(`${date}_${userId}`).

Firestore denies reads/writes to any collection with no matching rule, so this
**needs a rule added before its leaderboard will work** — until then,
`submitScore`/`fetchBoard` fail silently (a `permission-denied` warning in the
console; the local game is unaffected). Add this block in the Firebase console
(Firestore → Rules), alongside — not replacing — the other games' rules:

```
match /squareup_scores/{docId} {
  allow read: if true;
  allow create, update: if
    request.resource.data.keys().hasOnly(['userId','name','date','seconds','createdAt'])
    && request.resource.data.userId is string
    && request.resource.data.name is string
    && request.resource.data.name.size() <= 20
    && request.resource.data.date is string
    && request.resource.data.seconds is number
    && request.resource.data.seconds > 0
    && docId == request.resource.data.date + '_' + request.resource.data.userId;
  allow delete: if false;
}
```

Same casual-game posture as the other games: open writes, shape-validated, no
delete. Once added, the menu's 🏆 Leaderboard shows Today and Yesterday ranked
by fastest time, with your own row highlighted.
