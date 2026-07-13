"use strict";

/* ===========================================================================
 * Word Split — daily word puzzles (vanilla JS)
 *
 * Two independent daily games; rounds are worth 500 each. Combos: 3 rounds
 * (1:30 each, 1500 max). Forks: 2 rounds (2:00 each, 1000 max).
 *   combos — find every 2-letter fill for a 5-8 letter frame (3-8 fills).
 *            Every real word that fits is a target. Score is time-adjusted
 *            completion: the clock costs up to 100 (0 in the first 0:15, full
 *            by the last 0:15), then the remaining value is scaled by the share
 *            of fills found. 1:30 round; a wrong guess costs 2s.
 *   forks  — given a split, type the shared letters (one unique solution).
 *            Fully time-based over a 2:00 round: first 0:15 free (500), then a
 *            1:30 slide down to 200, then the final 0:15 flat at 200. Wrong
 *            guesses are free.
 * After each round its answers are revealed on the interstitial.
 *
 * Puzzles are date-seeded picks from pre-verified pools (puzzles.js), so
 * everyone gets the same fresh set each day. Results persist per day and copy
 * as a spoiler-free summary (points + times only — never the words).
 * ========================================================================= */

const WRONG_PENALTY_SEC = 2;     // a wrong guess costs this much time

const COMBO_LIMIT_SEC = 90;      // 1:30 round
const COMBO_FREE_SEC = 15;       // no time penalty within the first 0:15
const COMBO_PENALTY_SEC = 75;    // full time penalty by here (last 0:15), i.e. -100
const COMBO_TIME_PENALTY = 100;  // most points the clock can cost (over the middle minute)
const FORK_LIMIT_SEC = 120;      // 2:00 round, fully time-scored
const FORK_FREE_SEC = 15;        // full points within the first 0:15
const FORK_FLOOR_SEC = 105;      // 200-pt floor reached here (last 0:15 flat)
const FORK_FLOOR_POINTS = 200;   // forks never drops below this once solved

// Rounds are worth 500 each. Combos: 3 rounds (1500 max). Forks: 2 rounds (1000 max).
const CONFIG = {
  combos: { name: "Combos", pool: COMBOS_POOL, limit: COMBO_LIMIT_SEC, rounds: 3, points: 500 },
  forks: { name: "Forks", pool: FORKS_POOL, limit: FORK_LIMIT_SEC, rounds: 2, points: 500 },
};

// --- Scoring ----------------------------------------------------------------
// Forks: solved within 0:15 -> full; slide to the 200 floor by 1:45; flat after.
function forkScore(solved, sec, full) {
  if (!solved) return 0;
  if (sec <= FORK_FREE_SEC) return full;
  if (sec >= FORK_FLOOR_SEC) return FORK_FLOOR_POINTS;
  return Math.round(
    full - (full - FORK_FLOOR_POINTS) * (sec - FORK_FREE_SEC) / (FORK_FLOOR_SEC - FORK_FREE_SEC));
}
// Combos: time-adjusted completion. The clock costs up to 100 points, ramping
// from 0 at 0:15 to 100 over the middle minute (to 1:15), then flat. Whatever
// the round is worth after that is scaled by the share of fills found. So all
// fills in the first 0:15 -> 500; all in the last 0:15 -> 400; 3 of 4 in the
// last 0:15 -> 400 * 3/4 = 300.
function comboTimePenalty(sec) {
  if (sec <= COMBO_FREE_SEC) return 0;
  if (sec >= COMBO_PENALTY_SEC) return COMBO_TIME_PENALTY;
  return COMBO_TIME_PENALTY * (sec - COMBO_FREE_SEC) / (COMBO_PENALTY_SEC - COMBO_FREE_SEC);
}
function comboScore(found, total, full, sec) {
  return Math.round((full - comboTimePenalty(sec)) * (found / total));
}

