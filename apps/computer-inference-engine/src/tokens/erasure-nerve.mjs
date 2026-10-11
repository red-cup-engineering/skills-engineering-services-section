// erasure-nerve.mjs — Obsmetrologia erasure accounting for a compaction.
//
// The formal ground (all sorry-free Lean, cited by exact file; see README for what is
// proved vs. what is our modeling choice):
//   Obsmetrologia/Cohomology/CoordinationCohomology.lean:341-349 — with incidence rank
//     ρ = |V| - |C|:  Ȟ⁰ = |V| - ρ  and  Ȟ¹ = |E| - ρ  (kernel/cokernel of the incidence
//     Laplacian), i.e.  Ȟ¹ = cells - (entities - components), the cycle rank.
//   Obsmetrologia/Cohomology/LandauerEntropy.lean:44,50-58 — landauerBits N := N.H1rank;
//     landauer_zero_iff_reversible: bits = 0 ↔ the nerve is a forest.
//   ObsmetrologiaPhysicalScience/CondensedMatter/MatterTopology.lean:44-51 — loadBearing N ↔ the
//     nerve is not a forest ↔ 0 < landauerBits.
//
// OUR CARRIER (a modeling choice, not a theorem): the erasure nerve of a compaction plan.
//   entities   — every span a lossy operation touched, plus every witness that survives
//                (an archive entry, or the retained copy a duplicate points at).
//   cells      — the witness links (erased span -> surviving witness).
//   components — connected components of that graph; an unwitnessed erasure is its own
//                component with no cell.
// When every erased span keeps a witness, the nerve is a forest: landauerBits = 0 and the
// erasure is recoverable from what survives. Unwitnessed erasures are counted separately
// as `irrecoverable` — the corpus does not license pricing those at zero, so we never do.

/** Ȟ¹ rank of a finite cover nerve: cells - (entities - components), floored at 0. */
export function h1Rank({ entities, cells, components }) {
  for (const [name, value] of Object.entries({ entities, cells, components })) {
    if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${name} must be a non-negative integer`);
  }
  return Math.max(0, cells - (entities - components));
}

/** landauerBits N := N.H1rank (LandauerEntropy.lean:44). */
export const landauerBits = h1Rank;

/** loadBearing N ↔ 0 < landauerBits N (MatterTopology.lean:44-51). */
export function loadBearing(nerve) {
  return landauerBits(nerve) > 0;
}

/**
 * Build the erasure nerve of an applied compaction and settle its receipt.
 *
 * links: [{ erased, witness }] — witness is null/undefined for an unwitnessed erasure.
 * Returns { nerve, landauerBits, loadBearing, reversible, irrecoverable } where
 * `reversible` is true iff the nerve is a forest AND nothing was erased unwitnessed —
 * landauer_zero_iff_reversible on our carrier, refused when a hard drop occurred.
 */
export function erasureReceipt(links) {
  if (!Array.isArray(links)) throw new TypeError("links must be an array");
  const vertices = new Set();
  const parent = new Map();
  const find = (x) => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)));
      x = parent.get(x);
    }
    return x;
  };
  const add = (x) => {
    if (!vertices.has(x)) {
      vertices.add(x);
      parent.set(x, x);
    }
  };
  let cells = 0;
  const irrecoverable = [];
  for (const link of links) {
    if (!link || typeof link.erased !== "string") throw new TypeError("each link needs an erased id");
    add(`erased:${link.erased}`);
    if (link.witness == null) {
      irrecoverable.push(link.erased);
      continue;
    }
    add(`witness:${link.witness}`);
    cells += 1;
    parent.set(find(`erased:${link.erased}`), find(`witness:${link.witness}`));
  }
  const roots = new Set();
  for (const vertex of vertices) roots.add(find(vertex));
  const nerve = { entities: vertices.size, cells, components: roots.size };
  const bits = landauerBits(nerve);
  return Object.freeze({
    nerve,
    landauerBits: bits,
    loadBearing: bits > 0,
    reversible: bits === 0 && irrecoverable.length === 0,
    irrecoverable: Object.freeze(irrecoverable),
  });
}
