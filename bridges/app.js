"use strict";

/* ===========================================================================
 * Bridges — a daily bridge-building logic puzzle (vanilla JS).
 *
 * One puzzle per mode per day, the same for everyone (date-seeded pick from
 * the pre-verified pools in puzzles.js / puzzles-hard.js). Join the numbered
 * islands with horizontal or vertical bridges so every island has exactly as
 * many bridges as its number, no pair has more than two, no bridges cross, and
 * all the islands form one connected group. Every shipped puzzle is solvable
 * by pure logic, no guessing (see generate.py).
 *
 * Count-up timer; your time is the score (lower is better). Results persist
 * per day and copy as a spoiler-free summary.
 * ========================================================================= */

const MODES = {
  easy: { key: "easy", title: "Today's Bridges", boardLabel: "Easy", seed: "bridges" },
  hard: { key: "hard", title: "Hard Bridges",    boardLabel: "Hard", seed: "bridges-hard" },
};
const MODE_ORDER = ["easy", "hard"];
function poolFor(mode) { return mode === "hard" ? BRIDGES_PUZZLES_HARD : BRIDGES_PUZZLES; }

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
  const day = gameDayNumber();
  const pos = ((day % idx.length) + idx.length) % idx.length;
  return pool[idx[pos]];
}

function dateKey(d = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
    .formatToParts(d).reduce((out, part) => ({ ...out, [part.type]: part.value }), {});
  const logicalDay = Date.UTC(+parts.year, +parts.month - 1, +parts.day) - (+parts.hour < 5 ? 86400000 : 0);
  return new Date(logicalDay).toISOString().slice(0, 10);
}
function dateKeyOffset(days) {
  return dateKey(new Date(Date.now() - days * 86400000));
}
function gameDayNumber() { return Math.floor((Date.parse(`${dateKey()}T00:00:00Z`) - Date.UTC(2026, 0, 1)) / 86400000); }
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
const resultKey = (mode) => `bridges:${mode}:${dateKey()}`;
const progressKey = (mode) => `bridges:progress:${mode}:${dateKey()}`;

function loadResult(mode) {
  try { return JSON.parse(localStorage.getItem(resultKey(mode)) || "null"); }
  catch { return null; }
}
function saveResult(mode, result) {
  try { localStorage.setItem(resultKey(mode), JSON.stringify(result)); }
  catch { /* storage unavailable — game still works */ }
}
function saveProgress(mode, vals, elapsed) {
  try { localStorage.setItem(progressKey(mode), JSON.stringify({ vals, elapsed: elapsed || 0 })); }
  catch {}
}
function loadProgress(mode) {
  try { return JSON.parse(localStorage.getItem(progressKey(mode)) || "null"); }
  catch { return null; }
}
function clearProgress(mode) {
  try { localStorage.removeItem(progressKey(mode)); } catch {}
}

// --- Streak -----------------------------------------------------------------
const STREAK_KEY = "bridges:streak";
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
 * Puzzle geometry
 *
 * The connection list is derived from the island layout (each island to the
 * nearest island to its right and below), so it's the same on every load and
 * a saved progress array of per-connection bridge counts stays valid.
 * ========================================================================= */
function buildGeometry(puzzle) {
  // Boards are cropped to their islands, so they can be rectangular.
  const w = puzzle.w ?? puzzle.n, h = puzzle.h ?? puzzle.n;
  const isl = puzzle.islands.map(([r, c, need]) => ({ r, c, need }));
  const at = new Map(isl.map((s, i) => [s.r * 100 + s.c, i]));
  const edges = [];
  const pairIndex = new Map();
  isl.forEach((s, i) => {
    for (const [dr, dc] of [[0, 1], [1, 0]]) {
      let r = s.r + dr, c = s.c + dc;
      while (r < h && c < w) {
        const j = at.get(r * 100 + c);
        if (j != null) {
          const e = edges.length;
          edges.push({ a: i, b: j, horiz: dr === 0 });
          pairIndex.set(i * 1000 + j, e);
          pairIndex.set(j * 1000 + i, e);
          break;
        }
        r += dr; c += dc;
      }
    }
  });
  // Two connections cross when a horizontal one's row lies strictly inside a
  // vertical one's span and vice versa.
  const cross = edges.map(() => []);
  edges.forEach((e, x) => {
    if (!e.horiz) return;
    const r = isl[e.a].r, c1 = isl[e.a].c, c2 = isl[e.b].c;
    edges.forEach((f, y) => {
      if (f.horiz) return;
      const c = isl[f.a].c, r1 = isl[f.a].r, r2 = isl[f.b].r;
      if (r1 < r && r < r2 && c1 < c && c < c2) { cross[x].push(y); cross[y].push(x); }
    });
  });
  const inc = isl.map(() => []);
  edges.forEach((e, x) => { inc[e.a].push(x); inc[e.b].push(x); });
  return { w, h, isl, edges, cross, inc, pairIndex };
}

