"use strict";

/* ===========================================================================
 * Player identity — a bird name auto-assigned on first visit, kept across
 * sessions on the same device via localStorage, and editable from the menu.
 *
 * The userId is a random opaque string; the leaderboard uses (userId, date)
 * as the document key so each player has one score per day.
 * ========================================================================= */

const ADJECTIVES = [
  "Wise", "Bold", "Quiet", "Royal", "Silent", "Mighty", "Swift", "Wild",
  "Brave", "Fierce", "Noble", "Jolly", "Sleek", "Curious", "Clever", "Sunny",
  "Dapper", "Cosmic", "Lucky", "Cheery", "Plucky", "Crimson", "Golden",
  "Silver", "Velvet", "Misty", "Snowy", "Sleepy", "Quirky", "Zesty",
];

const BIRDS = [
  "Robin", "Sparrow", "Finch", "Owl", "Hawk", "Eagle", "Falcon", "Raven",
  "Crow", "Magpie", "Jay", "Cardinal", "Bluebird", "Oriole", "Swallow",
  "Swift", "Thrush", "Wren", "Chickadee", "Nuthatch", "Woodpecker",
  "Hummingbird", "Kingfisher", "Heron", "Egret", "Crane", "Stork", "Ibis",
  "Pelican", "Puffin", "Gull", "Tern", "Albatross", "Kestrel", "Osprey",
  "Condor", "Dove", "Pigeon", "Parrot", "Parakeet", "Cockatoo", "Macaw",
  "Toucan", "Hornbill", "Kookaburra", "Lyrebird", "Kiwi", "Peacock",
  "Pheasant", "Quail", "Partridge", "Grouse", "Duck", "Goose", "Swan",
  "Flamingo", "Penguin", "Plover", "Sandpiper", "Snipe", "Curlew", "Lark",
  "Warbler", "Vireo", "Tanager", "Grosbeak", "Junco", "Bunting", "Siskin",
  "Waxwing", "Mockingbird", "Catbird", "Starling", "Grackle", "Blackbird",
  "Meadowlark", "Hoopoe", "Cuckoo", "Cormorant", "Loon", "Grebe",
];

function randomBirdName() {
  const a = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const b = BIRDS[Math.floor(Math.random() * BIRDS.length)];
  return a + b;
}

function randomUserId() {
  return "u_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// One identity shared across every game in the arcade (all served from the
// same origin). Older single-game saves are migrated the first time a player
// opens a game, so nobody's existing bird name changes underfoot.
const USER_KEY = "games:user";
const LEGACY_KEYS = ["wordsplit:user"];

function loadUser() {
  try { return JSON.parse(localStorage.getItem(USER_KEY) || "null"); }
  catch { return null; }
}
function saveUser(u) {
  try { localStorage.setItem(USER_KEY, JSON.stringify(u)); } catch { /* ignore */ }
}
function migrateLegacyUser() {
  for (const k of LEGACY_KEYS) {
    try {
      const v = JSON.parse(localStorage.getItem(k) || "null");
      if (v && v.id && v.name) return v;
    } catch { /* ignore */ }
  }
  return null;
}

function getOrCreateUser() {
  let u = loadUser();
  if (!u || !u.id || !u.name) {
    u = migrateLegacyUser() || { id: randomUserId(), name: randomBirdName() };
    saveUser(u);
  }
  return u;
}

// Validate, trim, and persist a new name. Returns the user with the actual
// stored name (which may be a trimmed/clipped version of the requested one).
function setUserName(name) {
  const trimmed = String(name || "").trim().replace(/\s+/g, " ").slice(0, 20);
  if (!trimmed) return loadUser();
  const u = loadUser() || { id: randomUserId() };
  u.name = trimmed;
  saveUser(u);
  return u;
}

window.CombosUser = { getOrCreateUser, setUserName, randomBirdName };
