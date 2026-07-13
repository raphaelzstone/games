"use strict";

/* ===========================================================================
 * Abodes — a daily Tents logic puzzle (vanilla JS).
 *
 * One 8x8 puzzle per day, the same for everyone (date-seeded pick from the
 * pre-verified pool in puzzles.js). Place a tent next to every tree so that:
 *   - tents pair one-to-one with orthogonally-adjacent trees,
 *   - no two tents touch (including diagonally),
 *   - each row/column has the clued number of tents.
 * Every shipped puzzle is solvable by pure logic — no guessing.
 *
 * It's a race against the clock: a count-up timer runs until you solve it, and
 * your time is the score (lower is better). Results persist per day and copy as
 * a spoiler-free summary (time only — never the layout).
 * ========================================================================= */

const EMPTY = 0, TENT = 1, GRASS = 2;   // player cell states (trees are separate)

/* Abodes ships two daily modes that share all the game logic and differ only in
 * which puzzle pool they draw from (and how big the board is). Each mode has its
 * own daily pick, its own saved result/progress, and its own leaderboard. */
const MODES = {
  normal: { key: "normal", title: "Today's Camp", boardLabel: "Normal", seed: "abodes" },
  hard:   { key: "hard",   title: "Hard Camp",    boardLabel: "Hard",   seed: "abodes-hard" },
};
const MODE_ORDER = ["normal", "hard"];
function poolFor(mode) { return mode === "hard" ? ABODES_PUZZLES_HARD : ABODES_PUZZLES; }

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
// Deterministic index into a mode's pool for a given date, so the order is a
// stable shuffle (every puzzle is used once before any repeats). Each mode
// seeds its own shuffle so the two boards are unrelated day to day.
function dailyPuzzle(mode) {
  const pool = poolFor(mode);
  const rng = mulberry32(hashString(MODES[mode].seed));
  const idx = pool.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  // Day number since an epoch picks how far into the shuffled order we are, so
  // consecutive days step through distinct puzzles.
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
}

// --- SVG art ----------------------------------------------------------------
// Simple but readable: a tree is a leafy green canopy on a brown trunk; a tent
// is an A-frame of canvas with a pole. Both scale to fill their cell.
function treeSVG() {
  return `<svg class="glyph tree" viewBox="0 0 100 100" aria-label="tree">
    <rect x="44" y="62" width="12" height="28" rx="3" fill="#7a4a22"/>
    <path d="M50 8 L78 52 H22 Z" fill="#3c6b49"/>
    <path d="M50 26 L84 74 H16 Z" fill="#4a8159"/>
    <path d="M50 44 L90 92 H10 Z" fill="#5b9669"/>
  </svg>`;
}
function tentSVG() {
  return `<svg class="glyph tent" viewBox="0 0 100 100" aria-label="tent">
    <path d="M50 16 L88 84 H12 Z" fill="#d98a3c"/>
    <path d="M50 16 L50 84 L88 84 Z" fill="#c47a2f"/>
    <path d="M50 16 L66 84 H50 Z" fill="#8a5320"/>
    <line x1="50" y1="6" x2="50" y2="20" stroke="#6b4118" stroke-width="4" stroke-linecap="round"/>
  </svg>`;
}
function grassSVG() {
  // A light "X" marking a square known to hold no tent.
  return `<svg class="glyph grass" viewBox="0 0 100 100" aria-hidden="true">
    <path d="M34 34 L66 66 M66 34 L34 66" stroke="currentColor" stroke-width="11"
          stroke-linecap="round" fill="none"/>
  </svg>`;
}

// --- Storage ----------------------------------------------------------------
// Keys are namespaced per mode. Normal mode keeps its original un-suffixed keys
// so a game already in progress survives this update; hard mode gets its own.
const modeTag = (mode) => (mode === "normal" ? "" : `${mode}:`);
const resultKey = (mode) => `abodes:${modeTag(mode)}${dateKey()}`;
const progressKey = (mode) => `abodes:progress:${modeTag(mode)}${dateKey()}`;

