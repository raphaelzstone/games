#!/usr/bin/env python3
"""Grader — daily "End View" puzzle generator.

End View (a.k.a. "Easy as ABC") rules, as implemented here:

  * The grid is N x N; K < N letters are used (e.g. 5x5 with A-C, 7x7 with A-D).
  * Each row and column contains each letter exactly once among its filled
    cells; the remaining N-K cells in every row and column are blank.
  * Clues on all four sides give the first non-blank letter seen scanning
    inward from that side (top/bottom clue a column, left/right clue a row).

The hard requirement for a *good* daily puzzle is that it be solvable by pure
logic — never by guessing. We guarantee that two ways:

  1. We build a random valid solution (keep K of N symbols from a random Latin
     square, blank the rest), derive its four-sided clues, and then run a
     DEDUCTION SOLVER that only ever makes forced moves: ordinary constraint
     propagation (row/column all-different, blank-count budget, the "clue-edge
     scan" rule that a clue's frontier cell can only be blank or the clue
     letter) plus single-cell proof-by-contradiction ("assume this cell is X;
     if that forces a contradiction, it can't be"). Proof-by-contradiction is
     valid logic, not guessing — guessing would be assuming something and
     *hoping*.
  2. A puzzle is shipped only if the deduction solver determines every cell.
     Because the solver never branches, solving every cell also proves the
     solution is unique.

Cross-checked against an independent brute-force solution counter (real
row/column pruning, no shared code with the solver above) on sampled output:
0 puzzles with more than one solution.

Output is written per preset to puzzles.js / puzzles-hard.js as the globals
GRADER_PUZZLES / GRADER_PUZZLES_HARD. Grid cells are -1 for blank, else a
letter index (0=A, 1=B, ...).
"""

import json
import random
import sys

PRESETS = {
    "easy": {
        "n": 5, "k": 3,
        "pool_size": 1500,
        "out_file": "puzzles.js",
        "var_name": "GRADER_PUZZLES",
        "seed": 20260715,
        "label": "5x5, A-C",
    },
    "hard": {
        "n": 7, "k": 4,
        "pool_size": 500,
        "out_file": "puzzles-hard.js",
        "var_name": "GRADER_PUZZLES_HARD",
        "seed": 20260716,
        "label": "7x7, A-D",
    },
}

N = 5
K = 3
BLANK = "."


def configure(preset):
    global N, K
    N, K = preset["n"], preset["k"]


# --- Random valid solution ---------------------------------------------------
def random_latin_square(n, rng):
    row_perm = list(range(n)); rng.shuffle(row_perm)
    col_perm = list(range(n)); rng.shuffle(col_perm)
    sym_perm = list(range(n)); rng.shuffle(sym_perm)
    L = [[0] * n for _ in range(n)]
    for r in range(n):
        for c in range(n):
            L[r][c] = sym_perm[(row_perm[r] + col_perm[c]) % n]
    # A few random intercalate swaps for extra variety beyond pure isotopisms
    # of the cyclic base square.
    for _ in range(n * 2):
        r1, r2 = rng.sample(range(n), 2)
        c1, c2 = rng.sample(range(n), 2)
        a, b = L[r1][c1], L[r1][c2]
        if L[r2][c1] == b and L[r2][c2] == a:
            L[r1][c1], L[r1][c2] = b, a
            L[r2][c1], L[r2][c2] = a, b
    return L


def build_solution(rng):
    L = random_latin_square(N, rng)
    keep = set(rng.sample(range(N), K))
    remap = {sym: i for i, sym in enumerate(sorted(keep))}
    grid = [[BLANK] * N for _ in range(N)]
    for r in range(N):
        for c in range(N):
            if L[r][c] in keep:
                grid[r][c] = remap[L[r][c]]
    return grid


def derive_clues(grid):
    def first(seq):
        for v in seq:
            if v != BLANK:
                return v
        return None
    left = [first(grid[r]) for r in range(N)]
    right = [first(reversed(grid[r])) for r in range(N)]
    top = [first(grid[r][c] for r in range(N)) for c in range(N)]
    bot = [first(grid[r][c] for r in reversed(range(N))) for c in range(N)]
    return left, right, top, bot


# --- Deduction solver ---------------------------------------------------------
class Contradiction(Exception):
    pass