function solutionVals(puzzle, geo) {
  const vals = new Array(geo.edges.length).fill(0);
  for (const [i, j, k] of puzzle.sol) vals[geo.pairIndex.get(i * 1000 + j)] = k;
  return vals;
}

function islandCounts(geo, vals) {
  const cnt = geo.isl.map(() => 0);
  geo.edges.forEach((e, x) => { cnt[e.a] += vals[x]; cnt[e.b] += vals[x]; });
  return cnt;
}

function allConnected(geo, vals) {
  const seen = new Set([0]);
  const stack = [0];
  while (stack.length) {
    const v = stack.pop();
    for (const x of geo.inc[v]) {
      if (!vals[x]) continue;
      const w = geo.edges[x].a === v ? geo.edges[x].b : geo.edges[x].a;
      if (!seen.has(w)) { seen.add(w); stack.push(w); }
    }
  }
  return seen.size === geo.isl.length;
}

/* ===========================================================================
 * Game state
 * ========================================================================= */
let game = null;

function startGame(mode) {
  const existing = loadResult(mode);
  if (existing) { renderResults(mode, existing, /*replay*/ true); return; }

  const puzzle = dailyPuzzle(mode);
  const geo = buildGeometry(puzzle);
  const vals = new Array(geo.edges.length).fill(0);
  const saved = loadProgress(mode);
  let startedAt = Date.now();
  if (saved && Array.isArray(saved.vals) && saved.vals.length === vals.length) {
    for (let i = 0; i < vals.length; i++) vals[i] = [0, 1, 2].includes(saved.vals[i]) ? saved.vals[i] : 0;
    // Resume from the frozen elapsed time; time away doesn't count.
    startedAt = Date.now() - (saved.elapsed || 0) * 1000;
  }
  game = {
    mode, puzzle, geo, vals,
    selected: null,   // index of the selected island, or null
    ansatzActive: false,
    ansatzStart: null,
    history: [],
    startedAt,
    tickId: null,
    lastPersist: 0,
  };
  showView("game");
  $("#game-mode-label").textContent = MODES[mode].title;
  updateAnsatzControls();
  renderBoard();
  updateUndoButton();
  game.tickId = setInterval(updateTimer, 250);
  updateTimer();
}

function elapsedSec() {
  return game.paused ? game.frozenElapsed : (Date.now() - game.startedAt) / 1000;
}
function updateTimer() {
  $("#timer").textContent = fmtElapsed(elapsedSec());
  if (performance.now() - game.lastPersist > 5000) {
    game.lastPersist = performance.now();
    saveProgress(game.mode, game.vals, elapsedSec());
  }
}
function persistProgress() {
  if (game && game.tickId) saveProgress(game.mode, game.vals, elapsedSec());
}

// Backgrounding the tab stops the clock; it resumes when the tab is visible.
function pauseClock() {
  if (!game || !game.tickId || game.paused) return;
  game.frozenElapsed = elapsedSec();
  game.paused = true;
  clearInterval(game.tickId);
  game.tickId = null;
  saveProgress(game.mode, game.vals, game.frozenElapsed);
}
function resumeClock() {
  if (!game || !game.paused) return;
  game.paused = false;
  game.startedAt = Date.now() - game.frozenElapsed * 1000;
  game.tickId = setInterval(updateTimer, 250);
  updateTimer();
}

/* ===========================================================================
 * Rendering (SVG)
 *
 * The board is an SVG with 10 units per grid cell; island (r, c) is centered
 * at (c*10+5, r*10+5). Faint dots mark the empty grid points so distances are
 * easy to judge. Each connection that has bridges also gets a wide invisible
 * hit line so tapping a bridge cycles it.
 * ========================================================================= */
