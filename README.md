# Games

A little arcade of daily logic puzzles — a fresh set every day, the same for
everyone. Each game lives in its own subfolder and keeps its own daily puzzle,
leaderboard, and streak; this repo just adds the hub that ties them together.

Live at `https://raphaelzstone.github.io/games/`.

## Games

| Game | Path | What it is |
|------|------|-----------|
| **Abodes** | [`abodes/`](abodes/) | A daily **Tents** logic puzzle — two boards a day, an 8×8 sprint and a 14×14 marathon. |
| **Combos** | [`combos/`](combos/) | A daily word puzzle — find every two-letter fill that makes a real word. Three rounds a day. |
| **Forks** | [`forks/`](forks/) | A daily word puzzle — given the split, find the one shared word. Two rounds a day. |
| **Staircases** | [`staircases/`](staircases/) | Three daily word puzzles — find the hidden 3-letter word that climbs through four rows. |
| **Grader** | [`grader/`](grader/) | A daily "End View" logic puzzle — place each letter once in every row and column; outside clues show what you'd see first. Easy (5×5, A-C) and Hard (7×7, A-D). |
| **Square Up** | [`squareup/`](squareup/) | *(currently offline — see below)* A daily dissection puzzle — split a shape into two pieces that reassemble into a perfect square. |

Combos and Forks used to be one combined "Word Split" game; they're now split
into their own subfolders so every game in the arcade has the same flat
structure. `word-split/` still exists purely as a redirect to this hub, for
anyone with the old link bookmarked.

Each subfolder is a self-contained static site (see its own `README.md`). They
share one Firebase project for leaderboards but keep their scores in separate
collections, and each registers its own service worker scoped to its folder —
so the games never interfere with each other. They also share one player
identity (`games:user` in `localStorage` — pick a name in any game or on the
hub and it's the same name everywhere).

## Structure

```
games/
├── index.html        hub landing page
├── styles.css        hub theme
├── sw.js             hub service worker (scoped to /games/, ignores subfolders)
├── manifest.json     hub PWA manifest
├── icon.svg          hub logo
├── identity.js       shared arcade player identity (bird name + id)
├── hub-board.js      "yesterday's top 3" strip, one tab per subgame
├── abodes/           the Abodes game
├── combos/           the Combos game
├── forks/            the Forks game
├── staircases/       the Staircases game
├── grader/           the Grader game
├── squareup/         the Square Up game (currently unlinked from the hub)
└── word-split/       redirects to the hub — Combos/Forks's old combined home
```

The old standalone `Abodes` and `word_split` repos now just redirect here, so
their original links keep working.

## Run locally

Plain HTML/CSS/JS, no build step. Serve the folder over HTTP so the subfolders
and service workers resolve:

```sh
python3 -m http.server 8000
# open http://localhost:8000  (hub), or .../abodes/ , .../combos/ , etc.
```

## Deploy (GitHub Pages)

Served straight from `main` via **Settings → Pages → Deploy from a branch**
(`main`, root). Pushing updates the site.

## Adding a game

1. Drop the game's static files into a new subfolder (e.g. `newgame/`), keeping
   its asset paths relative and its service worker registered relatively so it
   stays scoped to its own folder.
2. Add a card to `index.html`.
3. If it needs a leaderboard, point it at the shared Firebase project with its
   own collection.