function loadResult(mode) {
  try { return JSON.parse(localStorage.getItem(resultKey(mode)) || "null"); }
  catch { return null; }
}
function saveResult(mode, result) {
  try { localStorage.setItem(resultKey(mode), JSON.stringify(result)); }
  catch { /* storage unavailable — game still works */ }
}
// Persist an in-progress board so a refresh doesn't wipe your work.
function saveProgress(mode, cells) {
  try { localStorage.setItem(progressKey(mode), JSON.stringify(cells)); } catch {}
}
function loadProgress(mode) {
  try { return JSON.parse(localStorage.getItem(progressKey(mode)) || "null"); }
  catch { return null; }
}
function clearProgress(mode) {
  try { localStorage.removeItem(progressKey(mode)); } catch {}
}

// --- Streak -----------------------------------------------------------------
const STREAK_KEY = "abodes:streak";
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

function treeSet(puzzle) {
  return new Set(puzzle.trees.map(([r, c]) => r * puzzle.size + c));
}

function startGame(mode) {
  const existing = loadResult(mode);
  if (existing) { renderResults(mode, existing, /*replay*/ true); return; }

  const puzzle = dailyPuzzle(mode);
  const n = puzzle.size;
  const cells = new Array(n * n).fill(EMPTY);
  const saved = loadProgress(mode);
  if (Array.isArray(saved) && saved.length === n * n) {
    for (let i = 0; i < cells.length; i++) cells[i] = saved[i] || EMPTY;
  }
  game = {
    mode, puzzle, n,
    trees: treeSet(puzzle),
    solution: new Set(puzzle.tents.map(([r, c]) => r * n + c)),
    cells,
    startMs: performance.now(),
    elapsedBefore: 0,
    tickId: null,
  };
  showView("game");
  $("#game-mode-label").textContent = MODES[mode].title;
  renderBoard();
  game.tickId = setInterval(updateTimer, 250);
  updateTimer();
}

function elapsedSec() {
  return game.elapsedBefore + (performance.now() - game.startMs) / 1000;
}
function updateTimer() {
  $("#timer").textContent = fmtElapsed(elapsedSec());
}

// Render the playable board into #board: an (n+1)x(n+1) grid where the last
// column/row holds the clue numbers.
function renderBoard() {
  const root = $("#board");
  buildGrid(root, game.puzzle, game.cells, /*interactive*/ true);
  refreshState();
}

// Shared grid builder, also used for the read-only solved board on the results
// screen. `cells` is the player-state array; pass `interactive` false to render
// a static snapshot.
function buildGrid(root, puzzle, cells, interactive) {
  const n = puzzle.size;
  const trees = treeSet(puzzle);
  root.style.setProperty("--n", n);
  root.innerHTML = "";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const idx = r * n + c;
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.dataset.idx = idx;
      if (trees.has(idx)) {
        cell.classList.add("tree");
        cell.innerHTML = treeSVG();
      } else {
        cell.classList.add("plot");
        paintCell(cell, cells[idx]);
      }
      root.appendChild(cell);
    }
    // Row clue at the end of the row.
    const rc = document.createElement("div");
    rc.className = "clue clue-row";
    rc.dataset.row = r;
    rc.textContent = puzzle.rowClues[r];
    root.appendChild(rc);
  }
  // Bottom row: column clues, then an empty corner.
  for (let c = 0; c < n; c++) {
    const cc = document.createElement("div");
    cc.className = "clue clue-col";
    cc.dataset.col = c;
    cc.textContent = puzzle.colClues[c];
    root.appendChild(cc);
  }
  const corner = document.createElement("div");
  corner.className = "clue corner";
  root.appendChild(corner);

  if (interactive) wireBoardInput(root);
}

function paintCell(cell, state) {
  cell.classList.toggle("is-tent", state === TENT);
  cell.classList.toggle("is-grass", state === GRASS);
  cell.innerHTML = state === TENT ? tentSVG() : state === GRASS ? grassSVG() : "";
}

// Update one cell's state and its DOM. `repaint` false defers the visual update
// to the caller (used during a drag where we batch a state refresh after).
function setCell(idx, state) {
  if (game.cells[idx] === state) return;
  game.cells[idx] = state;
  const cell = document.querySelector(`#board .cell[data-idx="${idx}"]`);
  if (cell) paintCell(cell, state);
}