const U = 10, R_ISL = 3.9;
const cx = (s) => s.c * U + U / 2;
const cy = (s) => s.r * U + U / 2;

function bridgeLines(geo, x, k, cls) {
  const e = geo.edges[x];
  const A = geo.isl[e.a], B = geo.isl[e.b];
  const x1 = cx(A), y1 = cy(A), x2 = cx(B), y2 = cy(B);
  const offs = k === 2 ? [-1.05, 1.05] : [0];
  return offs.map((o) => e.horiz
    ? `<line class="${cls}" x1="${x1}" y1="${y1 + o}" x2="${x2}" y2="${y2 + o}"/>`
    : `<line class="${cls}" x1="${x1 + o}" y1="${y1}" x2="${x2 + o}" y2="${y2}"/>`).join("");
}

// opts: { interactive, ansatzBase (vals at Ansatz start, or null), refuted
// ({edge, val} or null), selected (island idx or null) }
function svgBoard(geo, vals, opts = {}) {
  const { w, h } = geo;
  const cnt = islandCounts(geo, vals);
  let s = `<svg class="bridges-svg" viewBox="0 0 ${w * U} ${h * U}" xmlns="http://www.w3.org/2000/svg">`;
  const occupied = new Set(geo.isl.map((t) => t.r * 100 + t.c));
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
    if (!occupied.has(r * 100 + c)) s += `<circle class="dot" cx="${c * U + U / 2}" cy="${r * U + U / 2}" r="0.55"/>`;
  }
  // Neighbors of the selected island get a soft ring, so you can see where a
  // bridge can go.
  const nbrs = new Set();
  if (opts.selected != null) {
    for (const x of geo.inc[opts.selected]) {
      const e = geo.edges[x];
      nbrs.add(e.a === opts.selected ? e.b : e.a);
    }
  }
  geo.edges.forEach((e, x) => {
    if (!vals[x]) return;
    const guess = opts.ansatzBase && vals[x] !== opts.ansatzBase[x];
    s += `<g class="bridge${guess ? " is-ansatz" : ""}" data-edge="${x}">`;
    s += bridgeLines(geo, x, vals[x], "b-line");
    if (opts.interactive) s += bridgeLines(geo, x, 1, "b-hit");
    s += `</g>`;
  });
  if (opts.refuted) {
    s += `<g class="refuted-bridge">${bridgeLines(geo, opts.refuted.edge, opts.refuted.val || 1, "r-line")}</g>`;
  }
  geo.isl.forEach((t, i) => {
    let cls = "island";
    if (cnt[i] === t.need) cls += " full";
    else if (cnt[i] > t.need) cls += " over";
    if (opts.selected === i) cls += " selected";
    else if (nbrs.has(i)) cls += " nbr";
    if (opts.refuted) {
      const e = geo.edges[opts.refuted.edge];
      if (e.a === i || e.b === i) cls += " refuted";
    }
    s += `<g class="${cls}" data-island="${i}">` +
      `<circle class="i-hit" cx="${cx(t)}" cy="${cy(t)}" r="${U / 2}"/>` +
      `<circle class="i-ring" cx="${cx(t)}" cy="${cy(t)}" r="${R_ISL}"/>` +
      `<text x="${cx(t)}" y="${cy(t)}" dy="0.35em">${t.need}</text></g>`;
  });
  return s + `</svg>`;
}

// Match the box to the board's shape (plus its padding) so nothing letterboxes.
function sizeBoard(el, geo) {
  el.style.aspectRatio = `${geo.w} / ${geo.h}`;
  el.classList.toggle("big", Math.max(geo.w, geo.h) > 8);
}

function currentRefuted() {
  const top = game.history[game.history.length - 1];
  return top && top.refuted ? top.refuted : null;
}

function renderBoard() {
  if (!game) return;  // the move that just ran may have finished the game
  const root = $("#board");
  sizeBoard(root, game.geo);
  root.innerHTML = svgBoard(game.geo, game.vals, {
    interactive: true,
    ansatzBase: game.ansatzActive ? game.ansatzStart.vals : null,
    refuted: currentRefuted(),
    selected: game.selected,
  });
  const cnt = islandCounts(game.geo, game.vals);
  const done = game.geo.isl.filter((t, i) => cnt[i] === t.need).length;
  $("#progress-pill").textContent = `${done} / ${game.geo.isl.length} islands`;
}

