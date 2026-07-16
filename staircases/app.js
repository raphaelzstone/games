"use strict";

/* ===========================================================================
 * Staircases — a daily word puzzle (vanilla JS).
 *
 * Three puzzles a day, the same for everyone. Each puzzle hides one 3-letter
 * string that staircases through four 6-letter words: in row r (0..3) the
 * trigram occupies columns r..r+2, the other three cells are shown. Find the
 * single 3-letter string that completes all four rows.
 *
 * Each puzzle is a 1:30 countdown worth up to 500 points (Word Split's Combos
 * scoring): full value in the first 0:15, sliding down to a 300-point floor by
 * 1:15, flat for the last 0:15. Run out the clock without solving it and that
 * puzzle scores 0 — the round ends and the answer is revealed automatically.
 * Three rounds, 1500 points max, higher is better. Results persist per day and
 * copy as a spoiler-free summary.
 * ========================================================================= */

const ROUNDS = 3;
const ROUND_LIMIT_SEC = 90;     // 1:30 per puzzle
const ROUND_FREE_SEC = 15;      // full value if solved within the first 0:15
const ROUND_FLOOR_SEC = 75;     // floor reached here (1:15) — flat for the last 0:15
const ROUND_FULL_POINTS = 500;
const ROUND_FLOOR_POINTS = 300;
const MAX_SCORE = ROUNDS * ROUND_FULL_POINTS;   // 1500

// Points for a round solved at `sec` into its countdown; 0 if not solved
// (timed out). Mirrors Word Split's Combos time-value curve, just with a
// 300 (not 400) floor and no found/total fraction — Staircases rounds are an
// all-or-nothing single guess, not partial fills.
function roundScore(solved, sec) {
  if (!solved) return 0;
  if (sec <= ROUND_FREE_SEC) return ROUND_FULL_POINTS;
  if (sec >= ROUND_FLOOR_SEC) return ROUND_FLOOR_POINTS;
  return Math.round(
    ROUND_FULL_POINTS - (ROUND_FULL_POINTS - ROUND_FLOOR_POINTS) *
    (sec - ROUND_FREE_SEC) / (ROUND_FLOOR_SEC - ROUND_FREE_SEC));
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
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// A stable ordering of the pool, stepped ROUNDS puzzles per day so each day
// gets a distinct trio and every puzzle is used before any repeats. The pool
// ships up to a few puzzles per answer trigram (for word variety), so a plain
// shuffle can land two of them on the same day or on back-to-back days —
// instead, group by answer and round-robin across the (shuffled) groups: that
// guarantees a day's ROUNDS puzzles never share an answer, and repeats of the
// same answer land as far apart as the group count allows.
function dailyPuzzles() {
  const pool = STAIRCASES_PUZZLES;
  const rng = mulberry32(hashString("staircases"));

  const groups = new Map();
  pool.forEach((p, i) => {
    if (!groups.has(p.a)) groups.set(p.a, []);
    groups.get(p.a).push(i);
  });
  const groupList = [...groups.values()];
  for (const g of groupList) {
    for (let i = g.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [g[i], g[j]] = [g[j], g[i]];
    }
  }
  for (let i = groupList.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [groupList[i], groupList[j]] = [groupList[j], groupList[i]];
  }
  const idx = [];
  for (let col = 0; ; col++) {
    let any = false;
    for (const g of groupList) {
      if (col < g.length) { idx.push(g[col]); any = true; }
    }
    if (!any) break;
  }
  // Local calendar day number, matching dateKey()'s local-date storage keys —
  // NOT a UTC epoch diff, which would drift a day off from dateKey() for any
  // reader not on UTC and hand out yesterday's set for hours after local midnight.
  const now = new Date();
  const localMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const epoch = new Date(2026, 0, 1);
  const day = Math.floor((localMidnight - epoch) / 86400000);
  const out = [];
  for (let k = 0; k < ROUNDS; k++) {
    const pos = (((day * ROUNDS + k) % idx.length) + idx.length) % idx.length;
    out.push(pool[idx[pos]]);
  }
  return out;
}

function dateKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function dateKeyOffset(days) {
  const d = new Date(); d.setDate(d.getDate() - days); return dateKey(d);
}
function fmtElapsed(sec) {
  const s = Math.max(0, Math.round(sec));
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
  $("#hub-btn").hidden = name !== "menu";
}

// --- Storage ----------------------------------------------------------------
const resultKey = () => `staircases:${dateKey()}`;
const progressKey = () => `staircases:progress:${dateKey()}`;
function loadJSON(key) {
  try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; }
}
function saveJSON(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}
const loadResult = () => loadJSON(resultKey());
const saveResult = (r) => saveJSON(resultKey(), r);
const loadProgress = () => loadJSON(progressKey());
const saveProgress = (p) => saveJSON(progressKey(), p);
const clearProgress = () => { try { localStorage.removeItem(progressKey()); } catch {} };