/* --- Input: pointer (mouse + touch) ----------------------------------------
 * Tap a cell        -> cycle its state: empty -> grass (✗) -> tent -> empty.
 *                      (One tap marks grass, a second makes it a tent — with no
 *                      time limit, so coming back to an ✗ later and tapping it
 *                      promotes it to a tent.)
 * Press and drag    -> paint grass across every plot cell you pass over.
 * Tapping a tree    -> nothing.
 * Tapping a clue    -> fill the rest of that row/column with grass. */
const DRAG_THRESHOLD = 8;   // px of movement before a press becomes a drag

// The tap cycle, kept in one place.
function nextCellState(cur) {
  return cur === EMPTY ? GRASS : cur === GRASS ? TENT : EMPTY;
}

function plotCellAt(x, y) {
  const el = document.elementFromPoint(x, y);
  return el && el.closest ? el.closest("#board .cell.plot") : null;
}

function wireBoardInput(root) {
  let p = null;                 // active pointer gesture

  root.addEventListener("contextmenu", (e) => e.preventDefault());

  root.addEventListener("pointerdown", (e) => {
    if (e.button != null && e.button !== 0 && e.pointerType === "mouse") return;
    const clue = e.target.closest(".clue-row, .clue-col");
    if (clue) { onClueClick(clue); return; }
    const cell = e.target.closest(".cell.plot");
    if (!cell) return;          // trees and gaps do nothing
    e.preventDefault();
    try { root.setPointerCapture(e.pointerId); } catch {}
    p = { id: e.pointerId, startIdx: +cell.dataset.idx, x: e.clientX, y: e.clientY,
          dragged: false, painted: new Set() };
  });

  root.addEventListener("pointermove", (e) => {
    if (!p || e.pointerId !== p.id) return;
    if (!p.dragged && Math.hypot(e.clientX - p.x, e.clientY - p.y) < DRAG_THRESHOLD) return;
    if (!p.dragged) {           // entering drag: also mark the start cell
      p.dragged = true;
      setCell(p.startIdx, GRASS);
      p.painted.add(p.startIdx);
    }
    const cell = plotCellAt(e.clientX, e.clientY);
    if (!cell) return;
    const idx = +cell.dataset.idx;
    if (!p.painted.has(idx)) { setCell(idx, GRASS); p.painted.add(idx); }
  });

  const endGesture = (e) => {
    if (!p || e.pointerId !== p.id) return;
    try { root.releasePointerCapture(e.pointerId); } catch {}
    if (!p.dragged) {
      // A plain tap cycles the cell through empty -> grass -> tent -> empty.
      setCell(p.startIdx, nextCellState(game.cells[p.startIdx]));
    }
    p = null;
    afterChange();
  };
  root.addEventListener("pointerup", endGesture);
  root.addEventListener("pointercancel", endGesture);
}

// Clicking a clue toggles its line's grass: if any cell is still empty, fill the
// empties with grass; otherwise (everything already grassed) lift the grass back
// to empty. Trees and tents are always left untouched.
function onClueClick(clueEl) {
  const n = game.n;
  const indices = [];
  if (clueEl.classList.contains("clue-row")) {
    const r = +clueEl.dataset.row;
    for (let c = 0; c < n; c++) indices.push(r * n + c);
  } else {
    const c = +clueEl.dataset.col;
    for (let r = 0; r < n; r++) indices.push(r * n + c);
  }
  const open = indices.filter((idx) => !game.trees.has(idx) && game.cells[idx] === EMPTY);
  if (open.length) {
    for (const idx of open) setCell(idx, GRASS);          // fill empties with ✗
  } else {
    for (const idx of indices) {
      if (game.cells[idx] === GRASS) setCell(idx, EMPTY); // clear ✗, keep tents
    }
  }
  afterChange();
}

function afterChange() {
  saveProgress(game.mode, game.cells);
  refreshState();
  checkWin();
}

