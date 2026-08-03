/**
 * cockpit-coordination — make the live MASH cockpit coordinate over its OWN
 * bridges.
 *
 * The cockpit already runs on RWIL witnesses (the hook-event ledger), capability
 * claims ("workspace:X held by agent S until T"), and federated peer disagreement
 * (`claimed-locus-overlap`). Today the running hook loop reports those overlaps as
 * a flat list; nobody holds the contradiction, and nothing tells the operator how
 * much of a multi-agent collision is irreducible. This module is the additive
 * bridge that lets the cockpit coordinate over the moat instead, WITHOUT touching
 * the live hook surface in `theatre.mts`.
 *
 * Two wirings, both on the relating kernel:
 *
 *  1. ACCOUNTABLE CAPABILITY CLAIM. A held write-capability is an accountable
 *     transaction over one RWIL witness: it is `authorized` (the work-locus
 *     `Capability` actually grants the claimed path), `witnessed` (the claim is a
 *     single EAVT row through the coherence kernel's `Reading`), and `queryable`
 *     (`accountableClaim` answers authorized ∧ witnessed in one shot). When two
 *     sessions claim the same path, the contest does not silently pick a winner:
 *     it is held as bilattice top (⊤) with both holders retained.
 *
 *  2. CONTRADICTION-AWARE COORDINATION. When peers disagree about a cell/path,
 *     coordination runs through `federateGraded`: each session is a federation
 *     source, each claimed path a cell. A monotone disagreement lifts
 *     coordination-free (held ⊤, no Raft round); a non-monotone one routes only
 *     its irreducible H1 residue to consensus. Everything else lifts for free.
 *
 * Nothing here mutates the hook loop. The cockpit CAN call `coordinateCockpitClaims`
 * over the same `OrganizingTheatreActiveWorkLocusClaim[]` the live signal already
 * produces, and the operator can switch the live surface over deliberately.
 */
import {
  carrierFrom,
  charge,
  chargeValue,
  joinKnowledge,
  mark,
  negate,
  valueOf,
  type ChargeCarrier,
  type ChargeValueName,
  type FromSchema,
  type JsonValue,
} from "@emsenn/relating";
import {
  cell,
  cohere,
  type CoherenceReport,
  type Reading,
  type RWILWitness,
} from "@emsenn/relating/ledger";
import type { Capability } from "@emsenn/animating";
import {
  federateGraded,
  type FederateGradedCell,
  type FederateGradedSource,
  type GradedConsensus,
} from "./federate-graded.mjs";
import type {
  OrganizingTheatreActiveWorkLocusClaim,
} from "./theatre.mjs";

// ── the held write-capability as one RWIL witness row ────────────────────────

const CLAIM_ATTRIBUTE = "workspace-write-capability-held";

function claimEntity(path: string): readonly JsonValue[] {
  return Object.freeze(["organizing", "cockpit", "work-locus", path] as const);
}

/**
 * The one EAVT row that IS the held capability claim. Entity = the claimed path,
 * value = who holds it under which capability until when. This is the shared
 * pivot every reading round-trips through.
 */
export function claimWitness(
  claim: OrganizingTheatreActiveWorkLocusClaim,
  path: string,
): RWILWitness {
  return cell(
    claimEntity(path),
    CLAIM_ATTRIBUTE,
    Object.freeze({
      claimId: claim.claimId,
      session: claim.session,
      harness: claim.harness,
      capability: claim.capability.id,
      grants: claim.capability.grants,
      holder: claim.capability.holder,
      reason: claim.reason ?? null,
      expiresAt: claim.expiresAt ?? null,
    }) as JsonValue,
    Object.freeze({
      session: claim.session,
      at: claim.at ?? null,
      event: claim.event ?? null,
    }) as JsonValue,
  );
}

export interface HeldCapabilityWire {
  readonly kind: "organizing.cockpit.held-capability";
  readonly path: string;
  readonly session: string;
  readonly harness: string;
  readonly claimId: string;
  readonly capability: string;
  readonly grants: string;
  readonly holder: string;
  readonly reason: string | null;
  readonly expiresAt: string | null;
  readonly at: string | null;
  readonly event: string | null;
}

