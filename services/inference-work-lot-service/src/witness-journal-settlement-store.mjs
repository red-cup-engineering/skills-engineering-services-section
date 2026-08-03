import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createSemanticRecordJournal } from "@red-cup-engineering/semantic-record-journal-service";

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
    const keystore = JSON.parse(readFileSync(resolve(settlementRoot, "data", "evm", "keystores", `${caip2.replace(":", "-")}.json`), "utf8"));
    if (typeof keystore.address !== "string" || !/^[0-9a-fA-F]{40}$/u.test(keystore.address)) throw new Error("settlement keystore lacks one public EVM address");
    account = `${caip2}:0x${keystore.address}`;
  }
  const exact = CAIP10.exec(account);
  if (!exact || exact[1] !== chain[1]) throw new Error("settlement account must be a CAIP-10 address on the selected chain");
  return Object.freeze({ actor, settlement: account });
}

export async function createInferenceSettlementStore({ settlementRoot, actor = DEFAULT_ACTOR, caip2, settlement } = {}) {
  if (!settlementRoot) throw new Error("settlementRoot is required");
  const account = resolveLocalSettlementAccount(settlementRoot, { actor, caip2, settlement });
  const journal = createSemanticRecordJournal({ root: settlementRoot, objectKind: "inference-work-lot.semantic-record.v1" });
  return Object.freeze({
    ...account,
    records: async (category) => journal.query({ category }).map(({ record }) => record),
    async record({ category, recordedAt, record, charge = { support: true, refutation: false }, relation }) {
      const projection = journal.record({ category, recordedAt, record, charge, ...(relation ? { relation } : {}) });
      return Object.freeze({
        digest: projection.id,
        documentNi: projection.id,
        statementCount: projection.claimsAppended,
        reference: Object.freeze({ profile: "org.red-cup-engineering.semantic-record-journal.v1", root: journal.root, id: projection.id }),
        charge: projection.charge,
      });
    },
  });
}
