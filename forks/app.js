"use strict";

/* ===========================================================================
 * Forks — a daily word puzzle (vanilla JS), split out of the old Word Split.
 *
 * Given a split (two letters on top, two on bottom), type the shared
 * surrounding letters so both stacked letters form a real word. Every puzzle
 * has exactly one solution, verified against the full dictionary. (Renamed
 * from "Split Decisions" to avoid the trademark.) 2 rounds, 500 points each
 * (1000 max). Fully time-based over a 2:00 round: the first 0:15 are free
 * (500), points then slide down over the next 1:30 to a floor of 200, where
 * they stay for the final 0:15. Miss it -> 0. Wrong guesses are free. After
 * each round its answer is revealed on the interstitial.
 *
 * Puzzles are date-seeded picks from a pre-verified pool (puzzles.js), so
 * everyone gets the same fresh set each day. Results persist per day and copy
 * as a spoiler-free summary (points only -- never the words).
 * ========================================================================= */

const ROUND_LIMIT_SEC = 120;     // 2:00 round, fully time-scored
const ROUND_FREE_SEC = 15;       // full points within the first 0:15
const ROUND_FLOOR_SEC = 105;     // 200-pt floor reached here (last 0:15 flat)
const ROUND_POINTS = 500;
const ROUND_FLOOR_POINTS = 200;  // never drops below this once solved
const ROUNDS = 2;
const MAX_SCORE = ROUNDS * ROUND_POINTS;   // 1000

// --- Scoring ----------------------------------------------------------------
// Solved within 0:15 -> full; slide to the 200 floor by 1:45; flat after.
function forkScore(solved, sec) {
  if (!solved) return 0;
  if (sec <= ROUND_FREE_SEC) return ROUND_POINTS;
  if (sec >= ROUND_FLOOR_SEC) return ROUND_FLOOR_POINTS;
  return Math.round(
    ROUND_POINTS - (ROUND_POINTS - ROUND_FLOOR_POINTS) * (sec - ROUND_FREE_SEC) / (ROUND_FLOOR_SEC - ROUND_FREE_SEC));
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
  $("#hub-btn").hidden = name !== "menu";   // "All games" only on the menu
}

// --- Storage ----------------------------------------------------------------
const storageKey = () => `forks:${dateKey()}`;
function loadResult() {
  try {
    const r = JSON.parse(localStorage.getItem(storageKey()) || "null");
    if (!r) return null;
    if (!Array.isArray(r.rows) || r.rows.length !== ROUNDS) {
      localStorage.removeItem(storageKey());
      return null;
    }
    return r;
  } catch { return null; }
}
function saveResult(result) {
  try { localStorage.setItem(storageKey(), JSON.stringify(result)); }
  catch { /* storage unavailable — game still works */ }
}

// --- Streak -------------------------------------------------------------
const STREAK_KEY = "forks:streak";
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
function buildPuzzles() {
  const picks = seededPick(FORKS_POOL, ROUNDS, `forks:${dateKey()}`);
  return picks.map((p) => {
    const i = p.splitIndex;
    const w1 = p.word1.toUpperCase(), w2 = p.word2.toUpperCase();
    return {
      length: w1.length, splitIndex: i,
      top: w1.slice(i, i + 2), bottom: w2.slice(i, i + 2),
      shared: (w1.slice(0, i) + w1.slice(i + 2)).split(""),
      words: [w1, w2], solved: false,
    };
  });
}

/* ===========================================================================
 * Game state + per-puzzle loop
 * ========================================================================= */
let game = null;

function startGame() {
  const existing = loadResult();
  if (existing) { renderResults(existing, /*replay*/ true); return; }

  game = { puzzles: buildPuzzles(), idx: 0, results: [], puzzleStart: 0, penaltyMs: 0, tickId: null };
  showView("game");
  showPuzzle(0);
}

function showPuzzle(i) {
  game.idx = i;
  game.penaltyMs = 0;
  const p = game.puzzles[i];
  $("#progress-pill").textContent = `Round ${i + 1} of ${ROUNDS}`;
  $("#skip-btn").hidden = false;

  const root = $("#puzzles");
  root.innerHTML = "";
  root.appendChild(renderFork(p));

  game.puzzleStart = performance.now();
  updateCountdown();
  game.tickId = setInterval(tick, 200);

  const first = root.querySelector("input:not([disabled])");
  if (first) first.focus();
}

