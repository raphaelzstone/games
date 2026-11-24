# Bridges

A daily bridge-building logic puzzle (a.k.a. "Hashiwokakero" / "Hashi").
Join the numbered islands with bridges so that:

- each island has exactly as many bridges as its number,
- bridges run straight across or down, between islands with nothing in between,
- at most two bridges join any pair of islands,
- bridges never cross, and
- all the islands form one connected group.

## Modes

- **Easy**: a 7×7 sea with 12 to 16 islands.
- **Hard**: a 10×10 sea with 22 to 28 islands, and every puzzle needs at least
  two proof-by-contradiction steps.

Both boards are date-seeded picks from pre-verified pools (`puzzles.js`,
`puzzles-hard.js`), so everyone gets the same puzzle each day.

## Solvability

Every shipped puzzle is solvable by pure logic. `generate.py` grows a random
connected solution, reads the island numbers off it, and ships it only if a
deduction solver that never guesses can determine every connection. That
solver uses island counting, the no-crossing rule, the connectivity rule, and
single-connection proof-by-contradiction. Because it never branches, a full
solve also proves the solution is unique. Each puzzle is additionally checked
by an independent brute-force counter that must find exactly one solution.

## Controls

- **Tap** an island to select it. The islands it can reach get a dashed ring.
- **Tap a ringed island** to add a bridge. The same pair again makes it a
  double, and once more removes it.
- **Drag** from one island to another does the same thing.
- **Tap a bridge** to cycle it: single, double, none.
- A bridge that would cross another is refused, and the blocking bridge flashes.
- Islands turn **grey** when complete and **red** when over their number.
- **Ansatz** starts a reversible line of reasoning; new bridges are orange.
  **Verified** keeps them. **Discard** restores the board from before the
  Ansatz and highlights the first bridge you tried for one move (undo brings
  the highlight back).

## Leaderboard (Firebase)

Scores live in their own Firestore collection (`bridges_scores`), keyed
`${date}_${userId}_${mode}`. Add this rule next to the other games':

```
match /bridges_scores/{docId} {
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

## Regenerating puzzles

```sh
python3 generate.py easy   # -> puzzles.js       (BRIDGES_PUZZLES)
python3 generate.py hard   # -> puzzles-hard.js  (BRIDGES_PUZZLES_HARD)
```

## Files

- `index.html`, `styles.css`, `app.js`: the game.
- `puzzles.js`, `puzzles-hard.js`: pre-verified daily pools.
- `identity.js`: shared arcade player identity.
- `firebase-config.js`, `leaderboard.js`: optional leaderboard.
- `manifest.json`, `sw.js`, `icon.svg`: PWA shell.