// --- Streak (finishing the day extends it) ----------------------------------
const STREAK_KEY = "staircases:streak";
function currentStreak() {
  const s = loadJSON(STREAK_KEY);
  if (!s || !s.lastDate) return 0;
  if (s.lastDate === dateKey() || s.lastDate === dateKeyOffset(1)) return s.count;
  return 0;
}
function bumpStreak() {
  const today = dateKey(), yest = dateKeyOffset(1);
  const s = loadJSON(STREAK_KEY) || { count: 0, longest: 0, lastDate: null };
  if (s.lastDate === today) return;
  s.count = s.lastDate === yest ? s.count + 1 : 1;
  s.longest = Math.max(s.longest || 0, s.count);
  s.lastDate = today;
  saveJSON(STREAK_KEY, s);
}

/* ===========================================================================
 * Game state
 * ========================================================================= */
let game = null;

function blanksFor(round) {         // columns the trigram occupies in this row
  return [round, round + 1, round + 2];
}

function startGame() {
  const existing = loadResult();
  if (existing) { renderResults(existing, /*replay*/ true); return; }

  const puzzles = dailyPuzzles();
  const saved = loadProgress();
  game = {
    puzzles,
    round: 0,
    scores: new Array(ROUNDS).fill(null),   // points earned per round, null = not yet done
    done: new Array(ROUNDS).fill(null),     // 'solved' | 'timeout' | null
    startMs: performance.now(),             // start of the CURRENT round
    elapsedBefore: 0,                       // resumed elapsed-in-round, if any
    tickId: null,
    lastPersist: 0,
  };
  if (saved && Array.isArray(saved.done) && saved.done.length === ROUNDS) {
    game.done = saved.done;
    game.scores = Array.isArray(saved.scores) && saved.scores.length === ROUNDS
      ? saved.scores : game.scores;
    game.round = Math.min(saved.round || 0, ROUNDS - 1);
    // Skip forward over any already-finished rounds (defensive; shouldn't
    // normally happen since finishing a round always advances immediately).
    while (game.round < ROUNDS && game.done[game.round]) game.round++;
    if (game.round >= ROUNDS) { finishGame(); return; }
    // Resuming mid-round: clamp so a very stale save can't show negative time
    // — instead the first timer tick immediately times the round out, which
    // is the correct behaviour for a real countdown you walked away from.
    game.elapsedBefore = Math.min(saved.elapsed || 0, ROUND_LIMIT_SEC);
  }
  showView("game");
  game.tickId = setInterval(updateTimer, 250);
  renderRound();
  updateTimer();
}

function roundElapsedSec() {
  return game.elapsedBefore + (performance.now() - game.startMs) / 1000;
}
function updateTimer() {
  if (game.done[game.round]) return;   // frozen on the reveal until Next is clicked
  const remaining = Math.max(0, ROUND_LIMIT_SEC - roundElapsedSec());
  const timerEl = $("#timer");
  timerEl.textContent = fmtElapsed(remaining);
  timerEl.classList.toggle("urgent", remaining > 0 && remaining <= 15);
  if (remaining <= 0) { onTimeout(); return; }
  if (performance.now() - game.lastPersist > 4000) persist();
}
function persist() {
  if (!game) return;
  game.lastPersist = performance.now();
  saveProgress({ round: game.round, scores: game.scores, done: game.done, elapsed: roundElapsedSec() });
}