function heldCapabilityFromWitness(row: RWILWitness): HeldCapabilityWire {
  if (row.e === null || typeof row.e !== "object" || !Array.isArray(row.e)) {
    throw new TypeError("cockpit claim reading: witness entity is not a path tuple");
  }
  if (row.v === null || typeof row.v !== "object" || Array.isArray(row.v)) {
    throw new TypeError("cockpit claim reading: witness value is not a record");
  }
  if (row.t === null || typeof row.t !== "object" || Array.isArray(row.t)) {
    throw new TypeError("cockpit claim reading: witness time is not a record");
  }
  const entity = row.e as readonly JsonValue[];
  const value = row.v as Record<string, unknown>;
  const time = row.t as Record<string, unknown>;
  const path = entity[entity.length - 1];
  if (typeof path !== "string") throw new TypeError("cockpit claim reading: malformed path entity");
  const session = value.session;
  const harness = value.harness;
  const claimId = value.claimId;
  const capability = value.capability;
  const grants = value.grants;
  const holder = value.holder;
  if (typeof session !== "string" || typeof harness !== "string" || typeof claimId !== "string") {
    throw new TypeError("cockpit claim reading: malformed holder identity");
  }
  if (typeof capability !== "string" || typeof grants !== "string" || typeof holder !== "string") {
    throw new TypeError("cockpit claim reading: malformed capability");
  }
  return Object.freeze({
    kind: "organizing.cockpit.held-capability" as const,
    path,
    session,
    harness,
    claimId,
    capability,
    grants,
    holder,
    reason: typeof value.reason === "string" ? value.reason : null,
    expiresAt: typeof value.expiresAt === "string" ? value.expiresAt : null,
    at: typeof time.at === "string" ? time.at : null,
    event: typeof time.event === "string" ? time.event : null,
  });
}

function witnessFromHeldCapability(wire: HeldCapabilityWire): RWILWitness {
  return cell(
    claimEntity(wire.path),
    CLAIM_ATTRIBUTE,
    Object.freeze({
      claimId: wire.claimId,
      session: wire.session,
      harness: wire.harness,
      capability: wire.capability,
      grants: wire.grants,
      holder: wire.holder,
      reason: wire.reason,
      expiresAt: wire.expiresAt,
    }) as JsonValue,
    Object.freeze({
      session: wire.session,
      at: wire.at,
      event: wire.event,
    }) as JsonValue,
  );
}

/**
 * The held write-capability read as a coherence-kernel `Reading`: the claim row
 * and the held-capability wire are the same object under two codes, exactly like
 * `outbox ≅ log`. This is what makes the claim QUERYABLE — it is a real RWIL
 * reading, not an ad-hoc record.
 */
export const heldCapabilityReading: Reading<HeldCapabilityWire> = Object.freeze({
  id: "organizing.cockpit.held-capability",
  toWire: heldCapabilityFromWitness,
  fromWire: witnessFromHeldCapability,
});

// ── wiring 1: a held capability claim is an ACCOUNTABLE transaction ──────────

/**
 * Authority gate: does the held `Capability` actually grant the claimed path?
 *
 * Work-locus capabilities are granted as `workspace:<path>|<path>...` (see
 * `organizingTheatreWorkLocusCapabilityGrant`). A claim over `path` is authorized
 * iff the capability's grant string names that path (or a prefix of it).
 */
export function capabilityGrantsPath(capability: Capability, path: string): boolean {
  const grants = capability.grants;
  if (typeof grants !== "string" || !grants.startsWith("workspace:")) return false;
  const granted = grants.slice("workspace:".length).split("|").filter((entry) => entry !== "");
  return granted.some((entry) => entry === path || path === entry || path.startsWith(`${entry}/`) || entry.startsWith(`${path}/`));
}