// Recolour clues and flag rule-breaking tents.
//   * clue ok (green) when its tent count equals the clue;
//   * clue over (red) when it exceeds it;
//   * clue done (greyed) when the line is fully settled — count met and no
//     empty cells left, so there's nothing more to decide there;
//   * a tent touching another tent (any of 8 neighbours) is flagged red.
function refreshState() {
  const n = game.n;
  const rowTents = new Array(n).fill(0), colTents = new Array(n).fill(0);
  const rowEmpty = new Array(n).fill(0), colEmpty = new Array(n).fill(0);
  for (let i = 0; i < game.cells.length; i++) {
    const r = (i / n) | 0, c = i % n;
    if (game.cells[i] === TENT) { rowTents[r]++; colTents[c]++; }
    else if (game.cells[i] === EMPTY && !game.trees.has(i)) { rowEmpty[r]++; colEmpty[c]++; }
  }
  document.querySelectorAll("#board .clue-row").forEach((el) => {
    const r = +el.dataset.row, clue = game.puzzle.rowClues[r];
    el.classList.toggle("over", rowTents[r] > clue);
    el.classList.toggle("ok", rowTents[r] === clue && rowEmpty[r] > 0);
    el.classList.toggle("done", rowTents[r] === clue && rowEmpty[r] === 0);
  });
  document.querySelectorAll("#board .clue-col").forEach((el) => {
    const c = +el.dataset.col, clue = game.puzzle.colClues[c];
    el.classList.toggle("over", colTents[c] > clue);
    el.classList.toggle("ok", colTents[c] === clue && colEmpty[c] > 0);
    el.classList.toggle("done", colTents[c] === clue && colEmpty[c] === 0);
  });

  // Flag tents that illegally touch another tent.
  for (let i = 0; i < game.cells.length; i++) {
    if (game.cells[i] !== TENT) continue;
    const r = (i / n) | 0, c = i % n;
    let bad = false;
    for (let dr = -1; dr <= 1 && !bad; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || rr >= n || cc < 0 || cc >= n) continue;
        if (game.cells[rr * n + cc] === TENT) { bad = true; break; }
      }
    }
    const cell = document.querySelector(`#board .cell[data-idx="${i}"]`);
    if (cell) cell.classList.toggle("conflict", bad);
  }

  // Tent counter in the game bar.
  const placed = rowTents.reduce((a, b) => a + b, 0);
  const pill = document.querySelector("#progress-pill");
  if (pill) pill.textContent = `⛺ ${placed} / ${game.solution.size}`;
}

// A win is exactly the unique solution: the set of tent cells equals it. (Since
// every puzzle has a single solution, set equality is the correct check.)
function checkWin() {
  const placed = [];
  for (let i = 0; i < game.cells.length; i++) if (game.cells[i] === TENT) placed.push(i);
  if (placed.length !== game.solution.size) return;
  if (!placed.every((i) => game.solution.has(i))) return;
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
  // Best-effort leaderboard submission (a quiet no-op if not configured).
  const user = window.AbodesUser.getOrCreateUser();
  window.Leaderboard?.submitScore?.({
    userId: user.id, name: user.name, date: result.date, seconds: result.seconds, mode,
  });
  renderResults(mode, result, false);
}

function stopGame() {
  if (game && game.tickId) { clearInterval(game.tickId); game.tickId = null; }
}

/* ===========================================================================
 * Results + share
 * ========================================================================= */
function renderResults(mode, result, replay) {
  $("#results-title").textContent =
    (replay ? "Already solved" : "Solved") + ` — ${MODES[mode].title}`;
  $("#final-time").textContent = fmtElapsed(result.seconds);

  // Show the finished board (trees + solution tents) as a static snapshot.
  const puzzle = dailyPuzzle(mode);
  const n = puzzle.size;
  const solvedCells = new Array(n * n).fill(EMPTY);
  for (const [r, c] of puzzle.tents) solvedCells[r * n + c] = TENT;
  const board = $("#solved-board");
  board.classList.toggle("big", n > 10);
  buildGrid(board, puzzle, solvedCells, /*interactive*/ false);

  showView("results");
}