// Render the current puzzle's grid + reset the guess box + restart the round
// clock (unless we're resuming, in which case elapsedBefore is already set).
function renderRound() {
  const p = game.puzzles[game.round];
  $("#progress-pill").textContent = `Puzzle ${game.round + 1} of ${ROUNDS}`;
  const msg = $("#guess-msg"); msg.textContent = " "; msg.className = "guess-msg";
  const input = $("#guess-input"); input.value = ""; input.disabled = false;
  $("#skip-btn").hidden = false;
  $("#next-btn").hidden = true;
  $("#timer").classList.remove("urgent");

  buildGrid(p, "");
  // Focus to summon the mobile keyboard (best-effort).
  setTimeout(() => { try { input.focus(); } catch {} }, 30);
}

// Build the 4x6 grid. `typed` (0-3 letters) previews into the blank cells.
function buildGrid(puzzle, typed) {
  const grid = $("#grid");
  grid.innerHTML = "";
  for (let r = 0; r < 4; r++) {
    const word = puzzle.w[r];
    const blanks = blanksFor(r);
    for (let c = 0; c < 6; c++) {
      const cell = document.createElement("div");
      cell.className = "gcell";
      const bi = blanks.indexOf(c);
      if (bi === -1) {
        cell.textContent = word[c].toUpperCase();     // shown letter
      } else {
        cell.classList.add("blank");
        const ch = typed[bi];
        if (ch) { cell.textContent = ch.toUpperCase(); cell.classList.add("filled"); }
      }
      grid.appendChild(cell);
    }
  }
}

function onInput() {
  const raw = $("#guess-input").value.replace(/[^a-zA-Z]/g, "").slice(0, 3);
  $("#guess-input").value = raw.toUpperCase();
  buildGrid(game.puzzles[game.round], raw.toLowerCase());
}

function submitGuess(e) {
  if (e) e.preventDefault();
  if (!game || game.done[game.round]) return;
  const guess = $("#guess-input").value.replace(/[^a-zA-Z]/g, "").toLowerCase();
  if (guess.length < 3) { flashMsg("Type all three letters", "warn"); return; }
  if (guess === game.puzzles[game.round].a) {
    finishRound("solved");
  } else {
    flashMsg("Not quite — try again", "warn");
    const input = $("#guess-input");
    input.classList.remove("shake"); void input.offsetWidth; input.classList.add("shake");
  }
}

// The countdown reached 0 before a correct guess: the round scores 0 and the
// answer is revealed automatically.
function onTimeout() {
  finishRound("timeout");
}

// Manual give-up on the current round, same as Word Split's "Skip puzzle":
// ends it early for 0 points and reveals the answer, same as timing out.
function onSkip() {
  if (!game || game.done[game.round]) return;
  finishRound("timeout", /*skipped*/ true);
}

// Fill in the answer, score the round, and show it — advancing only happens
// when the player clicks Next (same show-answer-then-click-next pattern as
// Word Split's interstitial), not on an auto-advancing timer.
function finishRound(how, skipped) {
  const sec = roundElapsedSec();
  const points = roundScore(how === "solved", sec);
  game.done[game.round] = how;
  game.scores[game.round] = points;

  const p = game.puzzles[game.round];
  buildGrid(p, p.a);                        // fill blanks with the answer
  $("#grid").querySelectorAll(".blank").forEach((el) => el.classList.add(how));
  $("#guess-input").value = p.a.toUpperCase();
  $("#guess-input").disabled = true;
  $("#skip-btn").hidden = true;
  const msg = how === "solved" ? `Solved! +${points}`
    : skipped ? `Skipped — it was ${p.a.toUpperCase()}`
    : `Time's up — it was ${p.a.toUpperCase()}`;
  flashMsg(msg, how === "solved" ? "good" : "reveal");
  persist();
  const nextBtn = $("#next-btn");
  nextBtn.textContent = game.round >= ROUNDS - 1 ? "See results →" : "Next puzzle →";
  nextBtn.hidden = false;
}

