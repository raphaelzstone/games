#!/usr/bin/env python3
"""Square Up — daily dissection puzzle generator.

Each puzzle is an irregular 25-cell shape. The player's job: split it into two
pieces (any way at all, as long as each piece stays orthogonally connected)
that can be rotated and/or reflected to reassemble into a perfect 5x5 square.

Construction (so a solution is guaranteed to exist): take a 5x5 square, cut it
with a random staircase line into two pieces, apply a random rotation/
reflection to one piece, and slide it to a new position touching the other
piece so the two together form a new, irregular but still-connected 25-cell
shape with no gaps or overlaps. That new shape is the puzzle; the "solution"
is recovering the original two pieces.

We ship only puzzles with a UNIQUE solution: a full search over every way to
split the shown shape into two connected pieces (bitmask-based, with an
early-exit the instant a second, different valid split is found, and a
necessary geometric prune — a piece's bounding box, in either axis, can never
exceed 5 under ANY of the 8 square symmetries, so any partial piece that
already does is abandoned immediately). A puzzle ships only if the one split
we built it from is the ONLY one that reforms a square.

Output: puzzles.js (global SQUAREUP_PUZZLES), each entry:
  {
    "shape": [[r,c], ...]              # 25 cells of the puzzle shape, normalized
    "a": [[r,c], ...]                  # the "piece A" cells within the shape (the
                                        #   rest of shape is piece B) — the unique
                                        #   solution split
    "sq": [[r,c,"a"|"b"], ...]         # the plain 5x5 solved square, each cell
                                        #   tagged by which piece it came from —
                                        #   purely for the results-screen reveal
  }
"""

import json
import random
import sys

N = 5
CELLS = N * N
DIRS4 = [(-1, 0), (1, 0), (0, -1), (0, 1)]

# The 8 symmetries of the square lattice (rotations + reflections).
SYMS = [
    lambda r, c: (r, c),
    lambda r, c: (-c, r),
    lambda r, c: (-r, -c),
    lambda r, c: (c, -r),
    lambda r, c: (r, -c),
    lambda r, c: (-r, c),
    lambda r, c: (-c, -r),
    lambda r, c: (c, r),
]


def normalize(cells):
    minr = min(r for r, c in cells)
    minc = min(c for r, c in cells)
    return tuple(sorted((r - minr, c - minc) for r, c in cells))


def bbox(cells):
    rs = [r for r, c in cells]
    cs = [c for r, c in cells]
    return min(rs), max(rs), min(cs), max(cs)


def connected(cellset):
    cellset = set(cellset)
    if not cellset:
        return True
    start = next(iter(cellset))
    seen = {start}
    stack = [start]
    while stack:
        r, c = stack.pop()
        for dr, dc in DIRS4:
            p = (r + dr, c + dc)
            if p in cellset and p not in seen:
                seen.add(p)
                stack.append(p)
    return len(seen) == len(cellset)


# --- Construction ------------------------------------------------------------
def staircase_cut(rng, transpose):
    """A random monotone (staircase) cut of the NxN square into (L, R). If
    `transpose`, the staircase runs column-wise instead of row-wise, for shape
    variety."""
    while True:
        t = [rng.randint(0, N) for _ in range(N)]
        if all(x == 0 for x in t) or all(x == N for x in t):
            continue
        if not transpose:
            L = [(r, c) for r in range(N) for c in range(N) if c < t[r]]
            R = [(r, c) for r in range(N) for c in range(N) if c >= t[r]]
        else:
            L = [(r, c) for r in range(N) for c in range(N) if r < t[c]]
            R = [(r, c) for r in range(N) for c in range(N) if r >= t[c]]
        if L and R:
            return L, R


