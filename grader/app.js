"use strict";

/* ===========================================================================
 * Grader — a daily "End View" logic puzzle (vanilla JS).
 *
 * One puzzle per day, the same for everyone (date-seeded pick from the
 * pre-verified pool in puzzles.js / puzzles-hard.js). Fill the grid so each
 * letter (A-C on Easy, A-D on Hard) appears exactly once in every row and
 * column; the rest of each row/column stays blank. The letters outside the
 * grid tell you which letter you'd see FIRST if you looked into that row or
 * column from that side. Every shipped puzzle is solvable by pure logic —
 * no guessing.
 *
 * It's a race against the clock: a count-up timer runs until you solve it, and
 * your time is the score (lower is better). Results persist per day and copy
 * as a spoiler-free summary (time only — never the layout).
 * ========================================================================= */

const EMPTY = 0, BLANKMARK = 1;   // letters occupy 2..2+k-1; QUESTION is 2+k (mode-dependent)
const letterState = (i) => 2 + i;
const isLetterState = (state, k) => state >= 2 && state < 2 + k;
const letterIndexOf = (state) => state - 2;
const letterChar = (i) => String.fromCharCode(65 + i);

/* Grader ships two daily modes that share all the game logic and differ only
 * in board size / letter count. Each mode has its own daily pick, its own
 * saved result/progress, and its own leaderboard. */
const MODES = {
  easy: { key: "easy", title: "Today's Grade", boardLabel: "Easy", seed: "grader" },
  hard: { key: "hard", title: "Hard Grade",    boardLabel: "Hard", seed: "grader-hard" },
};
const MODE_ORDER = ["easy", "hard"];
function poolFor(mode) { return mode === "hard" ? GRADER_PUZZLES_HARD : GRADER_PUZZLES; }

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
function dailyPuzzle(mode) {
  const pool = poolFor(mode);
  const rng = mulberry32(hashString(MODES[mode].seed));
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
  const d = new Date();
  d.setDate(d.getDate() - days);
  return dateKey(d);
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
  $("#hub-btn").hidden = name !== "menu";
}

// --- Storage ----------------------------------------------------------------
const resultKey = (mode) => `grader:${mode}:${dateKey()}`;
const progressKey = (mode) => `grader:progress:${mode}:${dateKey()}`;

function loadResult(mode) {
  try { return JSON.parse(localStorage.getItem(resultKey(mode)) || "null"); }
  catch { return null; }
}
function saveResult(mode, result) {
  try { localStorage.setItem(resultKey(mode), JSON.stringify(result)); }
  catch { /* storage unavailable — game still works */ }
}
function saveProgress(mode, cells, elapsed) {
  try { localStorage.setItem(progressKey(mode), JSON.stringify({ cells, elapsed: elapsed || 0 })); } catch {}
}
function loadProgress(mode) {
  try { return JSON.parse(localStorage.getItem(progressKey(mode)) || "null"); }
  catch { return null; }
}
function clearProgress(mode) {
  try { localStorage.removeItem(progressKey(mode)); } catch {}
}

// --- Streak -------------------------------------------------------------
const STREAK_KEY = "grader:streak";
function loadStreakRaw() {
  try { return JSON.parse(localStorage.getItem(STREAK_KEY) || "null"); }
  catch { return null; }
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
  if (s.lastDate === today) return;
  s.count = s.lastDate === yest ? s.count + 1 : 1;
  s.longest = Math.max(s.longest || 0, s.count);
  s.lastDate = today;
  try { localStorage.setItem(STREAK_KEY, JSON.stringify(s)); } catch {}
}

/* ===========================================================================
 * Game state + board
 * ========================================================================= */
let game = null;

