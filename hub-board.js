/* Games hub — "yesterday's top 3" board (ES module).
 *
 * A small, unobtrusive strip on the landing page: one tab per subgame, each
 * showing the top three finishers from *yesterday*. It only reads Firestore
 * (reads are open on every collection), so no writes and no auth.
 *
 * Every game keeps its own Firestore collection:
 *   - Abodes      → `abodes_scores`, ranked by fastest time (seconds, lower
 *                    wins). Hard boards carry mode:"hard"; normal has no mode.
 *   - Combos      → `combos_scores`, ranked by points (score, higher wins).
 *   - Forks       → `forks_scores`, ranked by points (score, higher wins).
 *   - Staircases  → `staircases_scores`, ranked by points (score, higher wins).
 *   - Square Up   → `squareup_scores`, ranked by fastest time (currently
 *                    unlinked from the hub; see index.html).
 * Each collection is fetched once for yesterday's date, then sorted per tab
 * in the client — a single date-equality query, no composite index. */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, collection, query, where, getDocs,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Local date key (matches how both games stamp their scores), offset in days.
function dateKeyOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function fmtTime(sec) {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
function escapeHtml(s) {
  return String(s).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
}

// Each tab: which collection, which rows belong to it, and how it ranks.
const TABS = [
  { key: "abodes-normal", label: "Abodes 8×8", coll: "abodes_scores",
    match: (r) => (r.mode || "normal") === "normal",
    rank: (a, b) => a.seconds - b.seconds, value: (r) => fmtTime(r.seconds) },
  { key: "abodes-hard", label: "Abodes 14×14", coll: "abodes_scores",
    match: (r) => r.mode === "hard",
    rank: (a, b) => a.seconds - b.seconds, value: (r) => fmtTime(r.seconds) },
  { key: "combos", label: "Combos", coll: "combos_scores",
    match: () => true,
    rank: (a, b) => b.score - a.score, value: (r) => String(r.score) },
  { key: "forks", label: "Forks", coll: "forks_scores",
    match: () => true,
    rank: (a, b) => b.score - a.score, value: (r) => String(r.score) },
  { key: "staircases", label: "Staircases", coll: "staircases_scores",
    match: () => true,
    rank: (a, b) => b.score - a.score, value: (r) => String(r.score) },
  // Square Up is offline for now (see index.html) — its tab is pulled too so
  // the board doesn't show a leaderboard for a game you can't reach.
];
const MEDALS = ["①", "②", "③"];

// One collection failing (e.g. a brand-new game whose Firestore rule hasn't
// been added yet) must not blank every OTHER game's tab — so each fetch is
// caught independently and just degrades to an empty list, not a shared throw.
async function fetchCollection(db, coll, date) {
  try {
    const snap = await getDocs(query(collection(db, coll), where("date", "==", date)));
    return snap.docs.map((d) => d.data());
  } catch (e) {
    console.warn(`Games hub: fetching ${coll} failed`, e);
    return [];
  }
}

function podiumHtml(rows, tab) {
  if (!rows.length) return `<div class="mini-empty">No times yet.</div>`;
  const top = [...rows].sort(tab.rank).slice(0, 3);
  return `<ol class="mini-list">` + top.map((r, i) =>
    `<li class="mini-row">` +
      `<span class="mini-rank">${MEDALS[i]}</span>` +
      `<span class="mini-name">${escapeHtml(r.name || "—")}</span>` +
      `<span class="mini-score">${tab.value(r)}</span>` +
    `</li>`).join("") + `</ol>`;
}

async function init() {
  const section = document.getElementById("mini-board");
  const cfg = window.GamesFirebaseConfig;
  if (!section || !cfg || !cfg.apiKey) return;   // silently stay hidden

  let db;
  try { db = getFirestore(initializeApp(cfg)); }
  catch { return; }

  const date = dateKeyOffset(1);
  document.getElementById("mini-board-date").textContent = date;

  // Fetch each distinct collection the tabs need, once.
  const colls = [...new Set(TABS.map((t) => t.coll))];
  let byColl;
  try {
    const results = await Promise.all(colls.map((c) => fetchCollection(db, c, date)));
    byColl = Object.fromEntries(colls.map((c, i) => [c, results[i]]));
  } catch {
    return;   // network/Firestore hiccup — leave the strip hidden
  }

  const panels = TABS.map((t) => {
    const rows = (byColl[t.coll] || []).filter(t.match);
    return podiumHtml(rows, t);
  });

  document.getElementById("mini-tabs").innerHTML = TABS.map((t, i) =>
    `<button class="mini-tab${i === 0 ? " active" : ""}" data-i="${i}" role="tab">${t.label}</button>`
  ).join("");
  const panelBox = document.getElementById("mini-panels");
  panelBox.innerHTML = panels.map((p, i) =>
    `<div class="mini-panel${i === 0 ? " active" : ""}" data-i="${i}">${p}</div>`
  ).join("");

  document.getElementById("mini-tabs").addEventListener("click", (e) => {
    const btn = e.target.closest(".mini-tab");
    if (!btn) return;
    const i = btn.dataset.i;
    document.querySelectorAll(".mini-tab").forEach((b) => b.classList.toggle("active", b.dataset.i === i));
    panelBox.querySelectorAll(".mini-panel").forEach((p) => p.classList.toggle("active", p.dataset.i === i));
  });

  section.hidden = false;
}

init();
