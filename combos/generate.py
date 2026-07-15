#!/usr/bin/env python3
import random, json
from collections import defaultdict

ENABLE = "/tmp/enable1.txt"
FREQ = "/tmp/count_1w.txt"
OUT_PUZ = "/Users/raphaelzstone/Documents/games/combos/puzzles.js"

COMMON_N = 100000                # top-N frequency rank counts as "in use"
COMBO_MIN_LEN, COMBO_MAX_LEN = 5, 8
COMBO_FILL_MIN, COMBO_FILL_MAX = 3, 8
SEED = 1234

BLOCK = set("""cunt fuck fucks fucked shit shits piss pissed cock cocks dick dicks
twat slut sluts whore whores turd fart farts boob boobs prick pricks
penis vulva semen wanker bitch bitches""".split())

# Curated jargon block: words that fall inside the 100k frequency tier but read
# as technical / foreign / archaic rather than everyday. Removed from the
# vocabulary entirely so they're never required answers (keeps the "every
# formable word is a target" rule intact). Educated-everyday words (chattel,
# kindle, flexor, cygnet, marinate...) are deliberately KEPT.
JARGON = set("""
sambo
ricin indole cerium scandia malic mafic mesic thein plastid stoma meiotic
luteal anoxia tinea vagal qualia operant prions
continuo gamba
dative locative catena caput exeunt centum viator domine ponent recept stich
lapin bonnes beton manana casitas valuta fromage
loess schist chert
kersey halbert
culex brome pipit vanda danio
yantra devas hanuman
midden childe leman colter sylva folia marron robbin genom biggin
settlor optionee payors
dewan diwan
""".split())

# Words that are primarily from other languages -- valid Scrabble entries that
# leak in via proper nouns / loanwords but aren't really English and aren't
# gettable. Curated with the help of the `wordfreq` library (comparing English
# vs es/fr/it/de/pt/nl frequency); baked in here so generation needs no extra
# dependency. Naturalized loanwords an English speaker knows (siesta, portico,
# entree, timbre, tilde...) are deliberately KEPT.
FOREIGN = set("""
sucre avion comte hombre madre padre casas campo campos barrios playas
aider aviso ballons barbe boite bombe bouton carnet cesta conto droits duomo
evite glace hosen interne leben libri livre momento morgen mouton nieve panier
projet quinte reclame ridder selva sempre taille tasse utiliser visiter
""".split())

def load_words(path, lo, hi):
    out = set()
    with open(path, encoding="utf-8", errors="ignore") as f:
        for line in f:
            w = line.strip().lower()
            if lo <= len(w) <= hi and w.isalpha() and w.isascii():
                out.add(w)
    return out

FULL = load_words(ENABLE, COMBO_MIN_LEN, COMBO_MAX_LEN) - BLOCK - JARGON - FOREIGN

freq_rank = {}
with open(FREQ, encoding="utf-8", errors="ignore") as f:
    for i, line in enumerate(f):
        if i >= COMMON_N:
            break
        w = line.split()[0].lower()
        if w not in freq_rank:
            freq_rank[w] = i
COMMON = {w for w in FULL if w in freq_rank}

print(f"FULL({COMBO_MIN_LEN}-{COMBO_MAX_LEN})={len(FULL)}  COMMON={len(COMMON)}")

rng = random.Random(SEED)

# ---------------------------------------------------------------------------
# COMBOS: frame = word with 2 adjacent letters blanked. A frame qualifies only
# if EVERY real (FULL-dictionary) word that fits the blank is also a common
# word, and there are 3-8 such fills. So every formable word is a common,
# gettable target -- no obscure words and no "bonus" concept.
# ---------------------------------------------------------------------------
full_fills = defaultdict(set)    # (prefix, i, suffix) -> fills over FULL
common_fills = defaultdict(set)  # (prefix, i, suffix) -> fills over COMMON
for w in FULL:
    for i in range(len(w) - 1):
        full_fills[(w[:i], i, w[i+2:])].add(w[i:i+2])
for w in COMMON:
    for i in range(len(w) - 1):
        common_fills[(w[:i], i, w[i+2:])].add(w[i:i+2])

COMBOS = []
for key, ffills in full_fills.items():
    if not (COMBO_FILL_MIN <= len(ffills) <= COMBO_FILL_MAX):
        continue
    if common_fills[key] != ffills:   # zero obscure: every fill is common
        continue
    # skip "too easy" frames where the fills vary in only one position (e.g.
    # r__fle = af/if/uf, or profil__ = ed/er/es) -- just one letter changes.
    if len({f[0] for f in ffills}) == 1 or len({f[1] for f in ffills}) == 1:
        continue
    pre, i, suf = key
    COMBOS.append({"frame": pre + "__" + suf, "answers": sorted(ffills)})
rng.shuffle(COMBOS)
three = sum(1 for c in COMBOS if len(c["answers"]) == 3)
print(f"COMBOS pool={len(COMBOS)}  (3-fill={three}, 4+fill={len(COMBOS)-three})")

print("\nSample COMBOS:")
for c in COMBOS[:10]:
    print(f"  {c['frame']:>9}  ({len(c['answers'])})  {' '.join(c['answers'])}")

# ---------------------------------------------------------------------------
# Write runtime file
# ---------------------------------------------------------------------------
with open(OUT_PUZ, "w") as f:
    f.write("// Auto-generated, pre-verified daily puzzle pool.\n")
    f.write("// COMBOS_POOL: 5-8 letter frames with 2 adjacent blanks where every real\n")
    f.write("//   word that fits is a common target (3-8 fills) -- no bonus words.\n")
    f.write("const COMBOS_POOL = " + json.dumps(COMBOS, separators=(",", ":")) + ";\n")

import os
print(f"\npuzzles.js: {os.path.getsize(OUT_PUZ)//1024} KB")
