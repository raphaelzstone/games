# Combos

A daily word game inspired by the *Split Decisions* puzzles from Games Magazine.
Split out of the original combined Word Split game so it stands on its own,
same as every other game in the arcade.

Given a 5–8 letter frame with two adjacent blanks (e.g. `hear__`), find *every*
word that fits (hearer, hearse, hearth, hearts, hearty). Every real word that
fits is a target (3–8 of them) — there are no "bonus" words, and a day always
has at least one frame with 4+ fills. The set is the same for everyone each
day. Answers are revealed right after each round (and again at the end).

## Scoring

3 rounds, worth **500** each (**1500** max). Each round is a 1:30 clock,
time-adjusted: the clock costs up to **100** points (nothing in the first
**0:15**, ramping to the full −100 over the middle minute, then flat for the
last **0:15**); the remaining value is then scaled by the share of fills
found: `score = (500 − time) × found/total`. So all fills in the first 0:15 →
500; all in the last 0:15 → 400; 3 of 4 in the last 0:15 → 300. A wrong guess
costs **2 seconds**.

Results persist per day. The menu shows a "Copy results" button (once you've
finished) that copies a spoiler-free summary:

```
Combos — 2026-06-08
1200/1500
```

## Identity (bird names)

The first time someone opens the site they're auto-assigned a random bird name
(e.g. `WisePuffin`, `BoldFalcon`). It's stored in `localStorage` — the same
identity shared across every game in the arcade — so the next day on the same
device they keep the same name. Click the name on the menu to rename — leaving
the prompt empty randomizes. Names are public on the leaderboard.

## Leaderboard (Firebase)

Optional. With no config the leaderboard view says "not yet configured" and
the rest of the site works fine. Scores live in their own Firestore collection
(`combos_scores`), keyed `${date}_${userId}` — one row per player per day.

```
match /combos_scores/{docId} {
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

That gives an honor-system leaderboard: anyone can read, anyone can write
their own day's score (capped at 1500), nobody can edit or delete. The
leaderboard view shows Today and Yesterday.

## Install as an app (PWA)

The site is a Progressive Web App. On iOS Safari, "Share → Add to Home Screen";
on Android Chrome, the menu offers "Install app". You get an icon, fullscreen
mode, and offline play (the game shell is cached; the leaderboard needs
network). No app stores involved.

## Run locally

Plain HTML/CSS/JS, no build step. Serve the folder over HTTP:

```sh
python3 -m http.server 4173
# open http://localhost:4173
```

## Streaks

Finishing the daily puzzle extends a 🔥 streak counter shown on the menu. Miss
a day and it resets to 0; the longest streak is also kept in `localStorage`.

## Files

- `index.html`, `styles.css`, `app.js` — the game.
- `puzzles.js` — the pre-verified daily pool (`COMBOS_POOL`).
- `identity.js` — player identity (random bird name + user id, localStorage).
- `firebase-config.js` — optional Firebase web config; leaves the leaderboard
  off if `apiKey` is empty.
- `leaderboard.js` — Firestore submit + fetch (ES module, loads Firebase SDK
  from CDN).
- `manifest.json`, `sw.js`, `icon.svg` — PWA shell (installable, offline).

## Regenerating puzzles

Puzzles are generated offline so quality (3–8 fills, every fill a common word)
can be verified against the complete dictionary before shipping. The generator
(`generate.py`) needs two inputs:

- ENABLE word list (e.g. `dolph/dictionary` `enable1.txt`)
- a frequency list (Norvig `count_1w.txt`) to define the "in-use" tier

Run it to overwrite `puzzles.js`. Tunables at the top: `COMMON_N` (vocabulary
tier), length bounds, the fill-count range, `JARGON` (curated technical words)
and `FOREIGN` (curated non-English words), and pool size.