def try_build_shape(rng, min_piece=4, max_tries=80):
    """Cut the square, move one piece via a random symmetry, and search for a
    translation that reattaches it to the other piece with no overlap, no
    gaps, and full connectivity. Returns (shape_cells, pieceA_cells, pieceB_cells)
    — pieceA is the piece that moved, pieceB stayed in its original spot — or
    None if no placement was found."""
    L, R = staircase_cut(rng, rng.random() < 0.5)
    if len(L) < min_piece or len(R) < min_piece:
        return None
    for _ in range(max_tries):
        g = rng.choice(SYMS[1:])   # skip identity — must actually move
        gL = [g(r, c) for r, c in L]
        minr, maxr, minc, maxc = bbox(R)
        for _try in range(150):
            dr = rng.randint(minr - N, maxr + N)
            dc = rng.randint(minc - N, maxc + N)
            moved = [(r + dr, c + dc) for r, c in gL]
            movedset = set(moved)
            Rset = set(R)
            if movedset & Rset:
                continue
            union = movedset | Rset
            if len(union) != CELLS:
                continue
            if not connected(union):
                continue
            return union, moved, R
    return None


# --- Uniqueness verification --------------------------------------------------
def forms_square(piece_a, piece_b):
    """Does some symmetry of piece_a, combined with piece_b held fixed in
    place, tile a solid NxN square with no gaps or overlaps?"""
    bminr, bmaxr, bminc, bmaxc = bbox(piece_b)
    bset = set(piece_b)
    for minr in range(bmaxr - N + 1, bminr + 1):
        for minc in range(bmaxc - N + 1, bminc + 1):
            square = {(r, c) for r in range(minr, minr + N) for c in range(minc, minc + N)}
            if not bset <= square:
                continue
            complement = square - bset
            if len(complement) != len(piece_a):
                continue
            comp_norm = normalize(complement)
            for g in SYMS:
                if normalize([g(r, c) for r, c in piece_a]) == comp_norm:
                    return True
    return False


def check_unique(shape_cells, known_a_cells, cap=400000):
    """True iff the (known_a, shape - known_a) split is the ONLY way to split
    the shape into two connected pieces that reform a solid square. Explores
    every connected subset containing a fixed root cell (so each partition is
    considered exactly once, not twice for A/B swapped), pruning any partial
    piece whose bounding box already exceeds N in either axis — that's a
    necessary condition under all 8 symmetries, so the whole branch is dead.
    Bails out (and is treated as non-unique, i.e. rejected) past `cap` node
    expansions, so a puzzle only ships once fully verified."""
    cells = sorted(shape_cells)
    idx = {cell: i for i, cell in enumerate(cells)}
    n = len(cells)
    full = (1 << n) - 1
    cellset = set(cells)
    rows = [r for r, c in cells]
    cols = [c for r, c in cells]
    nbr = [0] * n
    for i, (r, c) in enumerate(cells):
        for dr, dc in DIRS4:
            p = (r + dr, c + dc)
            if p in cellset:
                nbr[i] |= 1 << idx[p]
    known_mask = 0
    for cell in known_a_cells:
        known_mask |= 1 << idx[cell]

    def bitmask_connected(mask):
        if mask == 0:
            return True
        low = mask & (-mask)
        seen = low
        frontier = low
        while frontier:
            nxt = 0
            f = frontier
            while f:
                b = f & (-f)
                nxt |= nbr[b.bit_length() - 1]
                f ^= b
            nxt &= mask
            nxt &= ~seen
            if not nxt:
                break
            seen |= nxt
            frontier = nxt
        return seen == mask

    explored = 0
    found_other = False

    def rec(cur_mask, candidate_mask, minr, maxr, minc, maxc):
        nonlocal explored, found_other
        if found_other:
            return
        explored += 1
        if explored > cap:
            found_other = True   # inconclusive -> treated as non-unique
            return
        if (maxr - minr + 1) > N or (maxc - minc + 1) > N:
            return   # necessary-condition prune: can never fit under any symmetry
        comp_mask = full & ~cur_mask
        if comp_mask != 0 and cur_mask != full and bitmask_connected(comp_mask):
            a_cells = [cells[i] for i in range(n) if (cur_mask >> i) & 1]
            b_cells = [cells[i] for i in range(n) if (comp_mask >> i) & 1]
            if forms_square(a_cells, b_cells) or forms_square(b_cells, a_cells):
                if cur_mask != known_mask and comp_mask != known_mask:
                    found_other = True
                    return
        cm = candidate_mask
        excluded = 0
        while cm and not found_other:
            b = cm & (-cm)
            cm ^= b
            i = b.bit_length() - 1
            new_mask = cur_mask | b
            new_candidates = (candidate_mask | nbr[i]) & ~new_mask & ~excluded
            rec(new_mask, new_candidates, min(minr, rows[i]), max(maxr, rows[i]),
                min(minc, cols[i]), max(maxc, cols[i]))
            excluded |= b

    root = 0
    r0, c0 = rows[root], cols[root]
    rec(1 << root, nbr[root], r0, r0, c0, c0)
    return not found_other


