#!/usr/bin/env python3
"""Abodes — daily Tents puzzle generator.

Tents (a.k.a. "Tents and Trees") rules, as implemented here:

  * The grid contains some TREES (fixed, shown to the player).
  * The player must place TENTS on empty cells so that:
      - there are as many tents as trees, and each tent can be paired one-to-one
        with an orthogonally-adjacent tree (a perfect tent<->tree matching);
      - no two tents touch, not even diagonally (all 8 neighbours);
      - the number of tents in each row / column matches the clue on the
        right / bottom edge.

The hard requirement for a *good* daily puzzle is that it be solvable by pure
logic — never by guessing. We guarantee that two ways:

  1. We build a random valid solution, derive the row/column clues from it, and
     then run a DEDUCTION SOLVER that only ever makes forced moves. The allowed
     moves are ordinary constraint propagation plus single-cell
     proof-by-contradiction ("assume this cell is a tent; if that forces a
     contradiction, it must be grass"). Proof-by-contradiction is valid logic,
     not guessing — guessing would be assuming something and *hoping*.
  2. A puzzle is shipped only if the deduction solver determines every cell.
     Because the solver never branches, solving every cell also proves the
     solution is unique.

Puzzles that need the contradiction step (not just naked propagation) are tagged
"medium"; that's the band we ship. Output is written to puzzles.js as the global
ABODES_PUZZLES.
"""

import json
import random
import sys

# --- Presets ----------------------------------------------------------------
# Abodes ships two daily modes. "normal" is the original 8x8 board; "hard" is a
# 14x14 board — roughly 3x the area and a distinctly longer, tougher solve.
# Each preset drives the whole generator (grid size, tent density, pool size)
# and where the output lands, so a single script produces both pools:
#
#   python3 generate.py            # normal -> puzzles.js  (ABODES_PUZZLES)
#   python3 generate.py hard       # hard   -> puzzles-hard.js (ABODES_PUZZLES_HARD)
#   python3 generate.py hard 42    # ... with an explicit RNG seed
PRESETS = {
    "normal": {
        "n": 8,
        "tent_min": 10, "tent_max": 14,   # medium density for 8x8
        "pool_size": 1500,                 # ~4 years of dailies
        "out_file": "puzzles.js",
        "var_name": "ABODES_PUZZLES",
        "seed": 20260623,
        "label": "8x8",
    },
    "hard": {
        "n": 14,
        "tent_min": 32, "tent_max": 40,    # comparable density on a 14x14 grid
        "pool_size": 500,                  # ~1.4 years of dailies (slower to build)
        "out_file": "puzzles-hard.js",
        "var_name": "ABODES_PUZZLES_HARD",
        "seed": 20260712,
        "label": "14x14",
    },
}

# These module-level knobs are set by configure() from the chosen preset; the
# generator and solver read them as globals (the grid is square, N x N).
N = 8
TENT_MIN, TENT_MAX = 10, 14
POOL_SIZE = 1500


def configure(preset):
    global N, TENT_MIN, TENT_MAX, POOL_SIZE
    N = preset["n"]
    TENT_MIN, TENT_MAX = preset["tent_min"], preset["tent_max"]
    POOL_SIZE = preset["pool_size"]


UNKNOWN, TENT, GRASS, TREE = 0, 1, 2, 3

DIRS8 = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]
DIRS4 = [(-1, 0), (1, 0), (0, -1), (0, 1)]


def in_grid(r, c):
    return 0 <= r < N and 0 <= c < N


def neighbors8(r, c):
    for dr, dc in DIRS8:
        if in_grid(r + dr, c + dc):
            yield r + dr, c + dc


def neighbors4(r, c):
    for dr, dc in DIRS4:
        if in_grid(r + dr, c + dc):
            yield r + dr, c + dc


# --- Random valid solution --------------------------------------------------
def build_solution(rng):
    """Place tent+tree pairs greedily into a random valid configuration.

    Returns (tents, trees) as sorted lists of (r, c), or None if this attempt
    couldn't reach the tent target (the caller just retries with a new order).
    """
    target = rng.randint(TENT_MIN, TENT_MAX)
    kind = {}                      # (r,c) -> TENT or TREE
    tents, trees = [], []
    cells = [(r, c) for r in range(N) for c in range(N)]
    rng.shuffle(cells)

    for (r, c) in cells:
        if len(tents) >= target:
            break
        if (r, c) in kind:
            continue
        # A tent may not touch another tent on any of its 8 neighbours.
        if any(kind.get(nb) == TENT for nb in neighbors8(r, c)):
            continue
        # Its paired tree must sit on a free orthogonal neighbour.
        tree_opts = [nb for nb in neighbors4(r, c) if nb not in kind]
        if not tree_opts:
            continue
        tr = rng.choice(tree_opts)
        kind[(r, c)] = TENT
        kind[tr] = TREE
        tents.append((r, c))
        trees.append(tr)

    if len(tents) < TENT_MIN:
        return None
    return sorted(tents), sorted(trees)


