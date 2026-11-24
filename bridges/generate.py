#!/usr/bin/env python3
"""Bridges — daily bridge-building ("Hashi") puzzle generator.

Rules, as implemented here:

  * Numbered islands sit on an N x N grid.
  * Bridges run straight (horizontal or vertical) between two islands that can
    see each other, i.e. with no island in between.
  * At most two bridges join any pair of islands; bridges never cross.
  * Each island's number is how many bridges touch it.
  * All islands end up as one connected group.

Like Grader, the hard requirement is that every shipped puzzle is solvable by
pure logic, never by guessing:

  1. Build a random connected solution by growing islands outward from a seed
     island, then sprinkle in a few extra bridges between islands that can see
     each other. The island numbers are read off that solution.
  2. Run a DEDUCTION SOLVER that only makes forced moves: per-island counting
     (an island's bridges must add up to its number, so each connection is
     bounded by what its other connections can and can't supply), the crossing
     rule (a placed bridge zeroes every connection it would cross), the
     connectivity rule (the islands must still be able to form one group), and
     single-connection proof-by-contradiction ("assume this pair has 2
     bridges; if that forces a contradiction, it can't"). A puzzle ships only
     if the solver determines every connection, which also proves the
     solution is unique.

Every shipped puzzle is also checked by an independent brute-force solution
counter (plain backtracking, no shared propagation code) that must find
exactly one solution.

Output: puzzles.js / puzzles-hard.js as BRIDGES_PUZZLES / BRIDGES_PUZZLES_HARD.
Each puzzle is {"n", "islands": [[r, c, number], ...], "sol": [[i, j, count], ...]}
with i < j island indices and count 1 or 2 (pairs not listed have 0).
"""

import json
import random
import sys

PRESETS = {
    "easy": {
        "n": 7, "islands": (12, 16), "extra": 0.35,
        "min_contradictions": 0,
        "pool_size": 500, "seed": 20261124,
        "out_file": "puzzles.js", "var_name": "BRIDGES_PUZZLES", "label": "7x7",
    },
    "hard": {
        "n": 10, "islands": (22, 28), "extra": 0.35,
        "min_contradictions": 2,
        "pool_size": 500, "seed": 20261125,
        "out_file": "puzzles-hard.js", "var_name": "BRIDGES_PUZZLES_HARD", "label": "10x10",
    },
}

DIRS = [(0, 1), (1, 0), (0, -1), (-1, 0)]


# --- Layout helpers ----------------------------------------------------------

def edges_of(islands):
    """All pairs of islands that see each other: nearest island to the right
    and nearest island below each island. Returns (edges, cells) where
    cells[e] is the list of grid cells strictly between the two islands."""
    pos = {(r, c): i for i, (r, c, *_rest) in enumerate(islands)}
    n_max = max(max(r, c) for r, c, *_ in islands) + 1
    edges, cells = [], []
    for i, (r, c, *_rest) in enumerate(islands):
        for dr, dc in ((0, 1), (1, 0)):
            rr, cc, between = r + dr, c + dc, []
            while rr < n_max and cc < n_max:
                if (rr, cc) in pos:
                    j = pos[(rr, cc)]
                    edges.append((min(i, j), max(i, j)))
                    cells.append(between)
                    break
                between.append((rr, cc))
                rr, cc = rr + dr, cc + dc
    return edges, cells


def crossings(edges, cells):
    """cross[e] = edges whose path shares a cell with e's path (they would cross)."""
    owner = {}
    for e, cs in enumerate(cells):
        for cell in cs:
            owner.setdefault(cell, []).append(e)
    cross = [set() for _ in edges]
    for es in owner.values():
        for a in es:
            for b in es:
                if a != b:
                    cross[a].add(b)
    return [sorted(s) for s in cross]


# --- Random solution ---------------------------------------------------------

def make_solution(rng, n, target, extra_p):
    islands = [(rng.randrange(n), rng.randrange(n))]
    occupied = {islands[0]: 0}
    bridge_cells = set()
    bridges = {}  # (r1,c1,r2,c2) normalized pair of positions -> count

    def free_spot(r, c):
        if not (0 <= r < n and 0 <= c < n) or (r, c) in occupied or (r, c) in bridge_cells:
            return False
        return all((r + dr, c + dc) not in occupied for dr, dc in DIRS)

    tries = 0
    while len(islands) < target and tries < 20000:
        tries += 1
        r, c = rng.choice(islands)
        dr, dc = rng.choice(DIRS)
        length = rng.randint(2, min(5, n - 1))
        tr, tc = r + dr * length, c + dc * length
        if not free_spot(tr, tc):
            continue
        path = [(r + dr * k, c + dc * k) for k in range(1, length)]
        if any(p in occupied or p in bridge_cells for p in path):
            continue
        islands.append((tr, tc))
        occupied[(tr, tc)] = len(islands) - 1
        bridge_cells.update(path)
        bridges[tuple(sorted([(r, c), (tr, tc)]))] = 2 if rng.random() < 0.4 else 1
    if len(islands) < target:
        return None

    # Extra bridges between islands that see each other but aren't joined,
    # so the solution has loops and isn't just a tree.
    edges, cells = edges_of(islands)
    order = list(range(len(edges)))
    rng.shuffle(order)
    for e in order:
        i, j = edges[e]
        key = tuple(sorted([islands[i], islands[j]]))
        if key in bridges or rng.random() >= extra_p:
            continue
        if any(p in bridge_cells for p in cells[e]):
            continue
        bridge_cells.update(cells[e])
        bridges[key] = 2 if rng.random() < 0.4 else 1

    # Re-index everything by edge on the final layout.
    sol = [0] * len(edges)
    for e, (i, j) in enumerate(edges):
        sol[e] = bridges.get(tuple(sorted([islands[i], islands[j]])), 0)
    need = [0] * len(islands)
    for e, (i, j) in enumerate(edges):
        need[i] += sol[e]
        need[j] += sol[e]
    return islands, need, edges, cells, sol


