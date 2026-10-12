import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { each, has, put } from "@red-cup-engineering/semiotic-eavt-services-section/store";
import { semanticId } from "@red-cup-engineering/computer-content-address-engineering-services-section/semiotic-content-address";
import { inferenceStateRootOf } from "./state-root.mjs";

const DEFAULT_ACTOR = "urn:ame:inference-work-lot-service";
const CAIP2 = /^eip155:([1-9][0-9]*)$/u;
const CAIP10 = /^eip155:([1-9][0-9]*):0x([0-9a-fA-F]{40})$/u;

export function resolveLocalSettlementAccount(settlementRoot, {
  actor = DEFAULT_ACTOR,
  caip2 = process.env.SETTLEMENT_CAIP2 ?? "eip155:5615610",
  settlement = process.env.SETTLEMENT_ACCOUNT,
} = {}) {
  const chain = CAIP2.exec(caip2);
  if (!chain) throw new Error("settlement CAIP-2 must name one EIP-155 chain");
  let account = settlement;
  if (!account) {
    const accountRecord = JSON.parse(readFileSync(resolve(settlementRoot, "content", "dispatch", "evm", "accounts", `${caip2.replace(":", "-")}.json`), "utf8"));
    if (accountRecord?.chain?.caip2 !== caip2 || typeof accountRecord?.account?.caip10 !== "string") {
      throw new Error("settlement account record does not bind one public CAIP-10 account to the requested chain");
    }
    account = accountRecord.account.caip10;
  }
  const exact = CAIP10.exec(account);
  if (!exact || exact[1] !== chain[1]) throw new Error("settlement account must be a CAIP-10 address on the selected chain");
  return Object.freeze({ actor, settlement: account });
}

// The settlement root is read-only content (the account records); the journals are written under the
// inference state root, never into the package.
// A category names the store type its records are held under: `typed-inference.procurement` is `typed-inference-procurement`.
const typeOf = (category) => category.replace(/\.v\d+$/u, "").replaceAll(".", "-");

function semanticStore({ settlementRoot, journalRoot = inferenceStateRootOf(), actor, caip2, settlement }) {
  if (!settlementRoot) throw new Error("settlementRoot is required");
  const account = resolveLocalSettlementAccount(settlementRoot, { actor, caip2, settlement });
  return Object.freeze({
    ...account,
    records: async (category) => [...each(journalRoot, typeOf(category))].map(({ record }) => record),
    async record({ category, record }) {
      const type = typeOf(category), appended = !has(journalRoot, type, semanticId(record)), id = put(journalRoot, type, record);
      return Object.freeze({
        digest: id,
        documentNi: id,
        appended,
        reference: Object.freeze({ profile: "org.red-cup-engineering.semiotic-eavt-store.v1", root: journalRoot, id }),
      });
    },
  });
}

export async function createInferenceSettlementStore({ settlementRoot, journalRoot, actor = DEFAULT_ACTOR, caip2, settlement } = {}) {
  return semanticStore({ settlementRoot, ...(journalRoot === undefined ? {} : { journalRoot }), actor, caip2, settlement });
}

/** V2 is an append-only market witness vocabulary. V1 procurement summaries
 * are retained and are never reinterpreted as missing per-attempt evidence. */
export async function createInferenceMarketWitnessStore({ settlementRoot, journalRoot, actor = DEFAULT_ACTOR, caip2, settlement } = {}) {
  return semanticStore({ settlementRoot, ...(journalRoot === undefined ? {} : { journalRoot }), actor, caip2, settlement });
}