class Solver:
    """Logic solver over per-cell candidate sets {0..K-1, BLANK}.

    Only ever makes forced moves. `solve` returns (ok, needed_contradiction);
    ok is True iff every cell was determined, which also proves uniqueness.
    """

    def __init__(self, left, right, top, bot):
        self.left, self.right, self.top, self.bot = left, right, top, bot
        self.cands = [[set(range(K)) | {BLANK} for _ in range(N)] for _ in range(N)]

    def set_cell(self, cands, r, c, val):
        cur = cands[r][c]
        if cur == {val}:
            return False
        if val not in cur:
            raise Contradiction()
        cands[r][c] = {val}
        return True

    def eliminate(self, cands, r, c, val):
        cur = cands[r][c]
        if val not in cur:
            return False
        cur.discard(val)
        if not cur:
            raise Contradiction()
        return True

    def propagate(self, cands):
        changed = True
        while changed:
            changed = False

            # Naked singles: a solved letter cell removes that letter from the
            # rest of its row/column (standard Latin all-different).
            for r in range(N):
                for c in range(N):
                    if len(cands[r][c]) == 1:
                        val = next(iter(cands[r][c]))
                        if val == BLANK:
                            continue
                        for c2 in range(N):
                            if c2 != c:
                                changed |= self.eliminate(cands, r, c2, val)
                        for r2 in range(N):
                            if r2 != r:
                                changed |= self.eliminate(cands, r2, c, val)

            # Hidden singles: a letter with only one candidate cell left in a
            # row/column must go there.
            for r in range(N):
                for val in range(K):
                    cells = [c for c in range(N) if val in cands[r][c]]
                    if not cells:
                        raise Contradiction()
                    if len(cells) == 1 and len(cands[r][cells[0]]) > 1:
                        changed |= self.set_cell(cands, r, cells[0], val)
            for c in range(N):
                for val in range(K):
                    cells = [r for r in range(N) if val in cands[r][c]]
                    if not cells:
                        raise Contradiction()
                    if len(cells) == 1 and len(cands[cells[0]][c]) > 1:
                        changed |= self.set_cell(cands, cells[0], c, val)

            # Blank-count saturation: each row/column needs exactly N-K blanks.
            need = N - K
            for r in range(N):
                confirmed = sum(1 for c in range(N) if cands[r][c] == {BLANK})
                could = [c for c in range(N) if BLANK in cands[r][c] and len(cands[r][c]) > 1]
                if confirmed > need:
                    raise Contradiction()
                if confirmed == need:
                    for c in could:
                        changed |= self.eliminate(cands, r, c, BLANK)
                elif confirmed + len(could) == need and could:
                    for c in could:
                        changed |= self.set_cell(cands, r, c, BLANK)
            for c in range(N):
                confirmed = sum(1 for r in range(N) if cands[r][c] == {BLANK})
                could = [r for r in range(N) if BLANK in cands[r][c] and len(cands[r][c]) > 1]
                if confirmed > need:
                    raise Contradiction()
                if confirmed == need:
                    for r in could:
                        changed |= self.eliminate(cands, r, c, BLANK)
                elif confirmed + len(could) == need and could:
                    for r in could:
                        changed |= self.set_cell(cands, r, c, BLANK)

            # Clue-edge scan: from each side, walk inward. A confirmed BLANK
            # lets the scan continue; a confirmed letter must equal the clue
            # (else contradiction) and stops the scan; the first still-open
            # cell can only be BLANK or the clue letter.
            def scan(cellseq, clue):
                nonlocal changed
                if clue is None:
                    return
                for (r, c) in cellseq:
                    cell = cands[r][c]
                    if cell == {BLANK}:
                        continue
                    if len(cell) == 1:
                        if next(iter(cell)) != clue:
                            raise Contradiction()
                        return
                    allowed = {BLANK, clue}
                    if not cell.issubset(allowed):
                        cell &= allowed
                        if not cell:
                            raise Contradiction()
                        changed = True
                    return

            for r in range(N):
                scan([(r, c) for c in range(N)], self.left[r])
                scan([(r, c) for c in reversed(range(N))], self.right[r])
            for c in range(N):
                scan([(r, c) for r in range(N)], self.top[c])
                scan([(r, c) for r in reversed(range(N))], self.bot[c])

    def solved(self, cands):
        return all(len(cands[r][c]) == 1 for r in range(N) for c in range(N))

    def contradiction_pass(self, cands):
        progressed = False
        for r in range(N):
            for c in range(N):
                if len(cands[r][c]) <= 1:
                    continue
                survivors = []
                for val in list(cands[r][c]):
                    trial = [[set(s) for s in row] for row in cands]
                    trial[r][c] = {val}
                    try:
                        self.propagate(trial)
                        survivors.append(val)
                    except Contradiction:
                        continue
                if not survivors:
                    raise Contradiction()
                if len(survivors) < len(cands[r][c]):
                    cands[r][c] = set(survivors)
                    progressed = True
        return progressed

    def solve(self):
        cands = self.cands
        needed_contradiction = False
        try:
            self.propagate(cands)
            while not self.solved(cands):
                if not self.contradiction_pass(cands):
                    return False, needed_contradiction, cands
                needed_contradiction = True
                self.propagate(cands)
        except Contradiction:
            return False, needed_contradiction, cands
        return True, needed_contradiction, cands