function advanceRound() {
  if (!game || !game.done[game.round]) return;
  $("#next-btn").hidden = true;
  game.round++;
  game.startMs = performance.now();
  game.elapsedBefore = 0;
  if (game.round >= ROUNDS) finishGame();
  else renderRound();
}

function flashMsg(text, cls) {
  const m = $("#guess-msg");
  m.textContent = text;
  m.className = "guess-msg " + (cls || "");
}

function finishGame() {
  if (game.tickId) { clearInterval(game.tickId); game.tickId = null; }
  const score = game.scores.reduce((a, b) => a + (b || 0), 0);
  const solved = game.done.filter((d) => d === "solved").length;
  const result = {
    date: dateKey(), score, total: MAX_SCORE, solved, rounds: ROUNDS,
    answers: game.puzzles.map((p) => p.a), done: game.done.slice(), scores: game.scores.slice(),
  };
  saveResult(result);
  clearProgress();
  bumpStreak();
  const user = window.StaircasesUser.getOrCreateUser();
  window.Leaderboard?.submitScore?.({
    userId: user.id, name: user.name, date: result.date, score: result.score,
  });
  renderResults(result, false);
}

function stopGame() {
  persist();
  if (game && game.tickId) { clearInterval(game.tickId); game.tickId = null; }
}

/* ===========================================================================
 * Results + share
 * ========================================================================= */
function renderResults(result, replay) {
  $("#results-title").textContent = replay ? "Already played today" : "Nice climb!";
  $("#final-time").textContent = result.score;
  $("#final-label").textContent = `points · ${result.solved}/${result.rounds} solved`;
  // Per-puzzle recap (spoiler: shows the answers, but you've finished).
  const rows = (result.answers || []).map((a, i) => {
    const how = (result.done || [])[i];
    const pts = (result.scores || [])[i] || 0;
    const tag = how === "solved" ? `+${pts}` : "0 (timed out)";
    return `<li class="result-row"><span class="r-word">${a.toUpperCase()}</span>` +
           `<span class="r-tag ${how}">${tag}</span></li>`;
  }).join("");
  $("#result-rows").innerHTML = rows;
  showView("results");
}

function buildShareText() {
  const res = loadResult();
  if (!res) return `Staircases — ${dateKey()}`;
  const streak = currentStreak();
  const tail = streak >= 2 ? `  🔥 ${streak}` : "";
  const marks = (res.done || []).map((d) => (d === "solved" ? "🟩" : "⬜")).join("");
  return `Staircases — ${res.date}\n${marks}  ${res.score}/${res.total}${tail}`;
}

async function copyToClipboard(text) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = document.createElement("textarea");
    ta.value = text; document.body.appendChild(ta);
    ta.select(); document.execCommand("copy"); document.body.removeChild(ta);
  }
}
function flashToast(id) {
  const t = $(id); t.hidden = false; setTimeout(() => (t.hidden = true), 2000);
}

/* ===========================================================================
 * Menu + leaderboard
 * ========================================================================= */
function escapeHtml(s) {
  return String(s).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
}
function refreshMenu() {
  $("#date-label").textContent = dateKey();
  const user = window.StaircasesUser.getOrCreateUser();
  $("#player-name").textContent = user.name;

  const res = loadResult();
  const prog = loadProgress();
  $("#status-daily").textContent = res
    ? `Played today · ${res.score}/${res.total} · ${res.solved}/${res.rounds} solved`
    : (prog ? "In progress…" : "Not played today");
  $("#menu-share-btn").hidden = !res;
  $("#menu-art").innerHTML = miniStaircase();
}

// One leaderboard panel: players ranked by highest score.
function renderBoardPanel(title, rows, myId) {
  if (!rows) return `<div class="board-panel"><h3>${title}</h3><div class="board-empty">—</div></div>`;
  if (!rows.length) return `<div class="board-panel"><h3>${title}</h3><div class="board-empty">No scores yet.</div></div>`;
  const sorted = [...rows].sort((a, b) => b.score - a.score);
  const lis = sorted.map((r, i) => {
    const me = r.userId === myId ? " me" : "";
    return `<li class="board-row${me}">` +
           `<span class="board-rank">${i + 1}</span>` +
           `<span class="board-name">${escapeHtml(r.name || "—")}</span>` +
           `<span class="board-score">${r.score}</span></li>`;
  }).join("");
  return `<div class="board-panel"><h3>${title}</h3><ol class="board-list">${lis}</ol></div>`;
}

