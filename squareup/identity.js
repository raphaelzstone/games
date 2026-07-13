"use strict";

/* Shared player identity for the whole arcade.
 *
 * Every game reads and writes the same localStorage key (`games:user`), so the
 * bird name you pick on the hub is the name you have in Abodes and Word Split
 * (and vice-versa). Names live in localStorage, never in the code, so shipping
 * updates never resets them — the only thing that would is renaming this key,
 * which is why the games all agree on `games:user` and migrate the older
 * per-game keys once, here, on first load.
 *
 * This mirrors each game's own identity module (they carry the same logic so
 * they keep working when opened directly); the hub additionally migrates from
 * BOTH games' legacy keys. */

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
];

function randomBirdName() {
  const a = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const b = BIRDS[Math.floor(Math.random() * BIRDS.length)];
  return a + b;
}
function randomUserId() {
  return "u_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

const USER_KEY = "games:user";
const LEGACY_KEYS = [];

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
function setUserName(name) {
  const trimmed = String(name || "").trim().replace(/\s+/g, " ").slice(0, 20);
  if (!trimmed) return getOrCreateUser();
  const u = getOrCreateUser();
  u.name = trimmed;
  saveUser(u);
  return u;
}

window.SquareUpUser = { getOrCreateUser, setUserName, randomBirdName };