const accountableClaimSchema = {
  $id: "organizing/cockpit/accountable-claim",
  title: "CockpitAccountableClaim",
  description:
    "A held workspace write-capability read as an accountable transaction: authorized (capability grants the path), witnessed (one RWIL row), and queryable. A contested path is held as bilattice top, never silently won.",
  type: "object",
  additionalProperties: false,
  required: ["kind", "path", "query", "witness", "authorized", "witnessed", "accountable", "legs", "standing", "holders", "coherence"],
  properties: {
    kind: { const: "organizing.cockpit.accountable-claim" },
    path: { type: "string", minLength: 1 },
    query: { const: "authorized and witnessed" },
    witness: {},
    authorized: { type: "boolean" },
    witnessed: { type: "boolean" },
    accountable: { type: "boolean" },
    legs: {
      type: "object",
      additionalProperties: false,
      required: ["authorized", "witnessed"],
      properties: {
        authorized: { type: "string", minLength: 1 },
        witnessed: { type: "string", minLength: 1 },
      },
    },
    standing: { enum: ["sole", "contested"] },
    contestCharge: {},
    truthHolders: { type: "array", items: { type: "string", minLength: 1 } },
    falsityHolders: { type: "array", items: { type: "string", minLength: 1 } },
    holders: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["session", "harness", "claimId", "capability", "witness", "authorized"],
        properties: {
          session: { type: "string", minLength: 1 },
          harness: { type: "string", minLength: 1 },
          claimId: { type: "string", minLength: 1 },
          capability: { type: "string", minLength: 1 },
          witness: { type: "string", minLength: 1 },
          authorized: { type: "boolean" },
        },
      },
    },
    coherence: { type: "array", items: {} },
  },
} as const;

export interface AccountableClaimHolder {
  readonly session: string;
  readonly harness: string;
  readonly claimId: string;
  readonly capability: string;
  readonly witness: string;
  readonly authorized: boolean;
}

export type AccountableClaim = Omit<
  FromSchema<typeof accountableClaimSchema>,
  "witness" | "contestCharge" | "holders" | "coherence"
> & {
  readonly witness: JsonValue;
  readonly contestCharge?: ChargeCarrier;
  readonly truthHolders?: readonly string[];
  readonly falsityHolders?: readonly string[];
  readonly holders: readonly AccountableClaimHolder[];
  readonly coherence: readonly CoherenceReport[];
};
export const accountableClaimCarrier = carrierFrom(accountableClaimSchema);

function affirmed(witnesses: readonly string[]): ChargeCarrier {
  return charge(chargeValue("potential"), [witnesses.map((witness) => mark(witness)), []]);
}

/**
 * Hold a contested path as bilattice top: the holders that agree on the strongest
 * (first, sorted) claim sit on the truth axis, the rest on the falsity axis, and
 * `joinKnowledge` of affirm/deny lifts the cell to ⊤ (`stable`). Both sides survive.
 */
function heldContest(holders: readonly AccountableClaimHolder[]): {
  readonly charge: ChargeCarrier;
  readonly truthHolders: readonly string[];
  readonly falsityHolders: readonly string[];
} {
  const sorted = [...holders].sort((left, right) => left.session.localeCompare(right.session) || left.witness.localeCompare(right.witness));
  const truthHolders = sorted.slice(0, 1).map((holder) => holder.witness);
  const falsityHolders = sorted.slice(1).map((holder) => holder.witness);
  const contestCharge = joinKnowledge(affirmed(truthHolders), negate(affirmed(falsityHolders)));
  const standing = valueOf(contestCharge).name as ChargeValueName;
  if (standing !== "stable") throw new TypeError(`cockpit accountable claim: expected held top, got ${standing}`);
  return Object.freeze({
    charge: contestCharge,
    truthHolders: Object.freeze(truthHolders),
    falsityHolders: Object.freeze(falsityHolders),
  });
}

/**
 * accountableClaim — read one claimed path's held capabilities as an accountable
 * transaction. `authorized ∧ witnessed` is one query; a contested path (more than
 * one holder) is held as ⊤, not resolved to a winner.
 */