# --- Deduction solver --------------------------------------------------------
# Each connection has a domain bitmask over {0, 1, 2} bridges.

LO = [9, 0, 1, 0, 2, 0, 1, 0]  # lowest value in mask
HI = [-1, 0, 1, 1, 2, 2, 2, 2]  # highest value in mask
RANGE = {}
for _a in range(3):
    for _b in range(3):
        RANGE[(_a, _b)] = sum(1 << v for v in range(_a, _b + 1))


class Puzzle:
    def __init__(self, n_islands, need, edges, cross):
        self.n = n_islands
        self.need = need
        self.edges = edges
        self.cross = cross
        self.inc = [[] for _ in range(n_islands)]
        for e, (i, j) in enumerate(edges):
            self.inc[i].append(e)
            self.inc[j].append(e)

    def initial(self):
        dom = []
        for i, j in self.edges:
            top = min(2, self.need[i], self.need[j])
            dom.append(RANGE[(0, top)])
        return dom

    def connected(self, dom):
        seen = {0}
        stack = [0]
        while stack:
            v = stack.pop()
            for e in self.inc[v]:
                if dom[e] > 1:  # some nonzero value possible
                    i, j = self.edges[e]
                    w = j if i == v else i
                    if w not in seen:
                        seen.add(w)
                        stack.append(w)
        return len(seen) == self.n

    def closed_group(self, dom):
        """A group joined by certain bridges that can't reach anything else,
        while not containing every island, is a contradiction."""
        comp = [-1] * self.n
        for s in range(self.n):
            if comp[s] != -1:
                continue
            members, stack = [s], [s]
            comp[s] = s
            while stack:
                v = stack.pop()
                for e in self.inc[v]:
                    if LO[dom[e]] > 0:
                        i, j = self.edges[e]
                        w = j if i == v else i
                        if comp[w] == -1:
                            comp[w] = s
                            members.append(w)
                            stack.append(w)
            if len(members) == self.n:
                return False
            open_ = False
            for v in members:
                for e in self.inc[v]:
                    i, j = self.edges[e]
                    w = j if i == v else i
                    if comp[w] != s and dom[e] > 1:
                        open_ = True
                        break
                if open_:
                    break
            if not open_:
                return True
        return False

    def propagate(self, dom):
        changed = True
        while changed:
            changed = False
            for v in range(self.n):
                es = self.inc[v]
                slo = sum(LO[dom[e]] for e in es)
                shi = sum(HI[dom[e]] for e in es)
                need = self.need[v]
                if slo > need or shi < need:
                    return False
                for e in es:
                    m = dom[e]
                    a = max(0, need - (shi - HI[m]))
                    b = min(2, need - (slo - LO[m]))
                    if a > b:
                        return False
                    nm = m & RANGE[(a, b)]
                    if nm == 0:
                        return False
                    if nm != m:
                        slo += LO[nm] - LO[m]
                        shi += HI[nm] - HI[m]
                        dom[e] = nm
                        changed = True
            for e, m in enumerate(dom):
                if LO[m] > 0:
                    for f in self.cross[e]:
                        if not dom[f] & 1:
                            return False
                        if dom[f] != 1:
                            dom[f] = 1
                            changed = True
            if not changed:
                if not self.connected(dom) or self.closed_group(dom):
                    return False
        return True

    def solve(self):
        """Pure deduction. Returns (domains, contradiction_steps) or None if
        the initial position is already contradictory."""
        dom = self.initial()
        if not self.propagate(dom):
            return None
        steps = 0
        progress = True
        while progress:
            progress = False
            for e in range(len(dom)):
                if dom[e] in (1, 2, 4):
                    continue
                for x in (0, 1, 2):
                    if not dom[e] & (1 << x):
                        continue
                    trial = dom[:]
                    trial[e] = 1 << x
                    if not self.propagate(trial):
                        dom[e] &= ~(1 << x)
                        steps += 1
                        progress = True
                        if not self.propagate(dom):
                            return None
                        break
        return dom, steps


