"use strict";

/* Firebase web config for the Games hub's "yesterday's top 3" board.
 *
 * These values are PUBLIC by design — Firebase ships the web config in client
 * code; access is controlled by Firestore security rules, not by hiding this.
 * The hub only ever READS (reads are open on both games' score collections), so
 * it never writes anything. Same project the two games already use. */
window.GamesFirebaseConfig = {
  apiKey: "AIzaSyCgToe9-LrOGDEidVBiYjm0OrgjJPmoyWk",
  authDomain: "word-split-e8586.firebaseapp.com",
  projectId: "word-split-e8586",
  storageBucket: "word-split-e8586.firebasestorage.app",
  messagingSenderId: "640816539528",
  appId: "1:640816539528:web:5f63ae9a7ab0081be3fc3d",
};