export function accountableClaim(
  path: string,
  claims: readonly OrganizingTheatreActiveWorkLocusClaim[],
): AccountableClaim {
  if (claims.length === 0) throw new TypeError("accountableClaim: at least one claim is required");
  const holders: AccountableClaimHolder[] = [];
  const coherence: CoherenceReport[] = [];
  for (const claim of claims) {
    const row = claimWitness(claim, path);
    const authorized = capabilityGrantsPath(claim.capability, path);
    holders.push(Object.freeze({
      session: claim.session,
      harness: claim.harness,
      claimId: claim.claimId,
      capability: claim.capability.id,
      witness: `${claim.session}:${claim.claimId}`,
      authorized,
    }));
    // The claim round-trips through the kernel: it IS a coherent RWIL reading.
    coherence.push(cohere(heldCapabilityReading, heldCapabilityReading, row));
  }
  const sortedHolders = Object.freeze([...holders].sort((left, right) => left.session.localeCompare(right.session) || left.claimId.localeCompare(right.claimId)));
  const authorized = sortedHolders.every((holder) => holder.authorized);
  const witnessed = coherence.every((report) => report.ok);
  const contested = sortedHolders.length > 1;
  const pivot = claimWitness(claims[0]!, path);

  if (!contested) {
    return accountableClaimCarrier.assert(Object.freeze({
      kind: "organizing.cockpit.accountable-claim" as const,
      path,
      query: "authorized and witnessed" as const,
      witness: claimWitness(claims[0]!, path) as unknown as JsonValue,
      authorized,
      witnessed,
      accountable: authorized && witnessed,
      legs: {
        authorized: authorized ? "potential" : "active",
        witnessed: witnessed ? "potential" : "active",
      },
      standing: "sole" as const,
      holders: sortedHolders,
      coherence: Object.freeze(coherence),
    }), "cockpit accountable claim") as AccountableClaim;
  }

  const contest = heldContest(sortedHolders);
  return accountableClaimCarrier.assert(Object.freeze({
    kind: "organizing.cockpit.accountable-claim" as const,
    path,
    query: "authorized and witnessed" as const,
    witness: pivot as unknown as JsonValue,
    authorized,
    witnessed,
    // A contested write-capability is NOT accountable: the path has two holders,
    // held as ⊤, so the cockpit must not treat any single holder as the writer.
    accountable: false,
    legs: {
      // The contest is held on the knowledge axis as ⊤ (stable), surfaced here.
      authorized: authorized ? "potential" : "active",
      witnessed: "stable",
    },
    standing: "contested" as const,
    contestCharge: contest.charge,
    truthHolders: contest.truthHolders,
    falsityHolders: contest.falsityHolders,
    holders: sortedHolders,
    coherence: Object.freeze(coherence),
  }), "cockpit contested accountable claim") as AccountableClaim;
}

// ── wiring 2: peer disagreement routes through CONTRADICTION-AWARE FEDERATION ─

function pathsOf(claim: OrganizingTheatreActiveWorkLocusClaim): readonly string[] {
  return claim.paths.filter((path) => typeof path === "string" && path !== "" && path !== ".");
}

/**
 * The intent a claim takes on a path. The claim's `reason` is the shared
 * coordination vocabulary: two sessions naming the SAME reason agree, two naming
 * DIFFERENT reasons disagree on a comparable axis (so their nerve can carry a
 * cycle). A claim with no stated reason takes a holder-unique stance, which is a
 * genuine paraconsistent contradiction (held ⊤) rather than a coordination cost.
 */
function intentOf(claim: OrganizingTheatreActiveWorkLocusClaim): string {
  return typeof claim.reason === "string" && claim.reason !== ""
    ? `intent:${claim.reason}`
    : `holder:${claim.session}:${claim.claimId}`;
}