# --- Independent brute-force counter ----------------------------------------

def count_solutions(n_islands, need, edges, cross, limit=2, budget=2_000_000):
    """Plain backtracking over connections in order. Returns the number of
    solutions found (capped at limit), or None if the node budget ran out."""
    inc_last = [-1] * n_islands  # last edge index touching each island
    for e, (i, j) in enumerate(edges):
        inc_last[i] = max(inc_last[i], e)
        inc_last[j] = max(inc_last[j], e)
    remaining = list(need)
    val = [0] * len(edges)
    found = 0
    nodes = 0

    def connected():
        adj = [[] for _ in range(n_islands)]
        for e, (i, j) in enumerate(edges):
            if val[e]:
                adj[i].append(j)
                adj[j].append(i)
        seen, stack = {0}, [0]
        while stack:
            v = stack.pop()
            for w in adj[v]:
                if w not in seen:
                    seen.add(w)
                    stack.append(w)
        return len(seen) == n_islands

    def rec(e):
        nonlocal found, nodes
        nodes += 1
        if nodes > budget:
            raise TimeoutError
        if e == len(edges):
            if all(x == 0 for x in remaining) and connected():
                found += 1
            return
        i, j = edges[e]
        for x in (0, 1, 2):
            if x > remaining[i] or x > remaining[j]:
                break
            if x and any(val[f] for f in cross[e] if f < e):
                break
            remaining[i] -= x
            remaining[j] -= x
            val[e] = x
            ok = not (inc_last[i] == e and remaining[i]) and not (inc_last[j] == e and remaining[j])
            if ok:
                rec(e + 1)
            remaining[i] += x
            remaining[j] += x
            val[e] = 0
            if found >= limit:
                return

    try:
        rec(0)
    except TimeoutError:
        return None
    return found


# --- Puzzle assembly ---------------------------------------------------------

def make_puzzle(rng, preset):
    n = preset["n"]
    lo, hi = preset["islands"]
    built = make_solution(rng, n, rng.randint(lo, hi), preset["extra"])
    if built is None:
        return None
    islands, need, edges, cells, sol = built
    # Use the whole board: some island on every edge row and column.
    rows = {r for r, _ in islands}
    cols = {c for _, c in islands}
    if not {0, n - 1} <= rows or not {0, n - 1} <= cols:
        return None
    cross = crossings(edges, cells)
    p = Puzzle(len(islands), need, edges, cross)
    res = p.solve()
    if res is None:
        return None
    dom, steps = res
    if any(m not in (1, 2, 4) for m in dom):
        return None
    if [LO[m] for m in dom] != sol:
        raise AssertionError("deduction solver disagrees with the built solution")
    if steps < preset["min_contradictions"]:
        return None
    count = count_solutions(len(islands), need, edges, cross)
    if count is None:
        return None  # too slow to double-check; skip rather than ship unchecked
    if count != 1:
        raise AssertionError(f"brute force found {count} solutions")
    return {
        "n": n,
        "islands": [[r, c, need[i]] for i, (r, c) in enumerate(islands)],
        "sol": [[i, j, sol[e]] for e, (i, j) in enumerate(edges) if sol[e]],
        "_steps": steps,
    }


def main():
    args = sys.argv[1:]
    name = "easy"
    if args and args[0] in PRESETS:
        name, args = args[0], args[1:]
    preset = PRESETS[name]
    seed = int(args[0]) if args else preset["seed"]
    rng = random.Random(seed)

    seen, puzzles, attempts = set(), [], 0
    steps_total = 0
    while len(puzzles) < preset["pool_size"] and attempts < preset["pool_size"] * 500:
        attempts += 1
        p = make_puzzle(rng, preset)
        if p is None:
            continue
        key = json.dumps(p["islands"])
        if key in seen:
            continue
        seen.add(key)
        steps_total += p.pop("_steps")
        puzzles.append(p)
        if len(puzzles) % 25 == 0:
            print(f"  {len(puzzles)}/{preset['pool_size']} (after {attempts} attempts)", file=sys.stderr)

    header = (
        "/* Auto-generated by generate.py — do not edit by hand.\n"
        f" * Each puzzle is a {preset['label']} Bridges board verified to be solvable by\n"
        " * pure deduction (no guessing) and to have a unique solution.\n"
        " * Fields: n, islands [[row, col, number]], sol [[i, j, bridges]]. */\n"
    )
    body = f"const {preset['var_name']} = " + json.dumps(puzzles, separators=(",", ":")) + ";\n"
    with open(preset["out_file"], "w") as f:
        f.write(header + body)
    avg = steps_total / max(1, len(puzzles))
    print(f"Wrote {len(puzzles)} puzzles to {preset['out_file']} ({attempts} attempts, "
          f"avg {avg:.1f} contradiction steps).", file=sys.stderr)


if __name__ == "__main__":
    main()
