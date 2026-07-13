# Games

A little arcade of daily logic puzzles — a fresh set every day, the same for
everyone. Each game lives in its own subfolder and keeps its own daily puzzle,
leaderboard, and streak; this repo just adds the hub that ties them together.

Live at `https://raphaelzstone.github.io/games/`.

## Games

| Game | Path | What it is |
|------|------|-----------|
| **Abodes** | [`abodes/`](abodes/) | A daily **Tents** logic puzzle — two boards a day, an 8×8 sprint and a 14×14 marathon. |
| **Word Split** | [`word-split/`](word-split/) | Two daily word puzzles back to back — **Combos** and **Forks**. |

Each subfolder is a self-contained static site (see its own `README.md`). They
share one Firebase project for leaderboards but keep their scores in separate
collections, and each registers its own service worker scoped to its folder —
so the three apps never interfere.

## Structure

```
games/
├── index.html        hub landing page
├── styles.css        hub theme
├── sw.js             hub service worker (scoped to /games/, ignores subfolders)
├── manifest.json     hub PWA manifest
├── icon.svg          hub logo
├── abodes/           the Abodes game (unchanged, moved in whole)
└── word-split/       the Word Split game (unchanged, moved in whole)
```

The old standalone `Abodes` and `word_split` repos now just redirect here, so
their original links keep working.

## Run locally

Plain HTML/CSS/JS, no build step. Serve the folder over HTTP so the subfolders
and service workers resolve:

```sh
python3 -m http.server 8000
# open http://localhost:8000  (hub), or .../abodes/ , .../word-split/
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
