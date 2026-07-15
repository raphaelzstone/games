"use strict";

/* ===========================================================================
 * Combos — a daily word puzzle (vanilla JS), split out of the old Word Split.
 *
 * Given a 5-8 letter frame with two adjacent blanks (e.g. hear__), find every
 * word that fits (hearer, hearse, hearth, hearts, hearty). Every real word
 * that fits is a target (3-8 of them) -- no "bonus" words. 3 rounds, 500
 * points each (1500 max). Each round is a 1:30 clock, time-adjusted: the
 * clock costs up to 100 points (0 in the first 0:15, full by 1:15), then the
 * remaining value is scaled by the share of fills found. A wrong guess costs
 * 2 seconds. After each round its answers are revealed on the interstitial.
 *
 * Puzzles are date-seeded picks from a pre-verified pool (puzzles.js), so
 * everyone gets the same fresh set each day. Results persist per day and copy
 * as a spoiler-free summary (points only -- never the words).
 * ========================================================================= */

const WRONG_PENALTY_SEC = 2;     // a wrong guess costs this much time

const ROUND_LIMIT_SEC = 90;      // 1:30 round
const ROUND_FREE_SEC = 15;       // no time penalty within the first 0:15
const ROUND_PENALTY_SEC = 75;    // full time penalty by here (last 0:15), i.e. -100
const ROUND_TIME_PENALTY = 100;  // most points the clock can cost (over the middle minute)
const ROUNDS = 3;
const ROUND_POINTS = 500;
const MAX_SCORE = ROUNDS * ROUND_POINTS;   // 1500

// --- Scoring ----------------------------------------------------------------
// Time-adjusted completion. The clock costs up to 100 points, ramping from 0
// at 0:15 to 100 over the middle minute (to 1:15), then flat. Whatever the
// round is worth after that is scaled by the share of fills found. So all
// fills in the first 0:15 -> 500; all in the last 0:15 -> 400; 3 of 4 in the
// last 0:15 -> 400 * 3/4 = 300.
function timePenalty(sec) {
  if (sec <= ROUND_FREE_SEC) return 0;
  if (sec >= ROUND_PENALTY_SEC) return ROUND_TIME_PENALTY;
  return ROUND_TIME_PENALTY * (sec - ROUND_FREE_SEC) / (ROUND_PENALTY_SEC - ROUND_FREE_SEC);
}
function comboScore(found, total, sec) {
  return Math.round((ROUND_POINTS - timePenalty(sec)) * (found / total));
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
const storageKey = () => `combos:${dateKey()}`;
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
const STREAK_KEY = "combos:streak";
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
// Seeded pick of N frames, guaranteeing at least one has 4+ fills so a day is
// never all trivial 3-fill frames.
function pickCombos(pool, seedStr, n) {
  const order = seededPick(pool, pool.length, seedStr);
  const picks = order.slice(0, n);
  if (picks.every((p) => p.answers.length === 3)) {
    const alt = order.slice(n).find((p) => p.answers.length >= 4);
    if (alt) picks[picks.length - 1] = alt;
  }
  return picks;
}

function buildPuzzles() {
  return pickCombos(COMBOS_POOL, `combos:${dateKey()}`, ROUNDS).map((p) => {
    const [pre, suf] = p.frame.split("__");
    return {
      frame: p.frame, pre, suf,
      answers: p.answers.map((a) => a.toLowerCase()),
      found: [], solved: false,
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
  root.appendChild(renderCombo(p));

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
  const found = p.found.length, total = p.answers.length;
  const solved = found === total;
  const result = { solved, found, total, sec, points: comboScore(found, total, sec) };
  game.results.push(result);
  showInterstitial(result);
}

// The day's answers for this puzzle, shown on its interstitial: each full
// word (green if you found it, red if missed).
function revealAnswers(p) {
  const chips = p.answers
    .map((a) => `<span class="chip ${p.found.includes(a) ? "found" : "missed"}">${p.pre}${a}${p.suf}</span>`)
    .join("");
  return `<div class="inter-reveal"><div class="found-list">${chips}</div></div>`;
}

function showInterstitial(result) {
  $("#skip-btn").hidden = true;
  const last = game.idx === ROUNDS - 1;
  const head = result.solved
    ? `<div class="inter-mark good">Solved</div>`
    : result.points > 0
    ? `<div class="inter-mark ok">Time's up</div>`
    : `<div class="inter-mark bad">Time's up</div>`;
  const detail = !result.solved
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
    date: dateKey(), score: total,
    rows: game.results.map((r) => ({ solved: r.solved, points: r.points, sec: r.sec, found: r.found, total: r.total })),
    reveal: game.puzzles.map((p) => `${p.frame}  =  ${p.answers.join(" ")}`),
  };
  saveResult(result);
  bumpStreak();
  // Best-effort leaderboard submission. Fire-and-forget so it can't slow the
  // results screen; the local save above is the source of truth.
  const user = window.CombosUser.getOrCreateUser();
  window.Leaderboard?.submitScore?.({
    userId: user.id, name: user.name, date: result.date, score: result.score,
  });
  renderResults(result, false);
}

/* ===========================================================================
 * Rendering — puzzle
 * ========================================================================= */
function renderCombo(p) {
  const card = document.createElement("div");
  card.className = "puzzle";

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

/* ===========================================================================
 * Rendering — results + share
 * ========================================================================= */
const NUM = ["1️⃣", "2️⃣", "3️⃣"];

// A red→yellow→green gradient bar filled to `frac` of its width. The gradient
// is anchored to the full track, so a low fill reads red, a full fill green.
function scoreBar(frac) {
  const pct = Math.max(0, Math.min(100, Math.round(frac * 100)));
  return `<div class="score-bar"><div class="score-bar-fill" style="left:${pct}%"></div></div>`;
}

function renderResults(result, replay) {
  $("#results-title").textContent = replay ? "Today's Combos — already played" : "Done!";
  $("#final-score").textContent = result.score;

  $("#result-rows").innerHTML = result.rows
    .map((r, i) =>
      `<li><span class="r-num">${NUM[i]}</span>` +
      `<span class="r-bar">${scoreBar(r.points / ROUND_POINTS)}</span>` +
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
  if (!res) return `Combos — ${dateKey()}`;
  return `Combos — ${res.date}\n${res.score}/${MAX_SCORE}`;
}

/* ===========================================================================
 * Menu + wiring
 * ========================================================================= */
function refreshMenu() {
  $("#date-label").textContent = dateKey();
  const user = window.CombosUser.getOrCreateUser();
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
  const cur = window.CombosUser.getOrCreateUser().name;
  const next = window.prompt("Pick a username (or leave blank to randomize):", cur);
  if (next === null) return;                                  // cancelled
  const name = next.trim() ? next : window.CombosUser.randomBirdName();
  window.CombosUser.setUserName(name);
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
  // Show top N by default; rows past N render with a class that's hidden until
  // the user clicks "Show all". If your row is past the cutoff, auto-expand so
  // you can see your own placement without having to fish for it.
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
  const myId = window.CombosUser.getOrCreateUser().id;
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
  window.CombosUser.getOrCreateUser();

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