# --- Deduction solver -------------------------------------------------------
class Contradiction(Exception):
    pass


class Solver:
    """Logic solver over a grid of {UNKNOWN, TENT, GRASS, TREE}.

    Only ever makes forced moves. `solve` returns True iff every non-tree cell
    was determined; in that case the filled grid is the unique solution.
    """

    def __init__(self, trees, row_clues, col_clues):
        self.trees = set(trees)
        self.row_clues = row_clues
        self.col_clues = col_clues
        self.grid = [[UNKNOWN] * N for _ in range(N)]
        for (r, c) in trees:
            self.grid[r][c] = TREE

    def clone_grid(self):
        return [row[:] for row in self.grid]

    def set_cell(self, grid, r, c, val):
        cur = grid[r][c]
        if cur == val:
            return False
        if cur != UNKNOWN:
            raise Contradiction()
        grid[r][c] = val
        return True

    def propagate(self, grid):
        """Run naked-deduction rules to a fixpoint. Raises on contradiction."""
        changed = True
        while changed:
            changed = False

            # Rule A: a tent can only sit next to a tree. Any unknown cell with
            # no orthogonal tree neighbour must be grass.
            for r in range(N):
                for c in range(N):
                    if grid[r][c] != UNKNOWN:
                        continue
                    if not any(grid[nr][nc] == TREE for nr, nc in neighbors4(r, c)):
                        changed |= self.set_cell(grid, r, c, GRASS)

            # Rule B: a tent grasses all 8 of its neighbours.
            for r in range(N):
                for c in range(N):
                    if grid[r][c] != TENT:
                        continue
                    for nr, nc in neighbors8(r, c):
                        if grid[nr][nc] == UNKNOWN:
                            changed |= self.set_cell(grid, nr, nc, GRASS)

            # Rule C: row / column clue saturation.
            for r in range(N):
                tents = sum(1 for c in range(N) if grid[r][c] == TENT)
                unk = [c for c in range(N) if grid[r][c] == UNKNOWN]
                if tents > self.row_clues[r] or tents + len(unk) < self.row_clues[r]:
                    raise Contradiction()
                if tents == self.row_clues[r] and unk:
                    for c in unk:
                        changed |= self.set_cell(grid, r, c, GRASS)
                elif tents + len(unk) == self.row_clues[r] and unk:
                    for c in unk:
                        changed |= self.set_cell(grid, r, c, TENT)
            for c in range(N):
                tents = sum(1 for r in range(N) if grid[r][c] == TENT)
                unk = [r for r in range(N) if grid[r][c] == UNKNOWN]
                if tents > self.col_clues[c] or tents + len(unk) < self.col_clues[c]:
                    raise Contradiction()
                if tents == self.col_clues[c] and unk:
                    for r in unk:
                        changed |= self.set_cell(grid, r, c, GRASS)
                elif tents + len(unk) == self.col_clues[c] and unk:
                    for r in unk:
                        changed |= self.set_cell(grid, r, c, TENT)

            # Rule D: a tree with exactly one possible tent slot forces it.
            for (r, c) in self.trees:
                if any(grid[nr][nc] == TENT for nr, nc in neighbors4(r, c)):
                    continue
                slots = [(nr, nc) for nr, nc in neighbors4(r, c) if grid[nr][nc] == UNKNOWN]
                if not slots:
                    raise Contradiction()  # tree can never be served
                if len(slots) == 1:
                    changed |= self.set_cell(grid, slots[0][0], slots[0][1], TENT)

        # Global matching feasibility: every tree must still be matchable to a
        # distinct tent/candidate cell (Hall's condition via bipartite matching).
        if not self.matchable(grid):
            raise Contradiction()

    def matchable(self, grid):
        """Can every tree be paired with a distinct adjacent tent-or-unknown cell?"""
        cand = {}
        for (r, c) in self.trees:
            cand[(r, c)] = [(nr, nc) for nr, nc in neighbors4(r, c)
                            if grid[nr][nc] in (TENT, UNKNOWN)]
        match = {}  # cell -> tree

        def aug(tree, seen):
            for cell in cand[tree]:
                if cell in seen:
                    continue
                seen.add(cell)
                if cell not in match or aug(match[cell], seen):
                    match[cell] = tree
                    return True
            return False

        for tree in cand:
            if not aug(tree, set()):
                return False
        return True

    def contradiction_pass(self, grid):
        """Single-cell proof by contradiction: assume a value, refute it.

        Returns True if it determined at least one new cell. This is valid
        deduction (refuting a hypothesis), never a hopeful guess.
        """
        progressed = False
        for r in range(N):
            for c in range(N):
                if grid[r][c] != UNKNOWN:
                    continue
                # Assume TENT -> if contradiction, it's GRASS.
                trial = [row[:] for row in grid]
                trial[r][c] = TENT
                try:
                    self.propagate(trial)
                except Contradiction:
                    grid[r][c] = GRASS
                    progressed = True
                    continue
                # Assume GRASS -> if contradiction, it's TENT.
                trial = [row[:] for row in grid]
                trial[r][c] = GRASS
                try:
                    self.propagate(trial)
                except Contradiction:
                    grid[r][c] = TENT
                    progressed = True
        return progressed

    def solved(self, grid):
        return all(grid[r][c] != UNKNOWN for r in range(N) for c in range(N))

    def solve(self):
        """Returns (ok, needed_contradiction)."""
        needed_contradiction = False
        try:
            self.propagate(self.grid)
            while not self.solved(self.grid):
                if not self.contradiction_pass(self.grid):
                    return False, needed_contradiction  # stuck -> would need guessing
                needed_contradiction = True
                self.propagate(self.grid)
        except Contradiction:
            return False, needed_contradiction
        return True, needed_contradiction


