"use strict";

/* ===========================================================================
 * Square Up — a daily dissection puzzle (vanilla JS).
 *
 * One 36-cell shape a day, the same for everyone (date-seeded pick from the
 * pre-verified pool in puzzles.js). Split it into two pieces — tap cells to
 * toggle which piece they belong to — that can be rotated and/or reflected to
 * reassemble into a perfect 6x6 square. Every shipped puzzle has been checked
 * to have exactly one such split.
 *
 * It's a race against the clock: a count-up timer runs until you solve it,
 * your time is the score (lower is better). Stuck? Skip shows the answer, but
 * a skip earns no score — no leaderboard entry, no streak. Results persist per
 * day and copy as a spoiler-free summary (time only, never the shape or the
 * split).
 * ========================================================================= */

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
// Deterministic index into the pool for a given date, so the order is a stable
// shuffle (every puzzle is used once before any repeats).
function dailyPuzzle() {
  const pool = SQUAREUP_PUZZLES;
  const rng = mulberry32(hashString("squareup"));
  const idx = pool.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  const epoch = Date.UTC(2026, 0, 1);
  const day = Math.floor((Date.now() - epoch) / 86400000);
  const pos = ((day % idx.length) + idx.length) % idx.length;
  return pool[idx[pos]];
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
const keyOf = (r, c) => `${r},${c}`;
function setsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
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
const resultKey = () => `squareup:${dateKey()}`;
const progressKey = () => `squareup:progress:${dateKey()}`;
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

// --- Streak ------------------------------------------------------------------
const STREAK_KEY = "squareup:streak";
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
 * Game state + board
 * ========================================================================= */
let game = null;

function shapeBounds(shape) {
  let maxR = 0, maxC = 0;
  for (const [r, c] of shape) { if (r > maxR) maxR = r; if (c > maxC) maxC = c; }
  return { rows: maxR + 1, cols: maxC + 1 };
}

function startGame() {
  const existing = loadResult();
  if (existing) { renderResults(existing, /*replay*/ true); return; }

  const puzzle = dailyPuzzle();
  const saved = loadProgress();
  const marked = new Set(saved && Array.isArray(saved.marked) ? saved.marked : []);
  game = {
    puzzle, marked,
    startMs: performance.now(),
    elapsedBefore: saved ? (saved.elapsed || 0) : 0,
    tickId: null,
    lastPersist: 0,
    solved: false,
  };
  showView("game");
  $("#guess-msg").textContent = " ";
  $("#guess-msg").className = "guess-msg";
  $("#check-btn").disabled = false;
  $("#reveal-btn").disabled = false;
  renderBoard();
  game.tickId = setInterval(updateTimer, 250);
  updateTimer();
}

function elapsedSec() {
  return game.elapsedBefore + (performance.now() - game.startMs) / 1000;
}
function updateTimer() {
  $("#timer").textContent = fmtElapsed(elapsedSec());
  if (performance.now() - game.lastPersist > 4000) persist();
}
function persist() {
  if (!game || game.solved) return;
  game.lastPersist = performance.now();
  saveProgress({ marked: [...game.marked], elapsed: elapsedSec() });
}

function renderBoard() {
  buildBoard($("#board"), game.puzzle.shape, game.marked, /*interactive*/ true);
}

// Shared grid builder — also used (non-interactively) for the solved-square
// reveal on the results screen, where `cellFn` supplies each cell's class
// directly instead of reading from a live `marked` set.
function buildBoard(root, shapeCells, marked, interactive) {
  const shapeSet = new Set(shapeCells.map(([r, c]) => keyOf(r, c)));
  const { rows, cols } = shapeBounds(shapeCells);
  root.style.setProperty("--rows", rows);
  root.style.setProperty("--cols", cols);
  root.style.aspectRatio = `${cols} / ${rows}`;
  root.innerHTML = "";
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = document.createElement("div");
      const k = keyOf(r, c);
      if (!shapeSet.has(k)) {
        cell.className = "cell gap";
      } else {
        cell.className = "cell plot" + (marked.has(k) ? " marked" : "");
        cell.dataset.key = k;
      }
      root.appendChild(cell);
    }
  }
  if (interactive) wireBoardInput(root);
}