// --- Seeded RNG (mulberry32) ------------------------------------------------
function hashString(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seededPick(pool, count, seedStr) {
  const rng = mulberry32(hashString(seedStr));
  const idx = pool.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx.slice(0, count).map((i) => pool[i]);
}

function dateKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function fmtClock(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
function fmtElapsed(sec) {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// --- DOM + views ------------------------------------------------------------
const $ = (sel) => document.querySelector(sel);
const views = {
  menu: $("#view-menu"), game: $("#view-game"),
  results: $("#view-results"), board: $("#view-board"),
};
function showView(name) {
  for (const [k, el] of Object.entries(views)) el.hidden = k !== name;
  $("#home-btn").hidden = name === "menu";
}

// --- Storage ----------------------------------------------------------------
const storageKey = (mode) => `wordsplit:${mode}:${dateKey()}`;
function loadResult(mode) {
  try {
    const r = JSON.parse(localStorage.getItem(storageKey(mode)) || "null");
    if (!r) return null;
    // Discard stale saves whose shape doesn't match the current config (e.g.
    // a previous version had a different round count). Better to let the
    // player re-play today than to render bogus rows.
    const expected = CONFIG[mode].rounds;
    if (!Array.isArray(r.rows) || r.rows.length !== expected) {
      localStorage.removeItem(storageKey(mode));
      return null;
    }
    return r;
  } catch { return null; }
}
function saveResult(mode, result) {
  try { localStorage.setItem(storageKey(mode), JSON.stringify(result)); }
  catch { /* storage unavailable — game still works */ }
}

// --- Streak -----------------------------------------------------------------
// Count of consecutive days the player has finished at least one game. Stored
// as { count, longest, lastDate }; the displayed "current" streak is computed
// against today so a missed day shows 0 rather than a stale number.
const STREAK_KEY = "wordsplit:streak";
function loadStreakRaw() {
  try { return JSON.parse(localStorage.getItem(STREAK_KEY) || "null"); }
  catch { return null; }
}
function dateKeyOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return dateKey(d);
}
function currentStreak() {
  const s = loadStreakRaw();
  if (!s || !s.lastDate) return 0;
  if (s.lastDate === dateKey() || s.lastDate === dateKeyOffset(1)) return s.count;
  return 0;
}
function bumpStreak() {
  const today = dateKey();
  const yest = dateKeyOffset(1);
  const s = loadStreakRaw() || { count: 0, longest: 0, lastDate: null };
  if (s.lastDate === today) return;          // already counted today
  s.count = s.lastDate === yest ? s.count + 1 : 1;
  s.longest = Math.max(s.longest || 0, s.count);
  s.lastDate = today;
  try { localStorage.setItem(STREAK_KEY, JSON.stringify(s)); } catch {}
}

// --- Build today's puzzles --------------------------------------------------
// Combos: seeded pick of N frames, guaranteeing at least one has 4+ fills so a
// day is never all trivial 3-fill frames.
function pickCombos(pool, seedStr, n) {
  const order = seededPick(pool, pool.length, seedStr);
  const picks = order.slice(0, n);
  if (picks.every((p) => p.answers.length === 3)) {
    const alt = order.slice(n).find((p) => p.answers.length >= 4);
    if (alt) picks[picks.length - 1] = alt;
  }
  return picks;
}

function buildPuzzles(mode) {
  if (mode === "combos") {
    return pickCombos(CONFIG.combos.pool, `combos:${dateKey()}`, CONFIG.combos.rounds).map((p) => {
      const [pre, suf] = p.frame.split("__");
      return {
        type: "combos",
        frame: p.frame, pre, suf,
        answers: p.answers.map((a) => a.toLowerCase()),
        found: [], solved: false,
      };
    });
  }
  const picks = seededPick(CONFIG.forks.pool, CONFIG.forks.rounds, `forks:${dateKey()}`);
  return picks.map((p) => {
    const i = p.splitIndex;
    const w1 = p.word1.toUpperCase(), w2 = p.word2.toUpperCase();
    return {
      type: "forks",
      length: w1.length, splitIndex: i,
      top: w1.slice(i, i + 2), bottom: w2.slice(i, i + 2),
      shared: (w1.slice(0, i) + w1.slice(i + 2)).split(""),
      words: [w1, w2], solved: false,
    };
  });
}

/* ===========================================================================
 * Game state + per-puzzle loop
 *
 * Time is tracked as effective elapsed = wall clock + accumulated penalties,
 * so a wrong guess simply adds WRONG_PENALTY_SEC to your spent time.
 * ========================================================================= */
let game = null;

function startGame(mode) {
  const existing = loadResult(mode);
  if (existing) { renderResults(mode, existing, /*replay*/ true); return; }

  game = {
    mode, cfg: CONFIG[mode], puzzles: buildPuzzles(mode),
    idx: 0, results: [], puzzleStart: 0, penaltyMs: 0, tickId: null,
  };
  $("#rules-text").textContent = mode === "combos"
    ? "Type every two-letter fill that makes a real word. Faster = more points · wrong guess −2s."
    : "Type the shared letters so both stacked letters make a real word. Faster = more points.";
  showView("game");
  showPuzzle(0);
}

function showPuzzle(i) {
  game.idx = i;
  game.penaltyMs = 0;
  const p = game.puzzles[i];
  $("#progress-pill").textContent = `Round ${i + 1} of ${game.cfg.rounds}`;
  $("#skip-btn").hidden = false;
  $("#skip-btn").textContent = "Skip round";

  const root = $("#puzzles");
  root.innerHTML = "";
  root.appendChild(p.type === "combos" ? renderCombo(p) : renderFork(p));

  game.puzzleStart = performance.now();
  updateCountdown();
  game.tickId = setInterval(tick, 200);

  const first = root.querySelector("input:not([disabled])");
  if (first) first.focus();
}

function limitSec() {
  return game.cfg.limit;
}
function elapsedMs() {
  return performance.now() - game.puzzleStart + game.penaltyMs;
}
function remainingMs() {
  return limitSec() * 1000 - elapsedMs();
}
function elapsedSec() {
  return Math.min(limitSec(), elapsedMs() / 1000);
}

function tick() {
  updateCountdown();
  if (remainingMs() <= 0) endPuzzle();
}

function updateCountdown() {
  const remaining = remainingMs();
  const el = $("#countdown");
  el.textContent = fmtClock(remaining);
  el.classList.toggle("urgent", remaining <= 15000);
}

// A wrong guess costs time: add the penalty and reflect it on the clock.
function penalize() {
  game.penaltyMs += WRONG_PENALTY_SEC * 1000;
  updateCountdown();
  if (remainingMs() <= 0) endPuzzle();
}

// Called on solve, time-out, or skip. Scores the current puzzle and advances.
// Guarded against double-fire so a near-simultaneous (solve + tick timeout +
// skip) can't ever push two results for the same round.
function endPuzzle() {
  if (!game.tickId) return;
  clearInterval(game.tickId);
  game.tickId = null;
  const p = game.puzzles[game.idx];
  const sec = elapsedSec();

  let result;
  if (p.type === "combos") {
    const found = p.found.length, total = p.answers.length;
    const solved = found === total;
    result = { type: "combos", solved, found, total, sec, points: comboScore(found, total, game.cfg.points, sec) };
  } else {
    result = { type: "forks", solved: p.solved, sec, points: forkScore(p.solved, sec, game.cfg.points) };
  }
  game.results.push(result);
  showInterstitial(result);
}

// The day's answers for one puzzle, shown on its interstitial. Combos lists
// each full word (green if you found it, red if missed); Forks shows the pair.
function revealAnswers(p) {
  if (p.type === "combos") {
    const chips = p.answers
      .map((a) => `<span class="chip ${p.found.includes(a) ? "found" : "missed"}">${p.pre}${a}${p.suf}</span>`)
      .join("");
    return `<div class="inter-reveal"><div class="found-list">${chips}</div></div>`;
  }
  return `<div class="inter-reveal"><span class="rv">${p.words[0]} / ${p.words[1]}</span></div>`;
}

function showInterstitial(result) {
  $("#skip-btn").hidden = true;
  const last = game.idx === game.cfg.rounds - 1;
  const head = result.solved
    ? `<div class="inter-mark good">Solved</div>`
    : result.points > 0
    ? `<div class="inter-mark ok">Time's up</div>`
    : `<div class="inter-mark bad">Time's up</div>`;
  const detail = result.type === "combos" && !result.solved
    ? `<div class="inter-sub">${result.found} / ${result.total} found</div>`
    : "";
  $("#puzzles").innerHTML = `
    <div class="interstitial">
      ${head}
      <div class="inter-points">+${result.points}</div>
      ${detail}
      ${revealAnswers(game.puzzles[game.idx])}
      <button id="next-btn" class="primary-btn">${last ? "See results" : "Next round →"}</button>
    </div>`;
  $("#next-btn").addEventListener("click", () => {
    if (last) finishGame();
    else showPuzzle(game.idx + 1);
  });
}

function finishGame() {
  const total = game.results.reduce((s, r) => s + r.points, 0);
  const result = {
    date: dateKey(), mode: game.mode, score: total,
    rows: game.results.map((r) => ({
      type: r.type, solved: r.solved, points: r.points, sec: r.sec,
      found: r.found, total: r.total,
    })),
    reveal: game.puzzles.map((p) =>
      p.type === "combos" ? `${p.frame}  =  ${p.answers.join(" ")}` : `${p.words[0]} / ${p.words[1]}`),
  };
  saveResult(game.mode, result);
  bumpStreak();
  // Best-effort leaderboard submission. Fire-and-forget so it can't slow the
  // results screen; the local save above is the source of truth.
  const user = window.WordSplitUser.getOrCreateUser();
  window.Leaderboard?.submitScore?.({
    userId: user.id, name: user.name,
    date: result.date, mode: result.mode, score: result.score,
  });
  renderResults(game.mode, result, false);
}

/* ===========================================================================
 * Rendering — puzzles
 * ========================================================================= */
function puzzleCard() {
  const card = document.createElement("div");
  card.className = "puzzle";
  return card;
}

// --- Combos -----------------------------------------------------------------
function renderCombo(p) {
  const card = puzzleCard();
  const frame = document.createElement("div");
  frame.className = "frame";
  frame.innerHTML = `<span>${p.pre}</span><span class="blank">__</span><span>${p.suf}</span>`;
  card.appendChild(frame);

  const row = document.createElement("div");
  row.className = "combo-row";
  const input = document.createElement("input");
  input.className = "combo-input";
  input.maxLength = 2; input.autocomplete = "off"; input.spellcheck = false;
  input.placeholder = "··";
  const btn = document.createElement("button");
  btn.className = "combo-submit"; btn.textContent = "Add";
  row.append(input, btn);
  card.appendChild(row);

  const progress = document.createElement("div");
  progress.className = "progress";
  card.appendChild(progress);
  const found = document.createElement("div");
  found.className = "found-list";
  card.appendChild(found);

  const refresh = () => {
    progress.textContent = `${p.found.length} / ${p.answers.length} found`;
    found.innerHTML = p.found.map((f) => `<span class="chip found">${f}</span>`).join("");
  };
  refresh();

  const submit = () => {
    const guess = input.value.trim().toLowerCase();
    input.value = "";
    if (guess.length !== 2 || !/^[a-z]{2}$/.test(guess)) return;
    if (p.found.includes(guess)) return;
    if (p.answers.includes(guess)) {
      p.found.push(guess);
      refresh();
      if (p.found.length === p.answers.length) { p.solved = true; endPuzzle(); }
    } else {
      penalize();
      card.classList.add("shake");
      setTimeout(() => card.classList.remove("shake"), 300);
    }
  };
  btn.addEventListener("click", submit);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
  return card;
}

// --- Forks ------------------------------------------------------------------
function renderFork(p) {
  const card = puzzleCard();
  const frame = document.createElement("div");
  frame.className = "frame";
  const cells = [];
  for (let i = 0; i < p.length; i++) {
    if (i === p.splitIndex) {
      const stack = document.createElement("span");
      stack.className = "stack";
      stack.innerHTML = `<span>${p.top}</span><span>${p.bottom}</span>`;
      frame.appendChild(stack);
    } else if (i === p.splitIndex + 1) {
      /* covered by the stack */
    } else {
      const cell = document.createElement("input");
      cell.className = "cell";
      cell.maxLength = 1; cell.autocomplete = "off"; cell.spellcheck = false;
      frame.appendChild(cell);
      cells.push(cell);
    }
  }
  card.appendChild(frame);

  const row = document.createElement("div");
  row.className = "combo-row";
  const btn = document.createElement("button");
  btn.className = "check-btn"; btn.textContent = "Check";
  row.appendChild(btn);
  card.appendChild(row);

  cells.forEach((cell, i) => {
    cell.addEventListener("input", () => {
      cell.value = cell.value.replace(/[^a-zA-Z]/g, "").toUpperCase();
      if (cell.value && i + 1 < cells.length) cells[i + 1].focus();
    });
    cell.addEventListener("keydown", (e) => {
      if (e.key === "Backspace" && !cell.value && i > 0) cells[i - 1].focus();
      if (e.key === "Enter") check();
    });
  });

  const check = () => {
    const guess = cells.map((c) => c.value.toUpperCase());
    if (guess.some((g) => !g)) return;
    if (guess.join("") === p.shared.join("")) {
      p.solved = true;
      cells.forEach((c) => (c.disabled = true));
      endPuzzle();
    } else {
      // Forks: wrong guesses are free and not shown — just clear and retry.
      card.classList.add("shake");
      setTimeout(() => card.classList.remove("shake"), 300);
      cells.forEach((c) => (c.value = ""));
      cells[0].focus();
    }
  };
  btn.addEventListener("click", check);
  return card;
}

/* ===========================================================================
 * Rendering — results + share
 * ========================================================================= */
const NUM = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣"];

// A red→yellow→green gradient bar filled to `frac` of its width. The gradient
// is anchored to the full track, so a low fill reads red, a full fill green.
function scoreBar(frac) {
  const pct = Math.max(0, Math.min(100, Math.round(frac * 100)));
  return `<div class="score-bar"><div class="score-bar-fill" style="left:${pct}%"></div></div>`;
}

function resultBar(r, full) {
  if (r.type === "combos") return scoreBar(r.points / full);
  return r.solved ? scoreBar(r.points / full) : `<span class="r-x">✕</span>`;
}

function renderResults(mode, result, replay) {
  const cfg = CONFIG[mode];
  $("#results-title").textContent = replay
    ? `Today's ${cfg.name} — already played`
    : "Done!";
  $("#final-score").textContent = result.score;

  $("#result-rows").innerHTML = result.rows
    .map((r, i) =>
      `<li><span class="r-num">${NUM[i]}</span>` +
      `<span class="r-bar">${resultBar(r, cfg.points)}</span>` +
      `<span class="r-pts">${r.points} pts</span></li>`)
    .join("");

  $("#reveal-block").innerHTML =
    `<div>Today's answers:</div>` +
    result.reveal.map((rv, i) => `<div>${i + 1}. <span class="rv">${rv}</span></div>`).join("");

  showView("results");
}

// Compact share text covering whichever modes the player has played today.
// Format:
//   Word Split — 2026-06-08
//   Combos: 1200/1500
//   Forks: 700/1000
function buildMenuShareText() {
  const lines = [`Word Split — ${dateKey()}`];
  for (const mode of ["combos", "forks"]) {
    const res = loadResult(mode);
    if (!res) continue;
    const max = CONFIG[mode].rounds * CONFIG[mode].points;
    lines.push(`${CONFIG[mode].name}: ${res.score}/${max}`);
  }
  return lines.join("\n");
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text; document.body.appendChild(ta);
    ta.select(); document.execCommand("copy"); document.body.removeChild(ta);
  }
}

/* ===========================================================================
 * Menu + wiring
 * ========================================================================= */
function refreshMenu() {
  $("#date-label").textContent = dateKey();
  const user = window.WordSplitUser.getOrCreateUser();
  $("#player-name").textContent = user.name;
  const streak = currentStreak();
  const streakEl = $("#streak");
  streakEl.textContent = streak >= 1 ? `🔥 ${streak} day${streak === 1 ? "" : "s"}` : "";
  streakEl.hidden = streak < 1;
  let anyPlayed = false;
  for (const mode of ["combos", "forks"]) {
    const res = loadResult(mode);
    const max = CONFIG[mode].rounds * CONFIG[mode].points;
    $(`#status-${mode}`).textContent = res ? `Played today · ${res.score} / ${max}` : "Not played today";
    if (res) anyPlayed = true;
  }
  $("#menu-share-btn").hidden = !anyPlayed;
  $("#menu-copied-toast").hidden = true;
}

function promptForName() {
  const cur = window.WordSplitUser.getOrCreateUser().name;
  const next = window.prompt("Pick a username (or leave blank to randomize):", cur);
  if (next === null) return;                                  // cancelled
  const name = next.trim() ? next : window.WordSplitUser.randomBirdName();
  window.WordSplitUser.setUserName(name);
  refreshMenu();
}

/* ===========================================================================
 * Leaderboard view
 *
 * Stacks four panels: Today's Combos, Today's Forks, Yesterday's Combos,
 * Yesterday's Forks. Reads are best-effort — Firestore failures (or no config
 * at all) just render an empty / message panel rather than throwing.
 * ========================================================================= */
const BOARD_DEFAULT_VISIBLE = 5;

function renderBoardPanel(title, rows, mode, myId) {
  if (!rows) {
    return `<div class="board-panel"><h3>${title}</h3><div class="board-empty">—</div></div>`;
  }
  if (!rows.length) {
    return `<div class="board-panel"><h3>${title}</h3><div class="board-empty">No scores yet.</div></div>`;
  }
  const max = CONFIG[mode].rounds * CONFIG[mode].points;
  const avg = Math.round(rows.reduce((s, r) => s + r.score, 0) / rows.length);
  const titleHTML = `${title} <span class="board-avg">avg ${avg}</span>`;
  // Show top N by default; rows past N render with a class that's hidden until
  // the user clicks "Show all". If your row is past the cutoff, auto-expand so
  // you can see your own placement without having to fish for it.
  const myRank = rows.findIndex((r) => r.userId === myId);
  const autoExpand = myRank >= BOARD_DEFAULT_VISIBLE;
  const lis = rows.map((r, i) => {
    const me = r.userId === myId ? " me" : "";
    const extra = i >= BOARD_DEFAULT_VISIBLE ? " board-row-extra" : "";
    const name = (r.name || "—").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
    return `<li class="board-row${me}${extra}">` +
           `<span class="board-rank">${i + 1}</span>` +
           `<span class="board-name">${name}</span>` +
           `<span class="board-score">${r.score} <span class="board-max">/ ${max}</span></span>` +
           `</li>`;
  }).join("");
  const extraCount = Math.max(0, rows.length - BOARD_DEFAULT_VISIBLE);
  const toggle = extraCount > 0
    ? `<button class="board-expand" data-total="${rows.length}">Show all (${rows.length}) ▼</button>`
    : "";
  const cls = autoExpand ? "board-panel expanded" : "board-panel";
  return `<div class="${cls}"><h3>${titleHTML}</h3><ol class="board-list">${lis}</ol>${toggle}</div>`;
}

// One delegated click handler for every expand button across all four panels.
function wireBoardExpand() {
  $("#board-content").addEventListener("click", (e) => {
    const btn = e.target.closest(".board-expand");
    if (!btn) return;
    const panel = btn.closest(".board-panel");
    const open = panel.classList.toggle("expanded");
    btn.textContent = open ? "Show less ▲" : `Show all (${btn.dataset.total}) ▼`;
  });
}

async function showLeaderboard() {
  showView("board");
  const root = $("#board-content");
  if (!window.Leaderboard || !window.Leaderboard.configured) {
    root.innerHTML = `
      <div class="board-empty board-empty-big">
        Leaderboard not yet configured.<br>
        <small>See README → Firebase setup.</small>
      </div>`;
    return;
  }
  root.innerHTML = `<div class="board-empty board-empty-big">Loading…</div>`;
  const myId = window.WordSplitUser.getOrCreateUser().id;
  const [today, yest] = await Promise.all([
    window.Leaderboard.fetchBoard(dateKeyOffset(0)),
    window.Leaderboard.fetchBoard(dateKeyOffset(1)),
  ]);
  root.innerHTML =
    renderBoardPanel("Today · Combos",     today?.combos, "combos", myId) +
    renderBoardPanel("Today · Forks",      today?.forks,  "forks",  myId) +
    renderBoardPanel("Yesterday · Combos", yest?.combos,  "combos", myId) +
    renderBoardPanel("Yesterday · Forks",  yest?.forks,   "forks",  myId);
}

function stopGame() {
  if (game && game.tickId) clearInterval(game.tickId);
}

function init() {
  // Make sure a user identity exists before any view renders.
  window.WordSplitUser.getOrCreateUser();

  refreshMenu();
  document.querySelectorAll(".mode-card").forEach((card) =>
    card.addEventListener("click", () => startGame(card.dataset.mode)));
  $("#home-btn").addEventListener("click", () => { stopGame(); refreshMenu(); showView("menu"); });
  $("#results-menu-btn").addEventListener("click", () => { refreshMenu(); showView("menu"); });
  $("#board-menu-btn").addEventListener("click", () => { refreshMenu(); showView("menu"); });
  $("#skip-btn").addEventListener("click", () => { if (game) endPuzzle(); });
  $("#name-btn").addEventListener("click", promptForName);
  $("#menu-board-btn").addEventListener("click", showLeaderboard);
  wireBoardExpand();
  $("#menu-share-btn").addEventListener("click", async () => {
    await copyToClipboard(buildMenuShareText());
    const t = $("#menu-copied-toast");
    t.hidden = false;
    setTimeout(() => (t.hidden = true), 2000);
  });
  showView("menu");
}

document.addEventListener("DOMContentLoaded", init);
