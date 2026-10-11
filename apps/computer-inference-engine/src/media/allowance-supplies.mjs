/**
 * Perishable capacity offered on the work board (the work arena's eighteenth edition): each
 * subscription window the host-wide allowance ledger can read becomes a `supply` its holder opens,
 * for consumers to draw from instead of capacity being wired into one call site.
 *
 * What is offered is what would otherwise lapse: a window with a known budget is projected to its
 * turn at the pace it has been spent so far (organizing `perishablePrice`), and the part of what is
 * left that pace would not spend is the supply. A window spent out, or one its own pace will use
 * up, offers nothing; a window the ledger cannot read (no stated level, an unknown budget) is not
 * offered, since an unknown is never a floor.
 *
 * Each window is its own thread (`supply-<allowance>-<meter>-<turn>`), so restating what is left
 * never opens another; the supplier restates it each turn as an `observe` (measure `remaining`),
 * and a window that has turned is no longer derived, so its supply is withdrawn. The derivation's
 * domain is the tags `supply-<allowance id>` of the pools it read.
 */
import { admitAllowance, openingOf, perishablePrice } from "@red-cup-engineering/organizing/enterprise";
import { operation } from "@red-cup-engineering/computer-system-engine/rpc/operation";
import { allowanceLedgerDeclarations, allowanceLedgerPath, readAllowanceLedger } from "./allowance-ledger.mjs";

// The inference engine's own section: what a supply's draws are spent through.
const SUPPLY_SCOPE = "section:services/engineering-services-section/services/computer-engineering-services-section/services/computer-systems-engineering-services-section/services/computer-inference-system-services-section";

const supplyTag = (allowance) => `supply-${allowance}`;
const turnOf = (iso) => iso.replace(/[^0-9]/gu, "").slice(0, 12);

/** What one unit of each kind costs in the pool's unit, as the arena states it: [lo, hi | null]. */
const costsOf = (reading) => Object.fromEntries(Object.entries(reading.costs)
  .map(([kind, span]) => [kind, [span.lo, span.hi === null || !Number.isFinite(span.hi) ? null : span.hi]]));

/**
 * The supplies the ledger's pools offer at `now`, as a derivation by `poster`: `{ kind, poster,
 * domain: { tags }, evidence, openings: [{ allowance, meter, opening }], observations: [{ thread,
 * measure: "remaining", value, observed, evidence }] }`.
 */
export function allowanceSuppliesOf({ poster, storePath = allowanceLedgerPath(), now = new Date().toISOString(), scope = [SUPPLY_SCOPE] }) {
  if (typeof poster !== "string" || poster === "") throw new TypeError("allowance-supplies: poster names the enterprise that holds the subscriptions");
  const read = [];
  const openings = [];
  const observations = [];
  for (const { declaration } of allowanceLedgerDeclarations({ storePath })) {
    const allowance = admitAllowance(declaration);
    const { reading } = readAllowanceLedger(allowance, { storePath, now });
    read.push(allowance.id);
    for (const window of perishablePrice(reading).windows) {
      if (!window.known || window.exhausted) continue;
      const amount = Math.floor(window.left - window.projected);
      if (amount <= 0) continue;
      const id = `supply-${allowance.id}-${window.meter}-${turnOf(window.until)}`;
      const evidence = [`allowance-reading:${allowance.id}:${window.meter}@${reading.at}`];
      openings.push(Object.freeze({
        allowance: allowance.id, meter: window.meter,
        opening: openingOf({
          move: "supply", id, by: poster,
          resource: allowance.id, amount, unit: reading.unit, until: window.until,
          costs: costsOf(reading), admits: allowance.admits === "whole" ? "whole" : "open",
          scope, tags: [supplyTag(allowance.id)], at: now,
        }),
      }));
      observations.push(Object.freeze({ thread: id, measure: "remaining", value: amount, observed: reading.at, evidence }));
    }
  }
  return Object.freeze({
    kind: "allowance-supplies.v1",
    poster,
    domain: Object.freeze({ tags: Object.freeze(read.map(supplyTag)) }),
    evidence: `allowance-ledger:${read.join(",")}@${now}`,
    openings: Object.freeze(openings),
    observations: Object.freeze(observations),
  });
}

/** The node's measurement of its own subscriptions, served for the enterprise that derives supplies from it. */
export function allowanceSuppliesOperations({ storePath } = {}) {
  return Object.freeze([operation({
    verb: "allowance-supplies", inputFormat: "json", outputFormat: "json",
    summary: "Derive the supplies this node's subscription windows offer from its allowance ledger.",
    description: "Domain: { poster }. Reads the host-wide allowance ledger and returns a derivation by poster: { kind: allowance-supplies.v1, poster, domain: { tags: [supply-<allowance id> for each pool read] }, evidence, openings: [{ allowance, meter, opening }], observations: [{ thread, measure: remaining, value, observed, evidence }] }, one supply per window whose projected-unspent capacity is positive, until the window turns. An enterprise derives from it by naming { operation: \"allowance-supplies\" } among its derives.",
    reads: ["allowance-ledger"],
    effects: { class: "host-read", replay: "safe", coordination: "coordination-free", deterministic: "unmeasured", totality: "partial" },
    run: (input) => allowanceSuppliesOf({ poster: input?.poster, ...(storePath === undefined ? {} : { storePath }) }),
  })]);
}