// --- Input: click a cell to group it with the other green cells; click and
// drag to paint a whole run at once. A drag's paint value is decided by the
// FIRST cell it touches (whatever a plain tap would have done to it) and then
// applied consistently to every other cell the gesture passes over — the same
// "paint one value across a drag" approach Abodes uses for marking grass, just
// with a value chosen per-gesture instead of a single fixed one. Guards against
// iOS Safari's double-tap-to-zoom, and against wiring the same persistent
// #board node twice (buildBoard reuses it every re-render).
const DRAG_THRESHOLD = 8;   // px of movement before a press becomes a drag

function wireBoardInput(root) {
  if (root.dataset.wired === "1") return;
  root.dataset.wired = "1";

  root.addEventListener("contextmenu", (e) => e.preventDefault());
  root.addEventListener("dblclick", (e) => e.preventDefault());
  let lastTouchEnd = 0;
  root.addEventListener("touchend", (e) => {
    const now = Date.now();
    if (now - lastTouchEnd <= 350) e.preventDefault();
    lastTouchEnd = now;
  }, { passive: false });

  function cellAt(x, y) {
    const el = document.elementFromPoint(x, y);
    return el && el.closest ? el.closest("#board .cell.plot") : null;
  }

  let p = null;   // active pointer gesture

  root.addEventListener("pointerdown", (e) => {
    if (!game || game.solved) return;
    if (e.button != null && e.button !== 0 && e.pointerType === "mouse") return;
    const cell = e.target.closest(".cell.plot");
    if (!cell) return;
    e.preventDefault();
    try { root.setPointerCapture(e.pointerId); } catch {}
    const k = cell.dataset.key;
    p = {
      id: e.pointerId, x: e.clientX, y: e.clientY, dragged: false,
      startKey: k, paintValue: !game.marked.has(k), painted: new Set(),
    };
  });

  root.addEventListener("pointermove", (e) => {
    if (!p || e.pointerId !== p.id) return;
    if (!p.dragged && Math.hypot(e.clientX - p.x, e.clientY - p.y) < DRAG_THRESHOLD) return;
    if (!p.dragged) {           // entering drag: also paint the start cell
      p.dragged = true;
      setCellMarked(p.startKey, p.paintValue);
      p.painted.add(p.startKey);
    }
    const cell = cellAt(e.clientX, e.clientY);
    if (!cell) return;
    const k = cell.dataset.key;
    if (!p.painted.has(k)) { setCellMarked(k, p.paintValue); p.painted.add(k); }
  });

  const endGesture = (e, wasRealEnd) => {
    if (!p || e.pointerId !== p.id) return;
    try { root.releasePointerCapture(e.pointerId); } catch {}
    if (wasRealEnd && !p.dragged) {
      // A plain click toggles just the one cell.
      setCellMarked(p.startKey, p.paintValue);
    }
    p = null;
    if (wasRealEnd) persist();
  };
  root.addEventListener("pointerup", (e) => endGesture(e, true));
  root.addEventListener("pointercancel", (e) => endGesture(e, false));
}

function setCellMarked(k, marked) {
  if (marked) game.marked.add(k); else game.marked.delete(k);
  const cell = document.querySelector(`#board .cell[data-key="${CSS.escape(k)}"]`);
  if (cell) cell.classList.toggle("marked", marked);
  $("#guess-msg").textContent = " ";
  $("#guess-msg").className = "guess-msg";
}

// Does the current marked set equal the puzzle's stored solution split, in
// EITHER orientation (which set got called "A" during generation is arbitrary
// — painting the complement is exactly the same physical cut)?
function currentMatchesSolution() {
  const shapeKeys = game.puzzle.shape.map(([r, c]) => keyOf(r, c));
  const aKeys = new Set(game.puzzle.a.map(([r, c]) => keyOf(r, c)));
  const bKeys = new Set(shapeKeys.filter((k) => !aKeys.has(k)));
  return setsEqual(game.marked, aKeys) || setsEqual(game.marked, bKeys);
}

