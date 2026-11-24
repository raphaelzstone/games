"use strict";

/* Firebase web config for the Bridges leaderboard.
 *
 * These values are PUBLIC by design — Firebase expects the web config to ship
 * in client code. They are not secrets; access is controlled by Firestore
 * security rules (see README), not by hiding this config.
 *
 * This currently points at the shared "word-split" Firebase project; Bridges
 * scores live in their own Firestore collection (bridges_scores), so the games
 * never mix. */
window.BridgesFirebaseConfig = {
  apiKey: "AIzaSyCgToe9-LrOGDEidVBiYjm0OrgjJPmoyWk",
  authDomain: "word-split-e8586.firebaseapp.com",
  projectId: "word-split-e8586",
  storageBucket: "word-split-e8586.firebasestorage.app",
  messagingSenderId: "640816539528",
  appId: "1:640816539528:web:5f63ae9a7ab0081be3fc3d",
};
