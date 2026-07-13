/* Leaderboard wiring (ES module).
 *
 * Loads the Firebase web SDK from a CDN on demand. If `window.FIREBASE_CONFIG`
 * is null, every call here no-ops; the UI checks `Leaderboard.configured` and
 * shows a "leaderboard not configured" message rather than failing.
 *
 * Score documents live in a single top-level `scores` collection. The doc ID
 * is `${userId}_${date}_${mode}` so each player has one row per mode per day;
 * Firestore rules (see README) forbid update/delete to preserve the honor
 * system. Today + yesterday are queried separately with a date-equality where
 * clause, then split into Combos / Forks in the app — that avoids needing a
 * composite Firestore index for setup.
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getFirestore, collection, doc, setDoc, query, where, limit, getDocs,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const cfg = window.FIREBASE_CONFIG;
let db = null;

if (cfg) {
  try {
    const app = initializeApp(cfg);
    db = getFirestore(app);
  } catch (e) {
    console.warn("Firebase init failed:", e);
  }
}

async function submitScore({ userId, name, date, mode, score }) {
  if (!db) return false;
  try {
    const id = `${userId}_${date}_${mode}`;
    await setDoc(doc(db, "scores", id), {
      userId, name, date, mode, score, ts: Date.now(),
    });
    return true;
  } catch (e) {
    console.warn("submitScore failed:", e);
    return false;
  }
}

// Single-day fetch, split into modes locally. Returns
// { combos: [{name, score, userId}, ...], forks: [...] } sorted desc by score.
async function fetchBoard(date, maxPerMode = 50) {
  if (!db) return null;
  try {
    const q = query(collection(db, "scores"), where("date", "==", date), limit(500));
    const snap = await getDocs(q);
    const rows = snap.docs.map((d) => d.data());
    const byMode = (m) => rows
      .filter((r) => r.mode === m)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxPerMode);
    return { combos: byMode("combos"), forks: byMode("forks") };
  } catch (e) {
    console.warn("fetchBoard failed:", e);
    return null;
  }
}

window.Leaderboard = {
  configured: !!db,
  submitScore,
  fetchBoard,
};