function startGame(mode) {
  const existing = loadResult(mode);
  if (existing) { renderResults(mode, existing, /*replay*/ true); return; }

  const puzzle = dailyPuzzle(mode);
  const n = puzzle.n, k = puzzle.k;
  const cells = new Array(n * n).fill(EMPTY);
  const saved = loadProgress(mode);
  let elapsedBefore = 0;
  if (saved && Array.isArray(saved.cells) && saved.cells.length === n * n) {
    for (let i = 0; i < cells.length; i++) cells[i] = saved.cells[i] || EMPTY;
    elapsedBefore = saved.elapsed || 0;
  }
  game = {
    mode, puzzle, n, k,
    question: 2 + k,
    cells,
    history: [],
    startMs: performance.now(),
    elapsedBefore,
    tickId: null,
    lastPersist: 0,
  };
  showView("game");
  $("#game-mode-label").textContent = MODES[mode].title;
  renderBoard();
  updateUndoButton();
  game.tickId = setInterval(updateTimer, 250);
  updateTimer();
}

function elapsedSec() {
  return game.elapsedBefore + (performance.now() - game.startMs) / 1000;
}
function updateTimer() {
  $("#timer").textContent = fmtElapsed(elapsedSec());
  if (performance.now() - game.lastPersist > 5000) {
    game.lastPersist = performance.now();
    saveProgress(game.mode, game.cells, elapsedSec());
  }
}
function persistProgress() {
  if (game && game.tickId) saveProgress(game.mode, game.cells, elapsedSec());
}

function renderBoard() {
  const root = $("#board");
  buildGrid(root, game.puzzle, game.cells, /*interactive*/ true);
  refreshState();
}

// Shared grid builder, also used for the read-only solved board on the results
// screen. `cells` null renders the puzzle's own solution (for the results
// screen); otherwise it's the player-state array. `interactive` false skips
// wiring input.
function buildGrid(root, puzzle, cells, interactive) {
  const n = puzzle.n, k = puzzle.k;
  root.style.setProperty("--n", n);
  root.classList.toggle("big", n > 6);
  root.innerHTML = "";

  const corner = () => { const d = document.createElement("div"); d.className = "clue corner"; return d; };
  const clueCell = (letterIdx, kind) => {
    const d = document.createElement("div");
    d.className = `clue clue-${kind}`;
    d.textContent = letterChar(letterIdx);
    return d;
  };

  // Top row: corner, top clues, corner.
  root.appendChild(corner());
  for (let c = 0; c < n; c++) root.appendChild(clueCell(puzzle.top[c], "top"));
  root.appendChild(corner());

  for (let r = 0; r < n; r++) {
    root.appendChild(clueCell(puzzle.left[r], "left"));
    for (let c = 0; c < n; c++) {
      const idx = r * n + c;
      const cell = document.createElement("div");
      cell.className = "cell plot";
      cell.dataset.idx = idx;
      paintCell(cell, cells ? cells[idx] : letterState(puzzle.grid[r][c]), k);
      root.appendChild(cell);
    }
    root.appendChild(clueCell(puzzle.right[r], "right"));
  }

  root.appendChild(corner());
  for (let c = 0; c < n; c++) root.appendChild(clueCell(puzzle.bot[c], "bot"));
  root.appendChild(corner());

  if (interactive) wireBoardInput(root);
}

function paintCell(cell, state, k) {
  const question = 2 + k;
  cell.classList.toggle("is-blank", state === BLANKMARK);
  cell.classList.toggle("is-letter", isLetterState(state, k));
  cell.classList.toggle("is-question", state === question);
  if (state === BLANKMARK) {
    cell.innerHTML = `<svg class="glyph blank" viewBox="0 0 100 100" aria-hidden="true">
      <path d="M34 34 L66 66 M66 34 L34 66" stroke="currentColor" stroke-width="11"
            stroke-linecap="round" fill="none"/></svg>`;
  } else if (isLetterState(state, k)) {
    cell.innerHTML = `<span class="letter">${letterChar(letterIndexOf(state))}</span>`;
  } else if (state === question) {
    cell.innerHTML = `<span class="question-mark" aria-label="uncertain">?</span>`;
  } else {
    cell.innerHTML = "";
  }
}

function setCell(idx, state) {
  if (game.cells[idx] === state) return;
  if (pendingBatch) pendingBatch.push({ idx, prev: game.cells[idx] });
  game.cells[idx] = state;
  const cell = document.querySelector(`#board .cell[data-idx="${idx}"]`);
  if (cell) paintCell(cell, state, game.k);
}

