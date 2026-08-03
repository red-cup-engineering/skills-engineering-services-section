/**
 * cockpit-coordination — the cockpit dogfoods the moat.
 *
 * Two wirings under law:
 *  1. a held workspace write-capability is an ACCOUNTABLE transaction
 *     (authorized ∧ witnessed), and two competing claims over one path resolve to
 *     a bilattice-top held accountable report, NOT a winner-pick;
 *  2. peer disagreement routes through CONTRADICTION-AWARE FEDERATION: a monotone
 *     overlap lifts coordination-free with no Raft round, while a non-monotone one
 *     routes only its H1 residue to consensus;
 * and the cockpit's RWIL claim trace reads coherently through the kernel.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { valueOf } from "@emsenn/relating";
import { grant } from "@emsenn/animating";
import {
  accountableClaim,
  capabilityGrantsPath,
  claimWitness,
  cockpitFederationSources,
  coordinateCockpitClaims,
  heldCapabilityReading,
} from "../dist/index.mjs";
import { cohere } from "@emsenn/relating/ledger";

const activeClaim = (session, claimId, paths, reason = null) =>
  Object.freeze({
    kind: "organizing.theatre.active-work-locus-claim",
    claimId,
    capability: grant(
      `urn:agent:${session}`,
      `workspace:${paths.join("|")}`,
      `https://dev.bare-cedar-fog.emsenn.net/capabilities/work-locus/${encodeURIComponent(claimId)}`,
    ),
    session,
    harness: "claude-code",
    paths: Object.freeze([...paths]),
    reason,
    at: `2026-06-26T00:00:0${claimId.length % 10}Z`,
    expiresAt: "2026-06-27T00:00:00Z",
    event: `evt-${claimId}`,
  });

test("a sole held capability is an accountable claim: authorized and witnessed", () => {
  const claim = activeClaim("alpha", "c-alpha", ["lib/organizing/src/theatre.mts"]);
  const report = accountableClaim("lib/organizing/src/theatre.mts", [claim]);

  assert.equal(report.standing, "sole");
  assert.equal(report.authorized, true);
  assert.equal(report.witnessed, true);
  assert.equal(report.accountable, true);
  assert.deepEqual(report.legs, { authorized: "potential", witnessed: "potential" });
  assert.equal(report.holders.length, 1);
  assert.equal(report.coherence.every((entry) => entry.ok), true);
});

test("a capability that does not grant the path is unauthorized (active, not silently ok)", () => {
  const claim = activeClaim("alpha", "c-alpha", ["lib/animating/src/index.mts"]);
  // claim's capability grants animating, but we query an organizing path
  assert.equal(capabilityGrantsPath(claim.capability, "lib/organizing/src/index.mts"), false);
  const report = accountableClaim("lib/organizing/src/index.mts", [claim]);
  assert.equal(report.authorized, false);
  assert.equal(report.legs.authorized, "active");
  assert.equal(report.accountable, false);
});

test("two competing claims over one path resolve to a TOP-held accountable report, not a winner-pick", () => {
  const path = "lib/organizing/src/theatre.mts";
  const alpha = activeClaim("alpha", "c-alpha", [path]);
  const beta = activeClaim("beta", "c-beta", [path]);
  const report = accountableClaim(path, [alpha, beta]);

  // held, not won: both holders survive in the report
  assert.equal(report.standing, "contested");
  assert.equal(report.holders.length, 2);
  assert.deepEqual(report.holders.map((entry) => entry.session).sort(), ["alpha", "beta"]);

  // the contest is bilattice top, not a chosen winner
  assert.equal(valueOf(report.contestCharge).name, "stable");
  assert.equal(report.legs.witnessed, "stable");
  assert.equal(report.accountable, false, "a contested write-capability is not accountable");

  // both witness sides retained
  assert.deepEqual(
    [...report.truthHolders, ...report.falsityHolders].sort(),
    ["alpha:c-alpha", "beta:c-beta"],
  );
  assert.equal(report.truthHolders.length, 1);
  assert.equal(report.falsityHolders.length, 1);
});

test("a monotone peer disagreement lifts coordination-free with no consensus round", () => {
  // two sessions claim DIFFERENT single paths: disjoint, monotone, no overlap cell
  const sources = cockpitFederationSources([
    activeClaim("alpha", "c-alpha", ["lib/organizing/src/theatre.mts"]),
    activeClaim("beta", "c-beta", ["lib/animating/src/index.mts"]),
  ]);
  const coordination = coordinateCockpitClaims([
    activeClaim("alpha", "c-alpha", ["lib/organizing/src/theatre.mts"]),
    activeClaim("beta", "c-beta", ["lib/animating/src/index.mts"]),
  ]);

  assert.equal(sources.length, 2);
  const fed = coordination.federation;
  assert.notEqual(fed, null);
  // disjoint paths: both shared, nothing contested, no Raft
  assert.equal(fed.needsCoordination.length, 0);
  assert.equal(fed.raft.frontier.raftRound, "not-required");
  assert.equal(fed.raft.log.entries.length, 0, "monotone coordination spends no Raft");
  assert.equal(fed.h1.rank, 0);
});

test("contested same-path overlap is held top and lifts coordination-free (H1 zero, no Raft)", () => {
  const path = "lib/organizing/src/theatre.mts";
  const coordination = coordinateCockpitClaims([
    activeClaim("alpha", "c-alpha", [path]),
    activeClaim("beta", "c-beta", [path]),
  ]);
  const fed = coordination.federation;
  // one cell, two stances: held top, coordination-free, no Raft round
  assert.equal(fed.contested.length, 1);
  assert.equal(fed.contested[0].cell, path);
  assert.equal(valueOf(fed.contested[0].topCharge).name, "stable");
  assert.equal(fed.needsCoordination.length, 0);
  assert.equal(fed.raft.frontier.raftRound, "not-required");

  // and the per-path accountable claim agrees: contested, top-held
  const claim = coordination.claims.find((entry) => entry.path === path);
  assert.equal(claim.standing, "contested");
  assert.equal(valueOf(claim.contestCharge).name, "stable");
});

test("a non-monotone peer disagreement routes its H1 residue to consensus", () => {
  // two sessions, each asserting BOTH shared competing intents ("rewrite" vs
  // "review") on the same path: the source-to-stance cover carries a cycle,
  // nonzero H1, routed to Raft. This is a real coordination cost, not a mere
  // paraconsistent contradiction.
  const path = "lib/organizing/src/theatre.mts";
  const coordination = coordinateCockpitClaims([
    activeClaim("alpha", "c-alpha-1", [path], "rewrite"),
    activeClaim("alpha", "c-alpha-2", [path], "review"),
    activeClaim("beta", "c-beta-1", [path], "rewrite"),
    activeClaim("beta", "c-beta-2", [path], "review"),
  ], { cluster: "ops" });

  const fed = coordination.federation;
  assert.equal(fed.h1.rank > 0, true, "competing multi-stance overlap has nonzero cover H1");
  assert.deepEqual(fed.h1.cells, [path]);
  assert.equal(fed.needsCoordination.length, 1);
  assert.equal(fed.needsCoordination[0].cell, path);
  assert.equal(fed.raft.frontier.raftRound, "required");
  assert.equal(fed.raft.append.accepted.length, 1);
  assert.deepEqual(fed.raft.append.accepted.map((entry) => entry.command), [
    fed.needsCoordination[0].raftCommand,
  ]);
});

test("the cockpit's RWIL claim trace reads coherently through the kernel", () => {
  const path = "lib/organizing/src/theatre.mts";
  const claim = activeClaim("alpha", "c-alpha", [path]);
  const row = claimWitness(claim, path);

  // the held-capability reading is an iso on the RWIL row: round-trips losslessly
  const report = cohere(heldCapabilityReading, heldCapabilityReading, row);
  assert.equal(report.ok, true);
  assert.equal(report.leftIso, true);
  assert.equal(report.rightIso, true);

  // and the wire recovers the holder identity from the witness
  const wire = heldCapabilityReading.toWire(row);
  assert.equal(wire.session, "alpha");
  assert.equal(wire.path, path);
  assert.equal(wire.grants, `workspace:${path}`);
});