/* ===========================================================================
 * Moves, undo, Ansatz
 *
 * Every move is one entry on game.history: a list of {edge, prev} changes.
 * A discarded Ansatz becomes its own empty entry carrying `refuted` (the
 * first bridge you changed in it, and what you set it to). That bridge is
 * drawn highlighted only while that entry is the latest one: the next move
 * hides it, and undoing that move shows it again.
 * ========================================================================= */
function setEdge(x, k, batch) {
  if (game.vals[x] === k) return;
  if (game.ansatzActive && !game.ansatzStart.first) game.ansatzStart.first = { edge: x, val: k };
  batch.push({ edge: x, prev: game.vals[x] });
  game.vals[x] = k;
}

function commit(batch) {
  if (!batch.length) return;
  game.history.push(batch);
  saveProgress(game.mode, game.vals, elapsedSec());
  renderBoard();
  updateUndoButton();
  if (!game.ansatzActive) checkWin();
}

// Cycle a connection 0 -> 1 -> 2 -> 0. Adding a bridge that would cross an
// existing one is refused, and the blocking bridge flashes.
function cycleEdge(x) {
  const next = (game.vals[x] + 1) % 3;
  if (next > 0) {
    const blockers = game.geo.cross[x].filter((y) => game.vals[y] > 0);
    if (blockers.length) { flashBlocked(blockers); return; }
  }
  const batch = [];
  setEdge(x, next, batch);
  commit(batch);
}

function flashBlocked(edgeIdxs) {
  for (const y of edgeIdxs) {
    const g = document.querySelector(`#board .bridge[data-edge="${y}"]`);
    if (!g) continue;
    g.classList.remove("blocked");
    void g.getBoundingClientRect();
    g.classList.add("blocked");
  }
  const hint = $("#hint");
  hint.textContent = "Bridges can't cross.";
  hint.classList.add("show");
  clearTimeout(flashBlocked.t);
  flashBlocked.t = setTimeout(() => hint.classList.remove("show"), 1400);
}

function canUndo() {
  if (!game || !game.history.length) return false;
  return !game.ansatzActive || game.history.length > game.ansatzStart.historyLength;
}
function updateUndoButton() {
  $("#undo-btn").disabled = !canUndo();
}
function undoLastAction() {
  if (!canUndo()) return;
  const batch = game.history.pop();
  for (let i = batch.length - 1; i >= 0; i--) game.vals[batch[i].edge] = batch[i].prev;
  saveProgress(game.mode, game.vals, elapsedSec());
  renderBoard();
  updateUndoButton();
}

function updateAnsatzControls() {
  const active = !!game?.ansatzActive;
  $("#ansatz-toggle-btn").hidden = active;
  $("#verify-ansatz-btn").hidden = !active;
  $("#discard-ansatz-btn").hidden = !active;
  $("#board").classList.toggle("ansatz-on", active);
}
function beginAnsatz() {
  if (!game || game.ansatzActive) return;
  game.ansatzStart = { vals: game.vals.slice(), historyLength: game.history.length, first: null };
  game.ansatzActive = true;
  updateAnsatzControls();
  renderBoard();
  updateUndoButton();
}
function verifyAnsatz() {
  if (!game?.ansatzActive) return;
  game.ansatzActive = false;
  game.ansatzStart = null;
  updateAnsatzControls();
  renderBoard();
  updateUndoButton();
  saveProgress(game.mode, game.vals, elapsedSec());
  checkWin();
}
function discardAnsatz() {
  if (!game?.ansatzActive) return;
  const start = game.ansatzStart;
  game.vals = start.vals.slice();
  game.history.length = start.historyLength;
  if (start.first) {
    const turn = [];
    turn.refuted = start.first;
    game.history.push(turn);
  }
  game.ansatzActive = false;
  game.ansatzStart = null;
  game.selected = null;
  updateAnsatzControls();
  renderBoard();
  updateUndoButton();
  saveProgress(game.mode, game.vals, elapsedSec());
}

/* ===========================================================================
 * Input
 *
 * Tap an island        -> select it (its reachable neighbors get a ring).
 * Tap a neighbor       -> add a bridge between them (1 -> 2 -> none) and
 *                         clear the selection. Tap the pair again (or tap
 *                         the bridge) for a double.
 * Drag island->island  -> same as tapping the pair.
 * Tap a bridge         -> cycle it (single -> double -> none).
 * Tap empty water      -> deselect.
 * ========================================================================= */