// Undo support: every user action is one entry on game.history, recorded as
// the list of per-cell {idx, prev} changes it made.
let pendingBatch = null;
function beginBatch() { pendingBatch = []; }
function commitBatch() {
  if (pendingBatch && pendingBatch.length) game.history.push(pendingBatch);
  pendingBatch = null;
}
function updateUndoButton() {
  const btn = $("#undo-btn");
  if (btn) btn.disabled = !game || !game.history.length;
}
function undoLastAction() {
  if (!game || !game.history.length) return;
  const batch = game.history.pop();
  for (let i = batch.length - 1; i >= 0; i--) {
    const { idx, prev } = batch[i];
    game.cells[idx] = prev;
    const cell = document.querySelector(`#board .cell[data-idx="${idx}"]`);
    if (cell) paintCell(cell, prev, game.k);
  }
  saveProgress(game.mode, game.cells, elapsedSec());
  refreshState();
  updateUndoButton();
}

/* --- Input: pointer (mouse + touch) ----------------------------------------
 * Tap a cell        -> cycle its state: empty -> blank (X) -> A -> B -> C
 *                      (-> D on Hard) -> empty.
 * Hold a cell       -> mark it with a question mark; the next tap clears it.
 * Press and drag    -> mark every cell you pass over with the blank X (the
 *                      Grader analogue of Abodes' "drag paints grass" — X
 *                      marks a cell as definitely not any letter). */
const DRAG_THRESHOLD = 8;
const HOLD_DELAY = 400;

function nextCellState(cur, k, question) {
  if (cur === question) return EMPTY;
  if (cur === EMPTY) return BLANKMARK;
  if (cur === BLANKMARK) return letterState(0);
  if (isLetterState(cur, k)) {
    const i = letterIndexOf(cur);
    return i < k - 1 ? letterState(i + 1) : EMPTY;
  }
  return EMPTY;
}

function plotCellAt(x, y) {
  const el = document.elementFromPoint(x, y);
  return el && el.closest ? el.closest("#board .cell.plot") : null;
}

function wireBoardInput(root) {
  if (root.dataset.wired === "1") return;
  root.dataset.wired = "1";

  let p = null;
  let lastTouchTime = 0;

  root.addEventListener("contextmenu", (e) => e.preventDefault());
  root.addEventListener("dblclick", (e) => e.preventDefault());

  let lastTouchEnd = 0;
  root.addEventListener("touchend", (e) => {
    const now = Date.now();
    if (now - lastTouchEnd <= 350) e.preventDefault();
    lastTouchEnd = now;
  }, { passive: false });

  root.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse") {
      if (e.button != null && e.button !== 0) return;
      if (Date.now() - lastTouchTime < 700) return;
    } else {
      lastTouchTime = Date.now();
    }
    const cell = e.target.closest(".cell.plot");
    if (!cell) return;   // clues and corners do nothing
    e.preventDefault();
    try { root.setPointerCapture(e.pointerId); } catch {}
    beginBatch();
    p = { id: e.pointerId, startIdx: +cell.dataset.idx, x: e.clientX, y: e.clientY,
          dragged: false, held: false, painted: new Set(), holdId: null };
    p.holdId = window.setTimeout(() => {
      if (!p || p.id !== e.pointerId || p.dragged) return;
      p.held = true;
      setCell(p.startIdx, game.question);
    }, HOLD_DELAY);
  });

  root.addEventListener("pointermove", (e) => {
    if (!p || e.pointerId !== p.id) return;
    if (p.held) return;
    if (!p.dragged && Math.hypot(e.clientX - p.x, e.clientY - p.y) < DRAG_THRESHOLD) return;
    if (!p.dragged) {
      window.clearTimeout(p.holdId);
      p.dragged = true;
      setCell(p.startIdx, BLANKMARK);
      p.painted.add(p.startIdx);
    }
    const cell = plotCellAt(e.clientX, e.clientY);
    if (!cell) return;
    const idx = +cell.dataset.idx;
    if (!p.painted.has(idx)) { setCell(idx, BLANKMARK); p.painted.add(idx); }
  });

  const endGesture = (e, cycle) => {
    if (!p || e.pointerId !== p.id) return;
    window.clearTimeout(p.holdId);
    if (e.pointerType !== "mouse") lastTouchTime = Date.now();
    try { root.releasePointerCapture(e.pointerId); } catch {}
    if (cycle && !p.dragged && !p.held) {
      setCell(p.startIdx, nextCellState(game.cells[p.startIdx], game.k, game.question));
    }
    p = null;
    afterChange();
  };
  root.addEventListener("pointerup", (e) => endGesture(e, true));
  root.addEventListener("pointercancel", (e) => endGesture(e, false));
}