/**
 * Project the cockpit's active work-locus claims into `federateGraded` sources:
 * one source per session, one cell per claimed path. A path claimed by a single
 * session is agreement (shared); a path claimed by two sessions is disagreement,
 * routed through contradiction-aware federation. The value carried per cell is the
 * claim's INTENT (`reason`) — the shared vocabulary over which competing intents
 * form the source-to-stance cover cycle whose H1 is the coordination residue.
 */
export function cockpitFederationSources(
  claims: readonly OrganizingTheatreActiveWorkLocusClaim[],
): readonly FederateGradedSource[] {
  const bySession = new Map<string, OrganizingTheatreActiveWorkLocusClaim[]>();
  for (const claim of claims) {
    bySession.set(claim.session, [...(bySession.get(claim.session) ?? []), claim]);
  }
  const sources: FederateGradedSource[] = [];
  for (const [session, group] of [...bySession.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const collection: FederateGradedCell[] = [];
    for (const claim of group) {
      for (const path of pathsOf(claim)) {
        collection.push(Object.freeze({
          cell: path,
          value: intentOf(claim),
          witness: `${claim.session}:${claim.claimId}:${path}`,
        }));
      }
    }
    if (collection.length === 0) continue;
    sources.push(Object.freeze({
      id: session,
      protocol: "cockpit-work-locus",
      collection: Object.freeze(collection),
    }));
  }
  return Object.freeze(sources);
}

export interface CoordinateCockpitClaimsOptions {
  readonly cluster?: string;
}

const cockpitCoordinationSchema = {
  $id: "organizing/cockpit/coordination",
  title: "CockpitCoordination",
  description:
    "The cockpit's claim field coordinated over its own bridges: per-path accountable claims (held capability as authorized ∧ witnessed transaction, contested paths as bilattice top) plus the contradiction-aware federation of competing claims (monotone overlaps coordination-free, only the H1 residue routed to consensus).",
  type: "object",
  additionalProperties: false,
  required: ["kind", "claims", "federation"],
  properties: {
    kind: { const: "organizing.cockpit.coordination" },
    claims: { type: "array", items: { $ref: "organizing/cockpit/accountable-claim" } },
    federation: {},
  },
} as const;

export type CockpitCoordination = Omit<FromSchema<typeof cockpitCoordinationSchema>, "claims" | "federation"> & {
  readonly claims: readonly AccountableClaim[];
  readonly federation: GradedConsensus | null;
};
export const cockpitCoordinationCarrier = carrierFrom(cockpitCoordinationSchema);

/**
 * coordinateCockpitClaims — the additive bridge the live cockpit CAN switch to.
 *
 * Wiring 1: each claimed path becomes an accountable claim (held capability as
 * authorized ∧ witnessed, contests held as ⊤).
 *
 * Wiring 2: all competing claims are routed through `federateGraded`, so a
 * monotone collision lifts coordination-free while only the non-monotone H1
 * residue reaches consensus.
 *
 * This does not touch the running hook loop; it is a pure reading over the same
 * `OrganizingTheatreActiveWorkLocusClaim[]` the live signal already produces.
 */
export function coordinateCockpitClaims(
  claims: readonly OrganizingTheatreActiveWorkLocusClaim[],
  options: CoordinateCockpitClaimsOptions = {},
): CockpitCoordination {
  const byPath = new Map<string, OrganizingTheatreActiveWorkLocusClaim[]>();
  for (const claim of claims) {
    for (const path of pathsOf(claim)) {
      byPath.set(path, [...(byPath.get(path) ?? []), claim]);
    }
  }
  const accountable: AccountableClaim[] = [];
  for (const [path, group] of [...byPath.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    accountable.push(accountableClaim(path, group));
  }

  const sources = cockpitFederationSources(claims);
  const federation = sources.length === 0
    ? null
    : federateGraded(sources, options.cluster === undefined ? {} : { cluster: options.cluster });

  return cockpitCoordinationCarrier.assert(Object.freeze({
    kind: "organizing.cockpit.coordination" as const,
    claims: Object.freeze(accountable),
    federation,
  }), "cockpit coordination") as CockpitCoordination;
}
