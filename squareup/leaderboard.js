/* Square Up leaderboard — daily fastest-time rankings, backed by Firestore.
 *
 * Loaded as an ES module so it can import the Firebase modular SDK from the CDN.
 * Exposes the window.Leaderboard interface app.js expects:
 *   - configured     true once Firebase initialised from window.SquareUpFirebaseConfig
 *   - submitScore()  best-effort write of one (user, date) -> seconds result
 *   - fetchBoard()   read all results for a date (app.js sorts by fastest)
 *
 * Scores live in their own collection (squareup_scores), keyed by
 * `${date}_${userId}`, so there's one row per player per day and Square Up
 * never touches any other game's data. Every call degrades to a quiet no-op on
 * failure — the local game is always the source of truth. */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, collection, doc, setDoc, getDocs, query, where, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const COLLECTION = "squareup_scores";

let db = null;
const cfg = window.SquareUpFirebaseConfig;
if (cfg && cfg.apiKey) {
  try { db = getFirestore(initializeApp(cfg)); }
  catch (e) { console.warn("Square Up leaderboard: Firebase init failed", e); }
}

async function submitScore({ userId, name, date, seconds }) {
  if (!db) return;
  try {
    await setDoc(doc(db, COLLECTION, `${date}_${userId}`), {
      userId, name, date, seconds, createdAt: serverTimestamp(),
    });
  } catch (e) {
    console.warn("Square Up leaderboard: submit failed", e);
  }
}

async function fetchBoard(date) {
  if (!db) return null;
  try {
    const snap = await getDocs(query(collection(db, COLLECTION), where("date", "==", date)));
    return snap.docs.map((d) => d.data());
  } catch (e) {
    console.warn("Square Up leaderboard: fetch failed", e);
    return null;
  }
}

window.Leaderboard = { configured: !!db, submitScore, fetchBoard };