function afterChange() {
  commitBatch();
  updateUndoButton();
  saveProgress(game.mode, game.cells, elapsedSec());
  refreshState();
  checkWin();
}

// Live conflict feedback — two kinds, both unambiguous (never a false
// positive, so this is safe deduction-adjacent feedback, not a hint):
//   1. The same letter placed twice in one row/column.
//   2. A clue's "first visible letter" already broken: scanning in from a
//      clue's side, every cell up to a placed letter is explicitly marked
//      blank (X) — not just empty/unset — and that letter isn't the clue.
function refreshState() {
  const n = game.n, k = game.k;
  document.querySelectorAll("#board .cell").forEach((el) => el.classList.remove("conflict"));
  const conflictIdx = new Set();

  for (let r = 0; r < n; r++) {
    const seen = new Map();
    for (let c = 0; c < n; c++) {
      const st = game.cells[r * n + c];
      if (!isLetterState(st, k)) continue;
      const v = letterIndexOf(st);
      if (seen.has(v)) { conflictIdx.add(seen.get(v)); conflictIdx.add(r * n + c); }
      else seen.set(v, r * n + c);
    }
  }
  for (let c = 0; c < n; c++) {
    const seen = new Map();
    for (let r = 0; r < n; r++) {
      const st = game.cells[r * n + c];
      if (!isLetterState(st, k)) continue;
      const v = letterIndexOf(st);
      if (seen.has(v)) { conflictIdx.add(seen.get(v)); conflictIdx.add(r * n + c); }
      else seen.set(v, r * n + c);
    }
  }

  const scanFirst = (cellIdxs) => {
    for (const idx of cellIdxs) {
      const st = game.cells[idx];
      if (st === BLANKMARK) continue;
      if (isLetterState(st, k)) return idx;
      return null;   // empty or question: can't tell yet
    }
    return null;
  };
  for (let r = 0; r < n; r++) {
    const row = Array.from({ length: n }, (_, c) => r * n + c);
    const leftFirst = scanFirst(row);
    if (leftFirst != null && letterIndexOf(game.cells[leftFirst]) !== game.puzzle.left[r]) conflictIdx.add(leftFirst);
    const rightFirst = scanFirst([...row].reverse());
    if (rightFirst != null && letterIndexOf(game.cells[rightFirst]) !== game.puzzle.right[r]) conflictIdx.add(rightFirst);
  }
  for (let c = 0; c < n; c++) {
    const col = Array.from({ length: n }, (_, r) => r * n + c);
    const topFirst = scanFirst(col);
    if (topFirst != null && letterIndexOf(game.cells[topFirst]) !== game.puzzle.top[c]) conflictIdx.add(topFirst);
    const botFirst = scanFirst([...col].reverse());
    if (botFirst != null && letterIndexOf(game.cells[botFirst]) !== game.puzzle.bot[c]) conflictIdx.add(botFirst);
  }

  for (const idx of conflictIdx) {
    const cell = document.querySelector(`#board .cell[data-idx="${idx}"]`);
    if (cell) cell.classList.add("conflict");
  }

  let placed = 0;
  for (let i = 0; i < game.cells.length; i++) if (isLetterState(game.cells[i], k)) placed++;
  const pill = document.querySelector("#progress-pill");
  if (pill) pill.textContent = `${placed} / ${n * k}`;
}

