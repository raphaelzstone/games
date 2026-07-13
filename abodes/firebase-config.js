"use strict";

/* Firebase web config for the Abodes leaderboard.
 *
 * These values are PUBLIC by design — Firebase expects the web config to ship in
 * client code. They are not secrets; access is controlled by Firestore security
 * rules (see README), not by hiding this config.
 *
 * This currently points at the shared "word-split" Firebase project; Abodes
 * scores live in their own Firestore collection (abodes_scores), so the two
 * games never mix. To give Abodes its own project later, just paste a different
 * project's web config here — nothing else changes. */
window.AbodesFirebaseConfig = {
  apiKey: "AIzaSyCgToe9-LrOGDEidVBiYjm0OrgjJPmoyWk",
  authDomain: "word-split-e8586.firebaseapp.com",
  projectId: "word-split-e8586",
  storageBucket: "word-split-e8586.firebasestorage.app",
  messagingSenderId: "640816539528",
  appId: "1:640816539528:web:5f63ae9a7ab0081be3fc3d",
};