const DRAG_THRESHOLD = 8;

function wireBoardInput() {
  const root = $("#board");
  let p = null;
  const islandAt = (x, y) => {
    const el = document.elementFromPoint(x, y);
    const g = el && el.closest && el.closest("#board .island");
    return g ? +g.dataset.island : null;
  };
  root.addEventListener("pointerdown", (e) => {
    if (!game || p) return;
    const g = e.target.closest(".island, .bridge");
    p = {
      id: e.pointerId, x: e.clientX, y: e.clientY, moved: false,
      island: g && g.classList.contains("island") ? +g.dataset.island : null,
      edge: g && g.classList.contains("bridge") ? +g.dataset.edge : null,
    };
    if (p.island != null) {
      e.preventDefault();
      try { root.setPointerCapture(e.pointerId); } catch {}
    }
  });
  root.addEventListener("pointermove", (e) => {
    if (!p || e.pointerId !== p.id) return;
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) >= DRAG_THRESHOLD) p.moved = true;
  });
  const end = (e, ok) => {
    if (!p || e.pointerId !== p.id) return;
    const g = p; p = null;
    if (!ok || !game) return;
    if (g.island != null && g.moved) {
      const to = islandAt(e.clientX, e.clientY);
      if (to != null && to !== g.island) {
        const x = game.geo.pairIndex.get(g.island * 1000 + to);
        if (x != null) { game.selected = null; cycleEdge(x); renderBoard(); }
      }
      return;
    }
    if (g.moved) return;
    if (g.island != null) tapIsland(g.island);
    else if (g.edge != null) cycleEdge(g.edge);
    else if (game.selected != null) { game.selected = null; renderBoard(); }
  };
  root.addEventListener("pointerup", (e) => end(e, true));
  root.addEventListener("pointercancel", (e) => end(e, false));
}

function tapIsland(i) {
  const sel = game.selected;
  if (sel === i) { game.selected = null; renderBoard(); return; }
  if (sel != null) {
    const x = game.geo.pairIndex.get(sel * 1000 + i);
    if (x != null) { game.selected = null; cycleEdge(x); renderBoard(); return; }
  }
  game.selected = i;
  renderBoard();
}

/* ===========================================================================
 * Win check, results
 * ========================================================================= */
function checkWin() {
  const cnt = islandCounts(game.geo, game.vals);
  if (!game.geo.isl.every((t, i) => cnt[i] === t.need)) return;
  for (let x = 0; x < game.vals.length; x++) {
    if (game.vals[x] && game.geo.cross[x].some((y) => game.vals[y])) return;
  }
  if (!allConnected(game.geo, game.vals)) {
    const hint = $("#hint");
    hint.textContent = "Every number fits, but the islands aren't all connected.";
    hint.classList.add("show");
    clearTimeout(flashBlocked.t);
    flashBlocked.t = setTimeout(() => hint.classList.remove("show"), 2600);
    return;
  }
  finishGame();
}

function finishGame() {
  if (game.tickId) { clearInterval(game.tickId); game.tickId = null; }
  const mode = game.mode;
  const result = { date: dateKey(), seconds: Math.max(1, Math.round(elapsedSec())), mode };
  saveResult(mode, result);
  clearProgress(mode);
  bumpStreak();
  const user = window.BridgesUser.getOrCreateUser();
  if (!user.anonymous) window.Leaderboard?.submitScore?.({
    userId: user.id, name: user.name, date: result.date, seconds: result.seconds, mode,
  });
  game = null;
  renderResults(mode, result, false);
}

function stopGame() {
  persistProgress();
  if (game && game.tickId) { clearInterval(game.tickId); game.tickId = null; }
  game = null;
}

function renderResults(mode, result, replay) {
  $("#results-title").textContent = (replay ? "Already solved" : "Solved") + ` — ${MODES[mode].title}`;
  $("#final-time").textContent = fmtElapsed(result.seconds);
  const puzzle = dailyPuzzle(mode);
  const geo = buildGeometry(puzzle);
  const board = $("#solved-board");
  sizeBoard(board, geo);
  board.innerHTML = svgBoard(geo, solutionVals(puzzle, geo));
  showView("results");
}