function elapsedMs() { return performance.now() - game.puzzleStart + game.penaltyMs; }
function remainingMs() { return ROUND_LIMIT_SEC * 1000 - elapsedMs(); }
function elapsedSec() { return Math.min(ROUND_LIMIT_SEC, elapsedMs() / 1000); }

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

// Called on solve, time-out, or skip. Scores the current puzzle and advances.
// Guarded against double-fire so a near-simultaneous (solve + tick timeout +
// skip) can't ever push two results for the same round.
function endPuzzle() {
  if (!game.tickId) return;
  clearInterval(game.tickId);
  game.tickId = null;
  const p = game.puzzles[game.idx];
  const sec = elapsedSec();
  const result = { solved: p.solved, sec, points: forkScore(p.solved, sec) };
  game.results.push(result);
  showInterstitial(result);
}

function revealAnswers(p) {
  return `<div class="inter-reveal"><span class="rv">${p.words[0]} / ${p.words[1]}</span></div>`;
}

function showInterstitial(result) {
  $("#skip-btn").hidden = true;
  const last = game.idx === ROUNDS - 1;
  const head = result.solved
    ? `<div class="inter-mark good">Solved</div>`
    : result.points > 0
    ? `<div class="inter-mark ok">Time's up</div>`
    : `<div class="inter-mark bad">Time's up</div>`;
  $("#puzzles").innerHTML = `
    <div class="interstitial">
      ${head}
      <div class="inter-points">+${result.points}</div>
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
    date: dateKey(), score: total,
    rows: game.results.map((r) => ({ solved: r.solved, points: r.points, sec: r.sec })),
    reveal: game.puzzles.map((p) => `${p.words[0]} / ${p.words[1]}`),
  };
  saveResult(result);
  bumpStreak();
  // Best-effort leaderboard submission. Fire-and-forget so it can't slow the
  // results screen; the local save above is the source of truth.
  const user = window.ForksUser.getOrCreateUser();
  window.Leaderboard?.submitScore?.({
    userId: user.id, name: user.name, date: result.date, score: result.score,
  });
  renderResults(result, false);
}

/* ===========================================================================
 * Rendering — puzzle
 * ========================================================================= */
function renderFork(p) {
  const card = document.createElement("div");
  card.className = "puzzle";

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
      // Wrong guesses are free and not shown — just clear and retry.
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
const NUM = ["1️⃣", "2️⃣"];

function scoreBar(frac) {
  const pct = Math.max(0, Math.min(100, Math.round(frac * 100)));
  return `<div class="score-bar"><div class="score-bar-fill" style="left:${pct}%"></div></div>`;
}

function renderResults(result, replay) {
  $("#results-title").textContent = replay ? "Today's Forks — already played" : "Done!";
  $("#final-score").textContent = result.score;

  $("#result-rows").innerHTML = result.rows
    .map((r, i) =>
      `<li><span class="r-num">${NUM[i]}</span>` +
      `<span class="r-bar">${r.solved ? scoreBar(r.points / ROUND_POINTS) : `<span class="r-x">✕</span>`}</span>` +
      `<span class="r-pts">${r.points} pts</span></li>`)
    .join("");

  $("#reveal-block").innerHTML =
    `<div>Today's answers:</div>` +
    result.reveal.map((rv, i) => `<div>${i + 1}. <span class="rv">${rv}</span></div>`).join("");

  showView("results");
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

function buildShareText() {
  const res = loadResult();
  if (!res) return `Forks — ${dateKey()}`;
  return `Forks — ${res.date}\n${res.score}/${MAX_SCORE}`;
}

/* ===========================================================================
 * Menu + wiring
 * ========================================================================= */
function refreshMenu() {
  $("#date-label").textContent = dateKey();
  const user = window.ForksUser.getOrCreateUser();
  $("#player-name").textContent = user.name;
  const streak = currentStreak();
  const streakEl = $("#streak");
  streakEl.textContent = streak >= 1 ? `🔥 ${streak} day${streak === 1 ? "" : "s"}` : "";
  streakEl.hidden = streak < 1;
  const res = loadResult();
  $("#status-daily").textContent = res ? `Played today · ${res.score} / ${MAX_SCORE}` : "Not played today";
  $("#menu-share-btn").hidden = !res;
  $("#menu-copied-toast").hidden = true;
}

function promptForName() {
  const cur = window.ForksUser.getOrCreateUser().name;
  const next = window.prompt("Pick a username (or leave blank to randomize):", cur);
  if (next === null) return;                                  // cancelled
  const name = next.trim() ? next : window.ForksUser.randomBirdName();
  window.ForksUser.setUserName(name);
  refreshMenu();
}

/* ===========================================================================
 * Leaderboard view — Today and Yesterday panels. Reads are best-effort;
 * Firestore failures (or no config at all) just render an empty / message
 * panel rather than throwing.
 * ========================================================================= */
const BOARD_DEFAULT_VISIBLE = 5;

function renderBoardPanel(title, rows, myId) {
  if (!rows) {
    return `<div class="board-panel"><h3>${title}</h3><div class="board-empty">—</div></div>`;
  }
  if (!rows.length) {
    return `<div class="board-panel"><h3>${title}</h3><div class="board-empty">No scores yet.</div></div>`;
  }
  const sorted = [...rows].sort((a, b) => b.score - a.score);
  const avg = Math.round(sorted.reduce((s, r) => s + r.score, 0) / sorted.length);
  const titleHTML = `${title} <span class="board-avg">avg ${avg}</span>`;
  const myRank = sorted.findIndex((r) => r.userId === myId);
  const autoExpand = myRank >= BOARD_DEFAULT_VISIBLE;
  const lis = sorted.map((r, i) => {
    const me = r.userId === myId ? " me" : "";
    const extra = i >= BOARD_DEFAULT_VISIBLE ? " board-row-extra" : "";
    const name = (r.name || "—").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
    return `<li class="board-row${me}${extra}">` +
           `<span class="board-rank">${i + 1}</span>` +
           `<span class="board-name">${name}</span>` +
           `<span class="board-score">${r.score} <span class="board-max">/ ${MAX_SCORE}</span></span>` +
           `</li>`;
  }).join("");
  const extraCount = Math.max(0, sorted.length - BOARD_DEFAULT_VISIBLE);
  const toggle = extraCount > 0
    ? `<button class="board-expand" data-total="${sorted.length}">Show all (${sorted.length}) ▼</button>`
    : "";
  const cls = autoExpand ? "board-panel expanded" : "board-panel";
  return `<div class="${cls}"><h3>${titleHTML}</h3><ol class="board-list">${lis}</ol>${toggle}</div>`;
}

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
  const myId = window.ForksUser.getOrCreateUser().id;
  const [today, yest] = await Promise.all([
    window.Leaderboard.fetchBoard(dateKeyOffset(0)),
    window.Leaderboard.fetchBoard(dateKeyOffset(1)),
  ]);
  root.innerHTML =
    renderBoardPanel("Today", today, myId) +
    renderBoardPanel("Yesterday", yest, myId);
}

function stopGame() {
  if (game && game.tickId) clearInterval(game.tickId);
}

function init() {
  window.ForksUser.getOrCreateUser();

  refreshMenu();
  $("#play-card").addEventListener("click", startGame);
  $("#home-btn").addEventListener("click", () => { stopGame(); refreshMenu(); showView("menu"); });
  $("#results-menu-btn").addEventListener("click", () => { refreshMenu(); showView("menu"); });
  $("#board-menu-btn").addEventListener("click", () => { refreshMenu(); showView("menu"); });
  $("#skip-btn").addEventListener("click", () => { if (game) endPuzzle(); });
  $("#name-btn").addEventListener("click", promptForName);
  $("#menu-board-btn").addEventListener("click", showLeaderboard);
  wireBoardExpand();
  $("#menu-share-btn").addEventListener("click", async () => {
    await copyToClipboard(buildShareText());
    const t = $("#menu-copied-toast");
    t.hidden = false;
    setTimeout(() => (t.hidden = true), 2000);
  });
  showView("menu");
}

document.addEventListener("DOMContentLoaded", init);
