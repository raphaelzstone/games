"use strict";

/* ===========================================================================
 * Staircases — a daily word puzzle (vanilla JS).
 *
 * Three puzzles a day, the same for everyone. Each puzzle hides one 3-letter
 * string that staircases through four 6-letter words: in row r (0..3) the
 * trigram occupies columns r..r+2, the other three cells are shown. Find the
 * single 3-letter string that completes all four rows.
 *
 * It's a race against the clock: one count-up timer across all three puzzles;
 * your total time is the score (lower is better). A Reveal costs +30s. Results
 * persist per day and copy as a spoiler-free summary.
 * ========================================================================= */

const ROUNDS = 3;
const REVEAL_PENALTY = 30;   // seconds added for revealing a puzzle

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
// A stable shuffle of the pool, stepped ROUNDS puzzles per day so each day gets
// a distinct trio and every puzzle is used before any repeats.
function dailyPuzzles() {
  const pool = STAIRCASES_PUZZLES;
  const rng = mulberry32(hashString("staircases"));
  const idx = pool.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  const epoch = Date.UTC(2026, 0, 1);
  const day = Math.floor((Date.now() - epoch) / 86400000);
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
    done: puzzles.map(() => null),   // per puzzle: "solved" | "revealed" | null
    penalty: 0,
    startMs: performance.now(),
    elapsedBefore: 0,
    tickId: null,
    lastPersist: 0,
  };
  if (saved && Array.isArray(saved.done) && saved.done.length === ROUNDS) {
    game.done = saved.done;
    game.penalty = saved.penalty || 0;
    game.elapsedBefore = saved.elapsed || 0;
    game.round = Math.min(saved.round || 0, ROUNDS - 1);
    // Skip forward over any already-finished puzzles.
    while (game.round < ROUNDS && game.done[game.round]) game.round++;
    if (game.round >= ROUNDS) { finishGame(); return; }
  }
  showView("game");
  game.tickId = setInterval(updateTimer, 250);
  renderRound();
  updateTimer();
}

function elapsedSec() {
  return game.elapsedBefore + (performance.now() - game.startMs) / 1000 + game.penalty;
}
function updateTimer() {
  $("#timer").textContent = fmtElapsed(elapsedSec());
  if (performance.now() - game.lastPersist > 4000) persist();
}
function persist() {
  if (!game) return;
  game.lastPersist = performance.now();
  saveProgress({
    round: game.round, done: game.done, penalty: game.penalty, elapsed: elapsedSec() - game.penalty,
  });
}

// Render the current puzzle's grid + reset the guess box.
function renderRound() {
  const p = game.puzzles[game.round];
  $("#progress-pill").textContent = `Puzzle ${game.round + 1} of ${ROUNDS}`;
  $("#reveal-btn").disabled = false;
  const msg = $("#guess-msg"); msg.textContent = " "; msg.className = "guess-msg";
  const input = $("#guess-input"); input.value = ""; input.disabled = false;

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
    solveRound("solved");
  } else {
    flashMsg("Not quite — try again", "warn");
    const input = $("#guess-input");
    input.classList.remove("shake"); void input.offsetWidth; input.classList.add("shake");
  }
}

function revealRound() {
  if (!game || game.done[game.round]) return;
  game.penalty += REVEAL_PENALTY;
  solveRound("revealed");
}

// Fill in the answer, mark the puzzle, briefly show it, then advance.
function solveRound(how) {
  game.done[game.round] = how;
  const p = game.puzzles[game.round];
  buildGrid(p, p.a);                        // fill blanks with the answer
  $("#grid").querySelectorAll(".blank").forEach((el) => el.classList.add(how));
  $("#guess-input").value = p.a.toUpperCase();
  $("#guess-input").disabled = true;
  $("#reveal-btn").disabled = true;
  flashMsg(how === "solved" ? "Solved!" : `It was ${p.a.toUpperCase()}`,
           how === "solved" ? "good" : "reveal");
  persist();
  setTimeout(() => {
    game.round++;
    if (game.round >= ROUNDS) finishGame();
    else renderRound();
  }, how === "solved" ? 800 : 1200);
}

function flashMsg(text, cls) {
  const m = $("#guess-msg");
  m.textContent = text;
  m.className = "guess-msg " + (cls || "");
}

function finishGame() {
  if (game.tickId) { clearInterval(game.tickId); game.tickId = null; }
  const seconds = Math.round(elapsedSec());
  const solved = game.done.filter((d) => d === "solved").length;
  const result = {
    date: dateKey(), seconds, solved, total: ROUNDS,
    answers: game.puzzles.map((p) => p.a), done: game.done.slice(),
  };
  saveResult(result);
  clearProgress();
  bumpStreak();
  const user = window.StaircasesUser.getOrCreateUser();
  window.Leaderboard?.submitScore?.({
    userId: user.id, name: user.name, date: result.date, seconds: result.seconds,
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
  $("#final-time").textContent = fmtElapsed(result.seconds);
  $("#final-label").textContent = `your time · ${result.solved}/${result.total} solved`;
  // Per-puzzle recap (spoiler: shows the answers, but you've finished).
  const rows = (result.answers || []).map((a, i) => {
    const how = (result.done || [])[i];
    const tag = how === "solved" ? "✓" : "revealed";
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
  return `Staircases — ${res.date}\n${marks}  ⏱ ${fmtElapsed(res.seconds)} (${res.solved}/${res.total})${tail}`;
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
    ? `Played today · ${fmtElapsed(res.seconds)} · ${res.solved}/${res.total}`
    : (prog ? "In progress…" : "Not played today");
  $("#menu-share-btn").hidden = !res;
  $("#menu-art").innerHTML = miniStaircase();
}

// One leaderboard panel: players ranked by fastest time.
function renderBoardPanel(title, rows, myId) {
  if (!rows) return `<div class="board-panel"><h3>${title}</h3><div class="board-empty">—</div></div>`;
  if (!rows.length) return `<div class="board-panel"><h3>${title}</h3><div class="board-empty">No times yet.</div></div>`;
  const sorted = [...rows].sort((a, b) => a.seconds - b.seconds);
  const lis = sorted.map((r, i) => {
    const me = r.userId === myId ? " me" : "";
    return `<li class="board-row${me}">` +
           `<span class="board-rank">${i + 1}</span>` +
           `<span class="board-name">${escapeHtml(r.name || "—")}</span>` +
           `<span class="board-score">${fmtElapsed(r.seconds)}</span></li>`;
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
  $("#reveal-btn").addEventListener("click", revealRound);
  $("#menu-share-btn").addEventListener("click", async () => { await copyToClipboard(buildShareText()); flashToast("#menu-copied-toast"); });
  $("#results-share-btn").addEventListener("click", async () => { await copyToClipboard(buildShareText()); flashToast("#results-copied-toast"); });

  showView("menu");
}

document.addEventListener("DOMContentLoaded", init);
