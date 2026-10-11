import assert from "node:assert/strict";
import test from "node:test";
import { erasureReceipt, h1Rank, landauerBits, loadBearing } from "../../src/tokens/erasure-nerve.mjs";

test("Ȟ¹ = cells - (entities - components), the Lean formula on our carrier", () => {
  // A forest: 3 vertices, 2 edges, 1 component -> Ȟ¹ = 0.
  assert.equal(h1Rank({ entities: 3, cells: 2, components: 1 }), 0);
  // One cycle: 3 vertices, 3 edges, 1 component -> Ȟ¹ = 1.
  assert.equal(h1Rank({ entities: 3, cells: 3, components: 1 }), 1);
  assert.equal(landauerBits({ entities: 3, cells: 3, components: 1 }), 1);
  assert.equal(loadBearing({ entities: 3, cells: 2, components: 1 }), false);
  assert.equal(loadBearing({ entities: 3, cells: 3, components: 1 }), true);
  assert.throws(() => h1Rank({ entities: -1, cells: 0, components: 0 }), /non-negative/u);
});

test("witnessed erasures form a forest: zero bits, reversible", () => {
  const receipt = erasureReceipt([
    { erased: "s1", witness: "a1" },
    { erased: "s2", witness: "a2" },
    { erased: "s3", witness: "a1" }, // shared witness (identical content) is still a tree
  ]);
  assert.equal(receipt.landauerBits, 0);
  assert.equal(receipt.reversible, true);
  assert.deepEqual([...receipt.irrecoverable], []);
});

test("an unwitnessed erasure is counted irrecoverable, never priced at zero", () => {
  const receipt = erasureReceipt([
    { erased: "s1", witness: "a1" },
    { erased: "s2", witness: null },
  ]);
  assert.equal(receipt.reversible, false);
  assert.deepEqual([...receipt.irrecoverable], ["s2"]);
  // The unwitnessed node adds a vertex and a component but no cell: bits stay 0 —
  // the harm is tracked in `irrecoverable`, not laundered into the cycle rank.
  assert.equal(receipt.landauerBits, 0);
});

test("erasureReceipt validates its input", () => {
  assert.throws(() => erasureReceipt("nope"), /array/u);
  assert.throws(() => erasureReceipt([{ witness: "w" }]), /erased id/u);
});