// A win is exactly the unique solution: every letter cell holds the correct
// letter, and no blank cell holds any letter (right or wrong). Cells the
// player left as X, ?, or empty on a blank square don't matter — same
// "positive state must match exactly" philosophy as Abodes' tent check.
function checkWin() {
  const { n, k, grid } = game.puzzle;
  for (let i = 0; i < game.cells.length; i++) {
    const r = (i / n) | 0, c = i % n;
    const want = grid[r][c];
    const st = game.cells[i];
    if (want === -1) {
      if (isLetterState(st, k)) return;
    } else {
      if (!isLetterState(st, k) || letterIndexOf(st) !== want) return;
    }
  }
  finishGame();
}

function finishGame() {
  if (game.tickId) { clearInterval(game.tickId); game.tickId = null; }
  const mode = game.mode;
  const sec = elapsedSec();
  const result = { date: dateKey(), seconds: Math.round(sec), mode };
  saveResult(mode, result);
  clearProgress(mode);
  bumpStreak();
  const user = window.GraderUser.getOrCreateUser();
  window.Leaderboard?.submitScore?.({
    userId: user.id, name: user.name, date: result.date, seconds: result.seconds, mode,
  });
  renderResults(mode, result, false);
}

function stopGame() {
  persistProgress();
  if (game && game.tickId) { clearInterval(game.tickId); game.tickId = null; }
}

/* ===========================================================================
 * Results + share
 * ========================================================================= */
function renderResults(mode, result, replay) {
  $("#results-title").textContent =
    (replay ? "Already solved" : "Solved") + ` — ${MODES[mode].title}`;
  $("#final-time").textContent = fmtElapsed(result.seconds);

  const puzzle = dailyPuzzle(mode);
  const board = $("#solved-board");
  buildGrid(board, puzzle, null, /*interactive*/ false);

  showView("results");
}

