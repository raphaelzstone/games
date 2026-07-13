#!/usr/bin/env python3
"""Staircases — daily word puzzle generator.

Each puzzle hides one 3-letter string that "staircases" through four 6-letter
words. In row r (r = 0..3) the trigram occupies the three cells at columns
r..r+2; the other three cells are shown. Solve it by finding the single 3-letter
string that completes all four rows into real words. Example — trigram ART:

    . . . E R Y      (ART)ERY
    C . . . O N     C(ART)ON
    H E . . . H    HE(ART)H
    D E P . . .   DEP(ART)

We ship only puzzles with a UNIQUE solution: given the shown letters, exactly
one trigram completes all four rows against our word list. Output is puzzles.js
(global STAIRCASES_PUZZLES), each entry {"a": trigram, "w": [w0,w1,w2,w3]} with
w[r] carrying the trigram at offset r.

Vocabulary: 6-letter words that are (a) common enough by wordfreq Zipf frequency
and (b) real lowercase dictionary words (drops proper nouns / junk). The Zipf
floor is set a touch lower than Word Split's tier, for "slightly more obscure."

Run:  python3 generate.py [zipf_floor] [pool_size] [seed]
"""

import json
import random
import sys
import collections

try:
    from wordfreq import zipf_frequency, iter_wordlist
except ImportError:
    sys.exit("needs `pip install wordfreq` (offline generation only)")

# Offsets 0..3: the columns the shown (fixed) letters occupy for each row.
FIXED_POS = {0: (3, 4, 5), 1: (0, 4, 5), 2: (0, 1, 5), 3: (0, 1, 2)}

# A short blocklist so no daily answer or word is embarrassing. (Kept minimal;
# extend as needed.)
BLOCK = {
    "damn", "hell", "crap", "arse", "bitch", "bugger", "bloody", "tranny",
    "hooker", "boobs", "boozer", "wanker", "shitty", "pissed", "whores",
    "niggle",  # innocuous but avoid the look-alike root
}


def build_inflections(base):
    """Regular 6-letter inflections of a base word — web2 (a 1934 dictionary)
    lacks many common plurals/tenses, so we add them back. Proper nouns aren't
    inflections of dictionary words, so they stay excluded."""
    out = set()
    for suf in ("s", "es", "ed", "ing", "er", "est", "d", "r", "st"):
        out.add(base + suf)
    if base.endswith("e"):
        for suf in ("ing", "ed", "er", "est"):
            out.add(base[:-1] + suf)
    if base.endswith("y") and len(base) > 1 and base[-2] not in "aeiou":
        for suf in ("ies", "ied", "ier", "iest"):
            out.add(base[:-1] + suf)
    return {w for w in out if len(w) == 6 and w.isalpha()}


def load_proper_names():
    names = set()
    for path in ("/usr/share/dict/propernames",):
        try:
            with open(path) as f:
                for line in f:
                    names.add(line.strip().lower())
        except FileNotFoundError:
            pass
    return names


def load_allowlist():
    """Real dictionary words: web2's lowercase entries (drops proper nouns),
    expanded with regular 6-letter inflections web2 is missing."""
    base = set()
    try:
        with open("/usr/share/dict/web2") as f:
            for line in f:
                w = line.strip()
                if w.islower() and w.isalpha():
                    base.add(w)
    except FileNotFoundError:
        return None  # no dictionary — caller falls back to frequency only
    allow = {w for w in base if len(w) == 6}
    for b in base:
        if 3 <= len(b) <= 6:
            allow |= build_inflections(b)
    return allow


def load_words(zipf_floor):
    """Common, real, non-proper 6-letter words: in the dictionary allowlist AND
    common enough by wordfreq Zipf frequency. Proper names and a small profanity
    list are dropped outright."""
    allow = load_allowlist()
    names = load_proper_names()
    words = set()
    for w in iter_wordlist("en"):
        if len(w) == 6 and w.isalpha() and w.isascii() and w == w.lower():
            if w in BLOCK or w in names:
                continue
            if zipf_frequency(w, "en") < zipf_floor:
                continue
            if allow is not None and w not in allow:
                continue
            words.add(w)
    return words