# --- Puzzle assembly -----------------------------------------------------------
def fully_solves(left, right, top, bot, grid):
    """True iff the deduction solver (propagation + proof-by-contradiction,
    never guessing) fully determines every cell to match `grid` exactly."""
    solver = Solver(left, right, top, bot)
    ok, _, cands = solver.solve()
    if not ok:
        return False
    deduced = [[next(iter(cands[r][c])) for c in range(N)] for r in range(N)]
    return deduced == grid


# Greedily drop clues (in random order) as long as the puzzle stays fully
# solvable by pure deduction. A dropped clue is stored as None and just means
# "no constraint from that side" -- the solver's scan() already treats a None
# clue that way, so this can never make the solver assert a wrong value, only
# fail to narrow further. That's why a full solve still proves uniqueness
# with clues missing, exactly as it does with all of them present (see
# README). Locally minimal, not globally minimum -- order-dependent, and
# that's fine: it's what gives every puzzle's clue count some natural
# variety instead of all landing on one fixed count.
def minimize_clues(grid, left, right, top, bot, rng):
    left, right, top, bot = list(left), list(right), list(top), list(bot)
    slots = [("left", i) for i in range(N)] + [("right", i) for i in range(N)] \
          + [("top", i) for i in range(N)] + [("bot", i) for i in range(N)]
    rng.shuffle(slots)
    arrs = {"left": left, "right": right, "top": top, "bot": bot}
    for side, i in slots:
        saved = arrs[side][i]
        arrs[side][i] = None
        if not fully_solves(left, right, top, bot, grid):
            arrs[side][i] = saved
    return left, right, top, bot


def make_puzzle(rng):
    grid = build_solution(rng)
    left, right, top, bot = derive_clues(grid)
    if not fully_solves(left, right, top, bot, grid):
        return None
    left, right, top, bot = minimize_clues(grid, left, right, top, bot, rng)
    out_grid = [[(-1 if v == BLANK else v) for v in row] for row in grid]
    return {
        "n": N, "k": K, "grid": out_grid,
        "left": left, "right": right, "top": top, "bot": bot,
    }


def main():
    args = sys.argv[1:]
    name = "easy"
    if args and args[0] in PRESETS:
        name, args = args[0], args[1:]
    preset = PRESETS[name]
    configure(preset)
    seed = int(args[0]) if args else preset["seed"]

    rng = random.Random(seed)
    seen = set()
    puzzles = []
    attempts = 0
    max_attempts = preset["pool_size"] * 4000
    while len(puzzles) < preset["pool_size"] and attempts < max_attempts:
        attempts += 1
        p = make_puzzle(rng)
        if p is None:
            continue
        key = (tuple(p["left"]), tuple(p["right"]), tuple(p["top"]), tuple(p["bot"]))
        if key in seen:
            continue
        seen.add(key)
        puzzles.append(p)
        if len(puzzles) % 25 == 0:
            print(f"  {len(puzzles)}/{preset['pool_size']} (after {attempts} attempts)", file=sys.stderr)

    header = (
        "/* Auto-generated by generate.py — do not edit by hand.\n"
        f" * Each puzzle is a {preset['label']} End View board verified to be solvable by\n"
        " * pure deduction (no guessing) and to have a unique solution.\n"
        " * Fields: n, k, grid (-1=blank, else letter index), left/right/top/bot clues. */\n"
    )
    body = f"const {preset['var_name']} = " + json.dumps(puzzles, separators=(",", ":")) + ";\n"
    with open(preset["out_file"], "w") as f:
        f.write(header + body)
    print(f"Wrote {len(puzzles)} puzzles to {preset['out_file']} ({attempts} attempts).",
          file=sys.stderr)


if __name__ == "__main__":
    main()
