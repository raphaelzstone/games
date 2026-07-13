"use strict";

/* Firebase web config for the Staircases leaderboard. PUBLIC by design (Firebase
 * ships the web config in client code; access is controlled by Firestore rules).
 * Same shared project as the other games; Staircases scores live in their own
 * collection (staircases_scores). */
window.StaircasesFirebaseConfig = {
  apiKey: "AIzaSyCgToe9-LrOGDEidVBiYjm0OrgjJPmoyWk",
  authDomain: "word-split-e8586.firebaseapp.com",
  projectId: "word-split-e8586",
  storageBucket: "word-split-e8586.firebasestorage.app",
  messagingSenderId: "640816539528",
  appId: "1:640816539528:web:5f63ae9a7ab0081be3fc3d",
};
