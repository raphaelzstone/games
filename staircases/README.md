# Staircases

A daily word puzzle. Three fresh puzzles a day, the same for everyone.

Each puzzle hides one **3-letter word** that "staircases" through four
6-letter words: in row *r* (0..3) the hidden word occupies columns *r..r+2*,
and the rest of each row is shown. Find the single 3-letter word that
completes all four rows into real words.

```
. . . E R Y      (ART)ERY
C . . . O N     C(ART)ON
H E . . . H    HE(ART)H
D E P . . .   DEP(ART)
```

Every shipped puzzle has a **unique solution** against the word list used to
generate it.

## Scoring

Each puzzle is its own **1:30 countdown**, worth up to **500 points** — the
same time-value curve as Word Split's Combos: full value in the first 0:15,
sliding down to a 300-point floor by 1:15, flat for the last 0:15. Run the
clock out without solving it and that puzzle scores **0** — the round ends
automatically and the answer is revealed. Three puzzles, **1500 points** max;
higher is better. There's no manual reveal/skip — it's a real timed round, not
a stopwatch you can pause. Results persist per day and copy as a spoiler-free
summary (score + solved marks, never the words).

## Files

| File | Purpose |
|------|---------|
| `index.html` | App shell (menu / game / results / leaderboard views). |
| `styles.css` | Theme + grid styling. |
| `app.js` | Game logic: daily pick, grid, timer, guess checking, share. |
| `puzzles.js` | Auto-generated pool of validated puzzles (`STAIRCASES_PUZZLES`). |
| `generate.py` | Puzzle generator (see below). |
| `identity.js` | Shared arcade player identity (bird name + id). |
| `leaderboard.js` | Firestore submit + fetch for the daily leaderboard. |
| `firebase-config.js` | Firebase web config (public by design — see the note in that file). |
| `sw.js`, `manifest.json`, `icon.svg` | PWA shell (installable, offline). |

## Generating puzzles

```sh
python3 generate.py [zipf_floor] [pool_size] [seed]
# e.g. python3 generate.py 2.5 900
```

Needs `pip install wordfreq`. The generator:

1. Builds a common-word list: 6-letter words that are (a) real dictionary
   words (checked against `/usr/share/dict/web2`, expanded with regular
   inflections it's missing, e.g. plurals/tenses) and (b) at least as common as
   `zipf_floor` by `wordfreq` frequency — this excludes proper nouns and most
   obscure/archaic words. `zipf_floor` trades vocabulary size for obscurity;
   the shipped pool uses 2.5, a notch more obscure than Word Split's tier.
2. For each candidate 3-letter trigram, looks for four distinct words (one per
   staircase offset) whose *other* three letters, combined, pin down that
   trigram as the **only** one consistent with all four rows — i.e. a unique
   solution, not just *a* valid one.
3. Ships up to a few puzzles per trigram so answers vary day to day.

## Leaderboard (Firebase / Firestore)

Same shared Firebase project as the other games; Staircases scores live in
their own `staircases_scores` collection, one document per player per day
(`${date}_${userId}`).

Firestore denies reads/writes to any collection with no matching rule, so a
**brand-new collection needs a rule added before its leaderboard will work** —
until then, `submitScore`/`fetchBoard` fail silently (a `permission-denied`
warning in the console; the local game is unaffected). Add this block in the
Firebase console (Firestore → Rules), alongside — not replacing — the other
games' rules:

```
match /staircases_scores/{docId} {
  allow read: if true;
  allow create, update: if
    request.resource.data.keys().hasOnly(['userId','name','date','score','createdAt'])
    && request.resource.data.userId is string
    && request.resource.data.name is string
    && request.resource.data.name.size() <= 20
    && request.resource.data.date is string
    && request.resource.data.score is number
    && request.resource.data.score >= 0
    && request.resource.data.score <= 1500
    && docId == request.resource.data.date + '_' + request.resource.data.userId;
  allow delete: if false;
}
```

Same casual-game posture as the other games: open writes, shape-validated, no
delete. Once added, the menu's 🏆 Leaderboard shows Today and Yesterday ranked
by highest score, with your own row highlighted.

**Note:** this collection's rule shape changed from an earlier version of
Staircases (which scored elapsed time, field `seconds`) to points (field
`score`, capped at 1500) — if you already added the old rule, replace it with
this one rather than adding a second block.
