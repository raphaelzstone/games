/* Grader leaderboard — daily fastest-solve rankings, backed by Firestore.
 *
 * Loaded as an ES module so it can import the Firebase modular SDK from the CDN.
 * It exposes the same `window.Leaderboard` interface app.js expects:
 *   - configured     true once Firebase initialised from window.GraderFirebaseConfig
 *   - submitScore()  best-effort write of one (user, date, mode) -> seconds result
 *   - fetchBoard()   read a date's results, split into { easy, hard }
 *
 * Grader has two daily modes (easy + hard), each with its own leaderboard.
 * Scores live in their own collection (grader_scores), keyed by
 * `${date}_${userId}_${mode}`, so there's one row per player per mode per day
 * and Grader never touches any other game's data. A single date-equality
 * query pulls the day's rows and they're split by `mode` in the client, so no
 * composite index is needed. Every call is wrapped so a network/Firebase
 * failure degrades to a quiet no-op — the local game is always the source of
 * truth. */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, collection, doc, setDoc, getDocs, query, where, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const COLLECTION = "grader_scores";

let db = null;
const cfg = window.GraderFirebaseConfig;
if (cfg && cfg.apiKey) {
  try {
    db = getFirestore(initializeApp(cfg));
  } catch (e) {
    console.warn("Grader leaderboard: Firebase init failed", e);
  }
}

async function submitScore({ userId, name, date, seconds, mode }) {
  if (!db) return;
  try {
    await setDoc(doc(db, COLLECTION, `${date}_${userId}_${mode}`), {
      userId, name, date, seconds, mode, createdAt: serverTimestamp(),
    });
  } catch (e) {
    console.warn("Grader leaderboard: submit failed", e);
  }
}

// Returns { easy: [...rows], hard: [...rows] } for the day, or null on
// failure; each row is { userId, name, date, seconds, mode }. Sorting is left
// to the caller. The single `where` keeps this on Firestore's automatic
// single-field index — no composite index to set up.
async function fetchBoard(date) {
  if (!db) return null;
  try {
    const snap = await getDocs(query(collection(db, COLLECTION), where("date", "==", date)));
    const rows = snap.docs.map((d) => d.data());
    const out = { easy: [], hard: [] };
    for (const r of rows) (r.mode === "hard" ? out.hard : out.easy).push(r);
    return out;
  } catch (e) {
    console.warn("Grader leaderboard: fetch failed", e);
    return null;
  }
}

window.Leaderboard = { configured: !!db, submitScore, fetchBoard };