function onCheck() {
  if (!game || game.solved) return;
  if (game.marked.size === 0 || game.marked.size === game.puzzle.shape.length) {
    flashMsg("Mark some cells as one piece first", "warn");
    return;
  }
  if (currentMatchesSolution()) {
    finishGame(false);
  } else {
    flashMsg("Not quite — try again", "warn");
    const board = $("#board");
    board.classList.remove("shake"); void board.offsetWidth; board.classList.add("shake");
  }
}

function onSkip() {
  if (!game || game.solved) return;
  const aKeys = game.puzzle.a.map(([r, c]) => keyOf(r, c));
  game.marked = new Set(aKeys);
  renderBoard();
  document.querySelectorAll("#board .cell.marked").forEach((el) => el.classList.add("revealed"));
  finishGame(true);
}

function flashMsg(text, cls) {
  const m = $("#guess-msg");
  m.textContent = text;
  m.className = "guess-msg " + (cls || "");
}

// `skipped` earns no score at all: no leaderboard entry, no streak bump. The
// local result is still saved (so re-opening today shows the skip, not a
// fresh puzzle) but carries no time.
function finishGame(skipped) {
  game.solved = true;
  if (game.tickId) { clearInterval(game.tickId); game.tickId = null; }
  $("#check-btn").disabled = true;
  $("#reveal-btn").disabled = true;

  if (skipped) {
    const result = { date: dateKey(), skipped: true };
    saveResult(result);
    clearProgress();
    flashMsg("Skipped", "reveal");
    setTimeout(() => renderResults(result, false), 500);
    return;
  }

  const seconds = Math.round(elapsedSec());
  const result = { date: dateKey(), seconds, skipped: false };
  saveResult(result);
  clearProgress();
  bumpStreak();
  const user = window.SquareUpUser.getOrCreateUser();
  window.Leaderboard?.submitScore?.({
    userId: user.id, name: user.name, date: result.date, seconds: result.seconds,
  });
  flashMsg("Solved!", "good");
  setTimeout(() => renderResults(result, false), 700);
}

function stopGame() {
  persist();
  if (game && game.tickId) { clearInterval(game.tickId); game.tickId = null; }
}

/* ===========================================================================
 * Results + share
 * ========================================================================= */
function renderResults(result, replay) {
  if (result.skipped) {
    $("#results-title").textContent = "Skipped";
    $("#final-time").textContent = "—";
  } else {
    $("#results-title").textContent = replay ? "Already solved" : "Solved!";
    $("#final-time").textContent = fmtElapsed(result.seconds);
  }

  // The plain 6x6 square the day's shape hides, both pieces coloured to match
  // the play board — the "aha, it really becomes a square" payoff.
  const puzzle = dailyPuzzle();
  const sqCells = puzzle.sq.map(([r, c]) => [r, c]);
  const aSet = new Set(puzzle.sq.filter(([, , tag]) => tag === "a").map(([r, c]) => keyOf(r, c)));
  buildBoard($("#solved-board"), sqCells, aSet, /*interactive*/ false);

  showView("results");
}

// Spoiler-free share text: date + time + streak. Never the shape or the split.
function buildShareText() {
  const res = loadResult();
  if (!res) return `Square Up — ${dateKey()}`;
  if (res.skipped) return `Square Up — ${res.date}\n⬜ Skipped`;
  const streak = currentStreak();
  const tail = streak >= 2 ? `  🔥 ${streak}` : "";
  return `Square Up — ${res.date}\n🟩 ⏱ ${fmtElapsed(res.seconds)}${tail}`;
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
  const user = window.SquareUpUser.getOrCreateUser();
  $("#player-name").textContent = user.name;

  const res = loadResult();
  const prog = loadProgress();
  $("#status-daily").textContent = res
    ? (res.skipped ? "Skipped today · no score" : `Solved today · ${fmtElapsed(res.seconds)}`)
    : (prog ? "In progress…" : "Not solved today");
  $("#menu-share-btn").hidden = !res;
  $("#menu-art").innerHTML = miniSquareArt();
}

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
  const myId = window.SquareUpUser.getOrCreateUser().id;
  const [today, yest] = await Promise.all([
    window.Leaderboard.fetchBoard(dateKeyOffset(0)),
    window.Leaderboard.fetchBoard(dateKeyOffset(1)),
  ]);
  root.innerHTML =
    renderBoardPanel("Today", today, myId) + renderBoardPanel("Yesterday", yest, myId);
}