def build_indexes(words):
    # by_offset[p][trigram] -> list of words with that trigram at offset p
    # fit[p][fixed_letters] -> set of trigrams that fit those shown letters
    by_offset = [collections.defaultdict(list) for _ in range(4)]
    fit = [collections.defaultdict(set) for _ in range(4)]
    for w in words:
        for p in range(4):
            trig = w[p:p + 3]
            by_offset[p][trig].append(w)
            fixed = tuple(w[j] for j in FIXED_POS[p])
            fit[p][fixed].add(trig)
    return by_offset, fit


def fixed_of(word, p):
    return tuple(word[j] for j in FIXED_POS[p])


def try_make(trig, by_offset, fit, rng, attempts=40):
    """Build a unique-solution puzzle for a trigram, or None."""
    # Candidate words per row, preferring the most constraining ones (smallest
    # fit set) so a unique intersection is easy to reach.
    cands = []
    for p in range(4):
        ws = by_offset[p].get(trig, [])
        if not ws:
            return None
        ws = sorted(ws, key=lambda w: len(fit[p][fixed_of(w, p)]))
        cands.append(ws)

    for _ in range(attempts):
        # Bias toward the tighter words but keep some randomness for variety.
        chosen = []
        for p in range(4):
            k = min(len(cands[p]), 6)
            chosen.append(rng.choice(cands[p][:k]))
        if len({w for w in chosen}) < 4:
            continue  # want four distinct words
        solution = None
        for p in range(4):
            s = fit[p][fixed_of(chosen[p], p)]
            solution = set(s) if solution is None else (solution & s)
            if len(solution) == 1 and solution != {trig}:
                break
        if solution == {trig}:
            return {"a": trig, "w": chosen}
    return None


def main():
    zipf_floor = float(sys.argv[1]) if len(sys.argv) > 1 else 2.3
    pool_size = int(sys.argv[2]) if len(sys.argv) > 2 else 1200
    seed = int(sys.argv[3]) if len(sys.argv) > 3 else 20260713
    per_trigram_cap = 3

    rng = random.Random(seed)
    words = load_words(zipf_floor)
    by_offset, fit = build_indexes(words)

    buildable = [X for X in by_offset[0]
                 if all(X in by_offset[p] for p in range(4))]
    rng.shuffle(buildable)
    print(f"words={len(words)}  buildable trigrams={len(buildable)}", file=sys.stderr)

    puzzles = []
    seen = set()
    for X in buildable:
        if len(puzzles) >= pool_size:
            break
        made = 0
        for _ in range(per_trigram_cap * 3):
            if made >= per_trigram_cap or len(puzzles) >= pool_size:
                break
            p = try_make(X, by_offset, fit, rng)
            if not p:
                continue
            key = (p["a"], tuple(sorted(p["w"])))
            if key in seen:
                continue
            seen.add(key)
            puzzles.append(p)
            made += 1
        if len(puzzles) % 50 == 0 and made:
            print(f"  {len(puzzles)}/{pool_size}", file=sys.stderr)

    rng.shuffle(puzzles)
    header = (
        "/* Auto-generated by generate.py — do not edit by hand.\n"
        " * Each puzzle: a hidden 3-letter trigram that staircases through four\n"
        " * 6-letter words (w[r] carries the trigram at columns r..r+2). Every\n"
        " * puzzle has a UNIQUE solution against the shipped word list.\n"
        " * Fields: a (answer trigram), w ([word0..word3]). */\n"
    )
    body = "const STAIRCASES_PUZZLES = " + json.dumps(puzzles, separators=(",", ":")) + ";\n"
    with open("puzzles.js", "w") as f:
        f.write(header + body)
    print(f"Wrote {len(puzzles)} puzzles to puzzles.js", file=sys.stderr)


if __name__ == "__main__":
    main()