function buildShareText() {
  const lines = [`Bridges — ${dateKey()}`];
  for (const mode of MODE_ORDER) {
    const res = loadResult(mode);
    if (res) lines.push(`${MODES[mode].boardLabel}: 🌉 ${fmtElapsed(res.seconds)}`);
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
 * Menu, leaderboard, wiring
 * ========================================================================= */
function refreshMenu() {
  $("#date-label").textContent = dateKey();
  const user = window.BridgesUser.getOrCreateUser();
  $("#player-name").textContent = user.name;
  $("#anonymous-toggle").checked = !!user.anonymous;
  const streak = currentStreak();
  const streakEl = $("#streak");
  streakEl.textContent = streak >= 1 ? `🔥 ${streak} day${streak === 1 ? "" : "s"}` : "";
  streakEl.hidden = streak < 1;

  let anySolved = false;
  for (const mode of MODE_ORDER) {
    const res = loadResult(mode);
    if (res) anySolved = true;
    $(`#status-${mode}`).textContent = res
      ? `Solved today · ${fmtElapsed(res.seconds)}`
      : (loadProgress(mode) ? "In progress…" : "Not solved today");
  }
  $("#menu-share-btn").hidden = !anySolved;
}

function promptForName() {
  const cur = window.BridgesUser.getOrCreateUser().name;
  const next = window.prompt("Pick a username (or leave blank to randomize):", cur);
  if (next === null) return;
  const name = next.trim() ? next : window.BridgesUser.randomBirdName();
  window.BridgesUser.setUserName(name);
  refreshMenu();
}

function escapeHtml(s) {
  return String(s).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
}

function renderBoardPanel(title, rows, myId) {
  if (!rows) return `<div class="board-panel"><h3>${title}</h3><div class="board-empty">—</div></div>`;
  if (!rows.length) return `<div class="board-panel"><h3>${title}</h3><div class="board-empty">No times yet.</div></div>`;
  const lis = [...rows].sort((a, b) => a.seconds - b.seconds).map((r, i) => {
    const me = r.userId === myId ? " me" : "";
    return `<li class="board-row${me}"><span class="board-rank">${i + 1}</span>` +
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
  const myId = window.BridgesUser.getOrCreateUser().id;
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

// Small solved example for the How-to-play box (hand-made, 4x4).
function buildRulesDiagram() {
  const demo = {
    n: 4,
    islands: [[0, 0, 2], [0, 3, 3], [2, 1, 1], [2, 3, 3], [3, 0, 1]],
    sol: [[0, 1, 1], [1, 3, 2], [2, 3, 1], [0, 4, 1]],
  };
  const geo = buildGeometry(demo);
  $("#rules-diagram").innerHTML = svgBoard(geo, solutionVals(demo, geo));
}

function init() {
  window.BridgesUser.getOrCreateUser();
  refreshMenu();
  buildRulesDiagram();
  wireBoardInput();

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) pauseClock(); else resumeClock();
  });
  window.addEventListener("pagehide", pauseClock);

  document.querySelectorAll(".mode-card[data-mode]").forEach((card) => {
    card.addEventListener("click", () => startGame(card.dataset.mode));
  });
  $("#home-btn").addEventListener("click", () => { stopGame(); refreshMenu(); showView("menu"); });
  $("#results-menu-btn").addEventListener("click", () => { refreshMenu(); showView("menu"); });
  $("#board-menu-btn").addEventListener("click", () => { refreshMenu(); showView("menu"); });
  $("#name-btn").addEventListener("click", promptForName);
  $("#anonymous-toggle").addEventListener("change", (e) => { window.BridgesUser.setAnonymous(e.target.checked); refreshMenu(); });
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
    const batch = [];
    const floor = game.ansatzActive ? game.ansatzStart.vals : null;
    // Inside an Ansatz, clearing only removes the Ansatz's own bridges.
    for (let x = 0; x < game.vals.length; x++) setEdge(x, floor ? floor[x] : 0, batch);
    game.selected = null;
    commit(batch);
    renderBoard();
  });
  $("#ansatz-toggle-btn").addEventListener("click", beginAnsatz);
  $("#verify-ansatz-btn").addEventListener("click", verifyAnsatz);
  $("#discard-ansatz-btn").addEventListener("click", discardAnsatz);
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
