# Word Split

A daily word game inspired by the *Split Decisions* puzzles from Games Magazine.
Two independent daily games played one round after another. The set is the same
for everyone each day. **Combos** is **3 rounds** of 5–8 letter words; **Forks**
is **2 rounds** of 5–6 letter words. Each round's answers are revealed right
after you play it (and again at the end).

## Modes

- **Combos** — given a 5–8 letter frame with two adjacent blanks (e.g.
  `hear__`), find *every* word that fits (hearer, hearse, hearth, hearts,
  hearty). Every real word that fits is a target (3–8 of them) — there are no
  "bonus" words, and a day always has at least one frame with 4+ fills.
- **Forks** — given a *split* (two letters on top, two on bottom), type the
  shared surrounding letters so both stacked letters form a real word. Every
  Forks puzzle has exactly **one** solution, verified against the full
  dictionary. (Renamed from "Split Decisions" to avoid the trademark.)

## Scoring

Rounds are worth **500** each: Combos tops out at **1500** (3 rounds), Forks at
**1000** (2 rounds).

- **Combos** — a 1:30 round, time-adjusted. The clock costs up to **100**
  points (nothing in the first **0:15**, ramping to the full −100 over the
  middle minute, then flat for the last **0:15**); the remaining value is then
  scaled by the share of fills found: `score = (500 − time) × found/total`. So
  all fills in the first 0:15 → 500; all in the last 0:15 → 400; 3 of 4 in the
  last 0:15 → 300. A wrong guess costs **2 seconds**.
- **Forks** — fully time-based over a 2:00 round. The first **0:15** are free
  (**500**); points then slide down over the next **1:30** to a floor of
  **200**, where they stay for the final **0:15**. Miss it → 0. Wrong guesses
  are free. The clock just counts down — no live points display.

Results persist per day. The menu shows a single "Copy results" button (only
after you've finished at least one mode) that copies a spoiler-free summary
like:

```
Word Split — 2026-06-08
Combos: 1200/1500
Forks: 700/1000
```

## Identity (bird names)

The first time someone opens the site they're auto-assigned a random bird name
(e.g. `WisePuffin`, `BoldFalcon`). It's stored in `localStorage` along with an
opaque user id, so the next day on the same device they keep the same name.
Click the name on the menu to rename — leaving the prompt empty randomizes.
Names are public on the leaderboard.

## Leaderboard (Firebase)

Optional. With no config the leaderboard view says "not yet configured" and the
rest of the site works fine. To turn it on (~5 minutes):

1. Create a project at https://console.firebase.google.com.
2. **Build → Firestore Database → Create database** (start in production mode;
   we lock down with rules below).
3. **Project settings → Your apps → `</>`** to register a web app; copy the
   `firebaseConfig` object into `firebase-config.js` (replacing the `null`).
4. In Firestore **Rules**, paste these and **Publish**:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /scores/{scoreId} {
         allow read: if true;
         allow create: if request.resource.data.keys().hasAll(['userId','name','date','mode','score','ts'])
                       && request.resource.data.score is number
                       && request.resource.data.score >= 0
                       && request.resource.data.score <= 1500;
         allow update, delete: if false;
       }
     }
   }
   ```

That gives an honor-system leaderboard: anyone can read, anyone can write a new
score (capped at the game's max), nobody can edit or delete. Each player has
one row per mode per day (the doc id is `userId_date_mode`). The leaderboard
view shows top 50 for today and yesterday, both modes.

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

## Deploy (GitHub Pages)

This repo ships a GitHub Actions workflow (`.github/workflows/deploy.yml`)
that rewrites the service-worker `CACHE_VERSION` to the commit SHA on every
push, so installed users always detect new builds and get a "Reload" toast
instead of being stuck on stale caches.

One-time setup: in **Settings → Pages**, switch the source from "Deploy from a
branch" to "**GitHub Actions**". After that, every push to `main` deploys
automatically. Live at `https://<user>.github.io/word_split/`.

## Streaks

Finishing at least one mode each day extends a 🔥 streak counter shown on the
menu. Miss a day and it resets to 0; the longest streak is also kept in
`localStorage` for future leaderboard ideas.

## Files

- `index.html`, `styles.css`, `app.js` — the game.
- `puzzles.js` — pre-verified daily pools (`COMBOS_POOL`, `FORKS_POOL`).
- `birds.js` — player identity (random bird name + user id, localStorage).
- `firebase-config.js` — optional Firebase web config; `null` disables the
  leaderboard.
- `leaderboard.js` — Firestore submit + fetch (ES module, loads Firebase SDK
  from CDN).
- `manifest.json`, `sw.js`, `icon.svg` — PWA shell (installable, offline).

## Regenerating puzzles

Puzzles are generated offline so quality (3–8 fills, every fill a common word;
unique Forks solutions) can be verified against the complete dictionary before
shipping. The generator (`generate.py`) needs two inputs:

- ENABLE word list (e.g. `dolph/dictionary` `enable1.txt`)
- a frequency list (Norvig `count_1w.txt`) to define the "in-use" tier

Run it to overwrite `puzzles.js`. Tunables at the top: `COMMON_N` (combos
vocabulary tier) and `FORK_COMMON_N` (a tighter tier for Forks), the per-mode
length bounds, the combo fill-count range, `JARGON` (curated technical words)
and `FOREIGN` (curated non-English words, derived with the `wordfreq` library
but baked in so generation needs no extra dependency), and pool size.