function buildShareText() {
  const lines = [`Grader — ${dateKey()}`];
  for (const mode of MODE_ORDER) {
    const res = loadResult(mode);
    if (res) lines.push(`${MODES[mode].boardLabel}: 📝 ${fmtElapsed(res.seconds)}`);
  }
  const streak = currentStreak();
  if (streak >= 2) lines.push(`🔥 ${streak}`);
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
function flashToast(id) {
  const t = $(id);
  t.hidden = false;
  setTimeout(() => (t.hidden = true), 2000);
}

/* ===========================================================================
 * Menu + wiring
 * ========================================================================= */
function refreshMenu() {
  $("#date-label").textContent = dateKey();
  const user = window.GraderUser.getOrCreateUser();
  $("#player-name").textContent = user.name;
  const streak = currentStreak();
  const streakEl = $("#streak");
  streakEl.textContent = streak >= 1 ? `🔥 ${streak} day${streak === 1 ? "" : "s"}` : "";
  streakEl.hidden = streak < 1;

  let anySolved = false;
  for (const mode of MODE_ORDER) {
    const res = loadResult(mode);
    if (res) anySolved = true;
    const statusEl = $(`#status-${mode}`);
    if (statusEl) {
      statusEl.textContent = res
        ? `Solved today · ${fmtElapsed(res.seconds)}`
        : (loadProgress(mode) ? "In progress…" : "Not solved today");
    }
  }
  $("#menu-share-btn").hidden = !anySolved;

  const easyArt = document.querySelector('[data-art="easy"]');
  const hardArt = document.querySelector('[data-art="hard"]');
  if (easyArt) easyArt.innerHTML = `<span class="art-letter">A</span><span class="art-letter">B</span><span class="art-letter">C</span>`;
  if (hardArt) hardArt.innerHTML = `<span class="art-letter">A</span><span class="art-letter">B</span><span class="art-letter">C</span><span class="art-letter">D</span>`;
}

function promptForName() {
  const cur = window.GraderUser.getOrCreateUser().name;
  const next = window.prompt("Pick a username (or leave blank to randomize):", cur);
  if (next === null) return;
  const name = next.trim() ? next : window.GraderUser.randomBirdName();
  window.GraderUser.setUserName(name);
  refreshMenu();
}

function escapeHtml(s) {
  return String(s).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
}

function renderBoardPanel(title, rows, myId) {
  if (!rows) {
    return `<div class="board-panel"><h3>${title}</h3><div class="board-empty">—</div></div>`;
  }
  if (!rows.length) {
    return `<div class="board-panel"><h3>${title}</h3><div class="board-empty">No times yet.</div></div>`;
  }
  const sorted = [...rows].sort((a, b) => a.seconds - b.seconds);
  const lis = sorted.map((r, i) => {
    const me = r.userId === myId ? " me" : "";
    const name = escapeHtml(r.name || "—");
    return `<li class="board-row${me}">` +
           `<span class="board-rank">${i + 1}</span>` +
           `<span class="board-name">${name}</span>` +
           `<span class="board-score">${fmtElapsed(r.seconds)}</span>` +
           `</li>`;
  }).join("");
  return `<div class="board-panel"><h3>${title}</h3><ol class="board-list">${lis}</ol></div>`;
}

async function showLeaderboard() {
  showView("board");
  const root = $("#board-content");
  if (!window.Leaderboard || !window.Leaderboard.configured) {
    root.innerHTML = `
      <div class="board-empty board-empty-big">
        Leaderboard not configured.<br>
        <small>Add your Firebase config in firebase-config.js — see README.</small>
      </div>`;
    return;
  }
  root.innerHTML = `<div class="board-empty board-empty-big">Loading…</div>`;
  const myId = window.GraderUser.getOrCreateUser().id;
  const [today, yest] = await Promise.all([
    window.Leaderboard.fetchBoard(dateKeyOffset(0)),
    window.Leaderboard.fetchBoard(dateKeyOffset(1)),
  ]);
  root.innerHTML =
    renderBoardPanel("Today · Easy",     today && today.easy, myId) +
    renderBoardPanel("Today · Hard",     today && today.hard, myId) +
    renderBoardPanel("Yesterday · Easy", yest && yest.easy,   myId) +
    renderBoardPanel("Yesterday · Hard", yest && yest.hard,   myId);
}

// Small illustrative board in the How-to-play dropdown: a 3x3 slice with
// clues, hand-picked to demonstrate the rule (not a real puzzle).
function buildRulesDiagram() {
  const box = $("#rules-diagram");
  if (!box) return;
  const demo = {
    n: 3, k: 2,
    grid: [[-1, 0, 1], [1, -1, 0], [0, 1, -1]],
    left: [0, 1, 0], right: [1, 0, 1], top: [1, 0, 0], bot: [0, 1, 1],
  };
  buildGrid(box, demo, null, /*interactive*/ false);
}

function init() {
  window.GraderUser.getOrCreateUser();
  refreshMenu();
  buildRulesDiagram();

  document.addEventListener("visibilitychange", () => { if (document.hidden) persistProgress(); });
  window.addEventListener("pagehide", persistProgress);

  document.querySelectorAll(".mode-card[data-mode]").forEach((card) => {
    card.addEventListener("click", () => startGame(card.dataset.mode));
  });
  $("#home-btn").addEventListener("click", () => { stopGame(); refreshMenu(); showView("menu"); });
  $("#results-menu-btn").addEventListener("click", () => { refreshMenu(); showView("menu"); });
  $("#board-menu-btn").addEventListener("click", () => { refreshMenu(); showView("menu"); });
  $("#name-btn").addEventListener("click", promptForName);
  $("#menu-board-btn").addEventListener("click", showLeaderboard);
  $("#menu-rules-btn").addEventListener("click", () => {
    const box = $("#rules-box");
    const open = box.hidden;
    box.hidden = !open;
    $("#menu-rules-btn").setAttribute("aria-expanded", String(open));
    $("#menu-rules-btn").classList.toggle("open", open);
  });
  $("#undo-btn").addEventListener("click", undoLastAction);
  $("#clear-btn").addEventListener("click", () => {
    if (!game) return;
    beginBatch();
    for (let i = 0; i < game.cells.length; i++) setCell(i, EMPTY);
    commitBatch();
    updateUndoButton();
    clearProgress(game.mode);
    renderBoard();
  });
  $("#menu-share-btn").addEventListener("click", async () => {
    await copyToClipboard(buildShareText());
    flashToast("#menu-copied-toast");
  });
  $("#results-share-btn").addEventListener("click", async () => {
    await copyToClipboard(buildShareText());
    flashToast("#results-copied-toast");
  });

  showView("menu");
}

document.addEventListener("DOMContentLoaded", init);