// Tiny 2x2-ish decorative art for the menu card: two little colored blocks
// suggesting the two pieces of a dissection.
function miniSquareArt() {
  return `<div class="mini-square">
    <span class="mini-cell a"></span><span class="mini-cell a"></span>
    <span class="mini-cell a"></span><span class="mini-cell b"></span>
    <span class="mini-cell b"></span><span class="mini-cell b"></span>
  </div>`;
}

// Rules illustration: pick the most compact puzzle in the pool (smallest
// bounding box) so the "here's the shape, here's the square it hides" example
// reads clearly at a glance. This is real, generator-verified data — not a
// hand-drawn example — with the answer pre-applied purely for teaching.
function buildRulesDiagram() {
  const box = $("#rules-diagram");
  if (!box) return;
  let best = SQUAREUP_PUZZLES[0], bestArea = Infinity;
  for (const p of SQUAREUP_PUZZLES.slice(0, 40)) {
    const { rows, cols } = shapeBounds(p.shape);
    const area = rows * cols;
    if (area < bestArea) { bestArea = area; best = p; }
  }
  const aSet = new Set(best.a.map(([r, c]) => keyOf(r, c)));
  const shapeDiv = document.createElement("div");
  shapeDiv.className = "board rules-mini";
  buildBoard(shapeDiv, best.shape, aSet, /*interactive*/ false);

  const sqDiv = document.createElement("div");
  sqDiv.className = "board rules-mini";
  const sqCells = best.sq.map(([r, c]) => [r, c]);
  const sqA = new Set(best.sq.filter(([, , tag]) => tag === "a").map(([r, c]) => keyOf(r, c)));
  buildBoard(sqDiv, sqCells, sqA, /*interactive*/ false);

  box.innerHTML = "";
  const row = document.createElement("div");
  row.className = "rules-diagram-row";
  const wrapA = document.createElement("figure");
  wrapA.className = "dia";
  wrapA.appendChild(shapeDiv);
  wrapA.insertAdjacentHTML("beforeend", "<figcaption>Today's shape, split into two pieces</figcaption>");
  const arrow = document.createElement("div");
  arrow.className = "rules-arrow";
  arrow.textContent = "→";
  const wrapB = document.createElement("figure");
  wrapB.className = "dia good";
  wrapB.appendChild(sqDiv);
  wrapB.insertAdjacentHTML("beforeend", "<figcaption>✓ Rotate/flip either piece — a perfect square</figcaption>");
  row.appendChild(wrapA); row.appendChild(arrow); row.appendChild(wrapB);
  box.appendChild(row);
}

function promptForName() {
  const cur = window.SquareUpUser.getOrCreateUser().name;
  const next = window.prompt("Pick a username (or leave blank to randomize):", cur);
  if (next === null) return;
  const name = next.trim() ? next : window.SquareUpUser.randomBirdName();
  window.SquareUpUser.setUserName(name);
  refreshMenu();
}

function init() {
  window.SquareUpUser.getOrCreateUser();
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
  $("#check-btn").addEventListener("click", onCheck);
  $("#reveal-btn").addEventListener("click", onSkip);
  $("#menu-share-btn").addEventListener("click", async () => { await copyToClipboard(buildShareText()); flashToast("#menu-copied-toast"); });
  $("#results-share-btn").addEventListener("click", async () => { await copyToClipboard(buildShareText()); flashToast("#results-copied-toast"); });

  showView("menu");
}

document.addEventListener("DOMContentLoaded", init);