# --- Puzzle assembly -----------------------------------------------------------
def make_puzzle(rng):
    built = try_build_shape(rng)
    if built is None:
        return None
    union, piece_a, piece_b = built
    if not check_unique(union, piece_a):
        return None

    shape_cells = sorted(union)
    minr = min(r for r, c in shape_cells)
    minc = min(c for r, c in shape_cells)
    shape_norm = [(r - minr, c - minc) for r, c in shape_cells]
    a_set = {(r - minr, c - minc) for r, c in piece_a}

    # The plain solved square: piece_b sat at its ORIGINAL position before any
    # move, and piece_a is piece_b's complement within that NxN square — i.e.
    # exactly the pre-move (L, R) the shape was built from. Recover their
    # original (unmoved, untranslated) coordinates directly from piece_b's own
    # extent (piece_b never moved) union'd with... piece_b IS already in its
    # original square coordinates (0..N-1), since it was never touched.
    b_orig = set(piece_b)
    square_cells = {(r, c) for r in range(N) for c in range(N)}
    a_orig = square_cells - b_orig   # piece_a's cells before it was moved

    sq = [[r, c, "a" if (r, c) in a_orig else "b"] for r in range(N) for c in range(N)]

    return {
        "shape": [[r, c] for r, c in shape_norm],
        "a": [[r, c] for r, c in sorted(a_set)],
        "sq": sq,
    }


def main():
    pool_size = int(sys.argv[1]) if len(sys.argv) > 1 else 300
    seed = int(sys.argv[2]) if len(sys.argv) > 2 else 20260714

    rng = random.Random(seed)
    seen = set()
    puzzles = []
    attempts = 0
    while len(puzzles) < pool_size and attempts < pool_size * 60:
        attempts += 1
        p = make_puzzle(rng)
        if p is None:
            continue
        key = tuple(sorted(map(tuple, p["shape"])))
        if key in seen:
            continue
        seen.add(key)
        puzzles.append(p)
        if len(puzzles) % 25 == 0:
            print(f"  {len(puzzles)}/{pool_size} (after {attempts} attempts)", file=sys.stderr)

    header = (
        "/* Auto-generated by generate.py — do not edit by hand.\n"
        " * Each puzzle is a 25-cell shape verified to have a UNIQUE split into\n"
        " * two connected pieces that reform a solid 5x5 square (up to rotation\n"
        " * and reflection).\n"
        " * Fields: shape [[r,c]...], a (piece-A cells within shape), sq (the\n"
        " * plain solved 5x5 square, each cell tagged 'a' or 'b' for the reveal). */\n"
    )
    body = "const SQUAREUP_PUZZLES = " + json.dumps(puzzles, separators=(",", ":")) + ";\n"
    with open("puzzles.js", "w") as f:
        f.write(header + body)
    print(f"Wrote {len(puzzles)} puzzles to puzzles.js ({attempts} attempts).", file=sys.stderr)


if __name__ == "__main__":
    main()