async function showLeaderboard() {
  showView("board");
  const root = $("#board-content");
  if (!window.Leaderboard || !window.Leaderboard.configured) {
    root.innerHTML = `<div class="board-empty board-empty-big">Leaderboard not configured.<br>
      <small>Add your Firebase config in firebase-config.js — see README.</small></div>`;
    return;
  }
  root.innerHTML = `<div class="board-empty board-empty-big">Loading…</div>`;
  const myId = window.StaircasesUser.getOrCreateUser().id;
  const [today, yest] = await Promise.all([
    window.Leaderboard.fetchBoard(dateKeyOffset(0)),
    window.Leaderboard.fetchBoard(dateKeyOffset(1)),
  ]);
  root.innerHTML =
    renderBoardPanel("Today", today, myId) + renderBoardPanel("Yesterday", yest, myId);
}

// Small illustrative staircase (the ART example) for the menu card + rules.
function miniStaircase() {
  let html = `<div class="mini-grid">`;
  const words = ["artery", "carton", "hearth", "depart"];
  for (let r = 0; r < 4; r++) {
    const blanks = blanksFor(r);
    for (let c = 0; c < 6; c++) {
      const isB = blanks.includes(c);
      html += `<span class="mini-cell${isB ? " b" : ""}">${isB ? "" : words[r][c].toUpperCase()}</span>`;
    }
  }
  return html + `</div>`;
}

function buildRulesDiagram() {
  $("#rules-diagram").innerHTML = miniStaircase() +
    `<div class="rules-cap">The shaded staircase always holds the same word — here, <b>ART</b>: ARTERY, CARTON, HEARTH, DEPART.</div>`;
}

function promptForName() {
  const cur = window.StaircasesUser.getOrCreateUser().name;
  const next = window.prompt("Pick a username (or leave blank to randomize):", cur);
  if (next === null) return;
  const name = next.trim() ? next : window.StaircasesUser.randomBirdName();
  window.StaircasesUser.setUserName(name);
  refreshMenu();
}

function init() {
  window.StaircasesUser.getOrCreateUser();
  refreshMenu();
  buildRulesDiagram();

  document.addEventListener("visibilitychange", () => { if (document.hidden) persist(); });
  window.addEventListener("pagehide", () => persist());

  $("#play-card").addEventListener("click", startGame);
  $("#home-btn").addEventListener("click", () => { stopGame(); refreshMenu(); showView("menu"); });
  $("#results-menu-btn").addEventListener("click", () => { refreshMenu(); showView("menu"); });
  $("#board-menu-btn").addEventListener("click", () => { refreshMenu(); showView("menu"); });
  $("#name-btn").addEventListener("click", promptForName);
  $("#menu-board-btn").addEventListener("click", showLeaderboard);
  $("#menu-rules-btn").addEventListener("click", () => {
    const box = $("#rules-box"), open = box.hidden;
    box.hidden = !open;
    $("#menu-rules-btn").setAttribute("aria-expanded", String(open));
    $("#menu-rules-btn").classList.toggle("open", open);
  });
  $("#guess-input").addEventListener("input", onInput);
  $("#guess-form").addEventListener("submit", submitGuess);
  $("#skip-btn").addEventListener("click", onSkip);
  $("#next-btn").addEventListener("click", advanceRound);
  $("#menu-share-btn").addEventListener("click", async () => { await copyToClipboard(buildShareText()); flashToast("#menu-copied-toast"); });
  $("#results-share-btn").addEventListener("click", async () => { await copyToClipboard(buildShareText()); flashToast("#results-copied-toast"); });

  showView("menu");
}

document.addEventListener("DOMContentLoaded", init);
