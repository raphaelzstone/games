/* Forks leaderboard — daily highest-score rankings, backed by Firestore.
 *
 * Loaded as an ES module so it can import the Firebase modular SDK from the CDN.
 * Exposes the window.Leaderboard interface app.js expects:
 *   - configured     true once Firebase initialised from window.ForksFirebaseConfig
 *   - submitScore()  best-effort write of one (user, date) -> score result
 *   - fetchBoard()   read all results for a date (app.js sorts by highest score)
 *
 * Scores live in their own collection (forks_scores), keyed by
 * `${date}_${userId}`, so there's one row per player per day and Forks never
 * touches any other game's data. Every call degrades to a quiet no-op on
 * failure — the local game is always the source of truth. */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, collection, doc, setDoc, getDocs, query, where, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const COLLECTION = "forks_scores";

let db = null;
const cfg = window.ForksFirebaseConfig;
if (cfg && cfg.apiKey) {
  try { db = getFirestore(initializeApp(cfg)); }
  catch (e) { console.warn("Forks leaderboard: Firebase init failed", e); }
}

async function submitScore({ userId, name, date, score }) {
  if (!db) return;
  try {
    await setDoc(doc(db, COLLECTION, `${date}_${userId}`), {
      userId, name, date, score, createdAt: serverTimestamp(),
    });
  } catch (e) {
    console.warn("Forks leaderboard: submit failed", e);
  }
}

// Returns an array of { userId, name, date, score } for the day, or null on
// failure. Sorting is left to the caller. One `where` keeps this on Firestore's
// automatic single-field index — no composite index to set up.
async function fetchBoard(date) {
  if (!db) return null;
  try {
    const snap = await getDocs(query(collection(db, COLLECTION), where("date", "==", date)));
    return snap.docs.map((d) => d.data());
  } catch (e) {
    console.warn("Forks leaderboard: fetch failed", e);
    return null;
  }
}

window.Leaderboard = { configured: !!db, submitScore, fetchBoard };