// Spoiler-free share text: date + each solved mode's time + streak. Never the
// layout. Both modes are listed if both were solved today.
function buildShareText() {
  const lines = [`Abodes — ${dateKey()}`];
  for (const mode of MODE_ORDER) {
    const res = loadResult(mode);
    if (res) lines.push(`${MODES[mode].boardLabel}: ⛺ ${fmtElapsed(res.seconds)}`);
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
  const user = window.AbodesUser.getOrCreateUser();
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

  // Mini preview art on each menu card.
  const normalArt = document.querySelector('[data-art="normal"]');
  const hardArt = document.querySelector('[data-art="hard"]');
  if (normalArt) normalArt.innerHTML = `${treeSVG()}${tentSVG()}${treeSVG()}`;
  if (hardArt) hardArt.innerHTML = `${tentSVG()}${treeSVG()}${tentSVG()}${treeSVG()}`;
}

function promptForName() {
  const cur = window.AbodesUser.getOrCreateUser().name;
  const next = window.prompt("Pick a username (or leave blank to randomize):", cur);
  if (next === null) return;
  const name = next.trim() ? next : window.AbodesUser.randomBirdName();
  window.AbodesUser.setUserName(name);
  refreshMenu();
}

function escapeHtml(s) {
  return String(s).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
}

// One leaderboard panel: players ranked by fastest time (lowest seconds first).
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

// One mode's leaderboard: a heading plus Today / Yesterday panels. `today` and
// `yest` are that mode's row arrays (or null when the fetch failed).
function renderModeGroup(label, today, yest, myId) {
  return `<div class="board-group">` +
         `<h2 class="board-group-title">${label}</h2>` +
         renderBoardPanel("Today", today, myId) +
         renderBoardPanel("Yesterday", yest, myId) +
         `</div>`;
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
  const myId = window.AbodesUser.getOrCreateUser().id;
  // fetchBoard returns { normal: [...], hard: [...] } for a date, or null.
  const [today, yest] = await Promise.all([
    window.Leaderboard.fetchBoard(dateKeyOffset(0)),
    window.Leaderboard.fetchBoard(dateKeyOffset(1)),
  ]);
  root.innerHTML =
    renderModeGroup("Normal", today && today.normal, yest && yest.normal, myId) +
    renderModeGroup("Hard", today && today.hard, yest && yest.hard, myId);
}

// Small illustrative boards in the How-to-play dropdown. Each spec is a grid of
// chars: 'O' tree, 'A' tent, 'x' grass, '.' empty; a '!' suffix on a tent marks
// it as the rule-breaker (drawn red).
function miniBoard(rows) {
  const cells = rows.flatMap((row) => row.split(" ")).map((tok) => {
    if (tok === "O") return `<div class="mini-cell tree">${treeSVG()}</div>`;
    if (tok === "A") return `<div class="mini-cell">${tentSVG()}</div>`;
    if (tok === "A!") return `<div class="mini-cell conflict">${tentSVG()}</div>`;
    if (tok === "x") return `<div class="mini-cell grass">${grassSVG()}</div>`;
    return `<div class="mini-cell"></div>`;
  }).join("");
  return `<div class="mini-board" style="--m:${rows[0].split(" ").length}">${cells}</div>`;
}

function buildRulesDiagrams() {
  const box = $("#rules-diagrams");
  if (!box) return;
  const ex = (cls, board, label) =>
    `<figure class="dia ${cls}">${board}<figcaption>${label}</figcaption></figure>`;
  box.innerHTML =
    ex("good", miniBoard(["O A .", ". . .", ". . ."]), "✓ One tent beside its tree") +
    ex("bad", miniBoard([". O .", ". A! .", "O A! ."]), "✗ Tents can't touch each other") +
    ex("bad", miniBoard(["O . .", ". A! .", ". . ."]), "✗ A tent must be directly beside a tree");
}

function init() {
  window.AbodesUser.getOrCreateUser();
  refreshMenu();

  document.querySelectorAll(".mode-card[data-mode]").forEach((card) => {
    card.addEventListener("click", () => startGame(card.dataset.mode));
  });
  $("#home-btn").addEventListener("click", () => { stopGame(); refreshMenu(); showView("menu"); });
  $("#results-menu-btn").addEventListener("click", () => { refreshMenu(); showView("menu"); });
  $("#board-menu-btn").addEventListener("click", () => { refreshMenu(); showView("menu"); });
  $("#name-btn").addEventListener("click", promptForName);
  $("#menu-board-btn").addEventListener("click", showLeaderboard);
  buildRulesDiagrams();
  $("#menu-rules-btn").addEventListener("click", () => {
    const box = $("#rules-box");
    const open = box.hidden;
    box.hidden = !open;
    $("#menu-rules-btn").setAttribute("aria-expanded", String(open));
    $("#menu-rules-btn").classList.toggle("open", open);
  });
  $("#clear-btn").addEventListener("click", () => {
    if (!game) return;
    game.cells.fill(EMPTY);
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
