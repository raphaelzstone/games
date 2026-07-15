# Forks

A daily word game inspired by the *Split Decisions* puzzles from Games
Magazine. (Renamed from "Split Decisions" to avoid the trademark.) Split out
of the original combined Word Split game so it stands on its own, same as
every other game in the arcade.

Given a *split* (two letters on top, two on bottom), type the shared
surrounding letters so both stacked letters form a real word. Every puzzle has
exactly **one** solution, verified against the full dictionary. The set is the
same for everyone each day. The answer is revealed right after each round
(and again at the end).

## Scoring

2 rounds, worth **500** each (**1000** max). Fully time-based over a 2:00
round: the first **0:15** are free (**500**), points then slide down over the
next **1:30** to a floor of **200**, where they stay for the final **0:15**.
Miss it → 0. Wrong guesses are free. The clock just counts down — no live
points display.

Results persist per day. The menu shows a "Copy results" button (once you've
finished) that copies a spoiler-free summary:

```
Forks — 2026-06-08
700/1000
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
(`forks_scores`), keyed `${date}_${userId}` — one row per player per day.

```
match /forks_scores/{docId} {
  allow read: if true;
  allow create, update: if
    request.resource.data.keys().hasOnly(['userId','name','date','score','createdAt'])
    && request.resource.data.userId is string
    && request.resource.data.name is string
    && request.resource.data.name.size() <= 20
    && request.resource.data.date is string
    && request.resource.data.score is number
    && request.resource.data.score >= 0
    && request.resource.data.score <= 1000
    && docId == request.resource.data.date + '_' + request.resource.data.userId;
  allow delete: if false;
}
```

That gives an honor-system leaderboard: anyone can read, anyone can write
their own day's score (capped at 1000), nobody can edit or delete. The
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
- `puzzles.js` — the pre-verified daily pool (`FORKS_POOL`).
- `identity.js` — player identity (random bird name + user id, localStorage).
- `firebase-config.js` — optional Firebase web config; leaves the leaderboard
  off if `apiKey` is empty.
- `leaderboard.js` — Firestore submit + fetch (ES module, loads Firebase SDK
  from CDN).
- `manifest.json`, `sw.js`, `icon.svg` — PWA shell (installable, offline).

## Regenerating puzzles

Puzzles are generated offline so the unique-solution guarantee can be verified
against the complete dictionary before shipping. The generator (`generate.py`)
needs two inputs:

- ENABLE word list (e.g. `dolph/dictionary` `enable1.txt`)
- a frequency list (Norvig `count_1w.txt`) to define the "in-use" tier

Run it to overwrite `puzzles.js`. Tunables at the top: `COMMON_N` / `FORK_COMMON_N`
(vocabulary tiers), the word length bounds, `JARGON` (curated technical words)
and `FOREIGN` (curated non-English words), and pool size.