# --- Puzzle assembly --------------------------------------------------------
def make_puzzle(rng):
    sol = build_solution(rng)
    if sol is None:
        return None
    tents, trees = sol
    row_clues = [sum(1 for (r, c) in tents if r == i) for i in range(N)]
    col_clues = [sum(1 for (r, c) in tents if c == i) for i in range(N)]

    solver = Solver(trees, row_clues, col_clues)
    ok, needed_contradiction = solver.solve()
    if not ok:
        return None
    # Confirm the deduced grid matches the intended solution (sanity).
    deduced = {(r, c) for r in range(N) for c in range(N) if solver.grid[r][c] == TENT}
    if deduced != set(tents):
        return None
    # Ship medium puzzles: those that genuinely needed the contradiction step.
    if not needed_contradiction:
        return None
    return {
        "size": N,
        "trees": [[r, c] for (r, c) in trees],
        "tents": [[r, c] for (r, c) in tents],
        "rowClues": row_clues,
        "colClues": col_clues,
    }


def main():
    # First positional arg selects the preset (default "normal"); an optional
    # second arg overrides the RNG seed.
    args = sys.argv[1:]
    name = "normal"
    if args and args[0] in PRESETS:
        name, args = args[0], args[1:]
    preset = PRESETS[name]
    configure(preset)
    seed = int(args[0]) if args else preset["seed"]

    rng = random.Random(seed)
    seen = set()
    puzzles = []
    attempts = 0
    while len(puzzles) < POOL_SIZE and attempts < POOL_SIZE * 400:
        attempts += 1
        p = make_puzzle(rng)
        if p is None:
            continue
        key = tuple(sorted(map(tuple, p["trees"])))
        if key in seen:
            continue
        seen.add(key)
        puzzles.append(p)
        if len(puzzles) % 25 == 0:
            print(f"  {len(puzzles)}/{POOL_SIZE} (after {attempts} attempts)", file=sys.stderr)

    header = (
        "/* Auto-generated by generate.py — do not edit by hand.\n"
        f" * Each puzzle is a {preset['label']} Tents board verified to be solvable by\n"
        " * pure deduction (no guessing) and to have a unique solution.\n"
        " * Fields: size, trees [[r,c]...], tents (solution), rowClues, colClues. */\n"
    )
    body = f"const {preset['var_name']} = " + json.dumps(puzzles, separators=(",", ":")) + ";\n"
    with open(preset["out_file"], "w") as f:
        f.write(header + body)
    print(f"Wrote {len(puzzles)} puzzles to {preset['out_file']} ({attempts} attempts).",
          file=sys.stderr)


if __name__ == "__main__":
    main()
