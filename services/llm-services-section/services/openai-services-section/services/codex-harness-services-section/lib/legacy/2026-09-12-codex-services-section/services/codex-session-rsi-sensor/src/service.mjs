#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createSettlementStore } from "@red-cup-engineering/settlement-record-store-service";
import { ACTOR, CONTEXT, ROOT, inspectBoardBoundary, loadPolicy, measureSessionWindow, record, selectOpportunity } from "./sensor.mjs";

const CATEGORY = "ni:///sha-256;Vy8ofltNXRqQ2tDGGNV2hcTt3TkExTkpQsysWjDentM.sensor-history";
function response(type, source, object) { return record({ "@context": CONTEXT, type, actor: ACTOR, target: source?.actor ?? null, inReplyTo: source?.id ?? null, object: { ...object, customerTerritoryMutation: false } }); }
function pulseProblem(activity, policy) { return activity?.["@context"] !== CONTEXT || activity.type !== "Create" || activity.actor !== policy.clockActor || activity.target !== ACTOR || activity.capability !== policy.deliveryCapabilityId || activity.object?.type !== "CodexSessionRsiSensorPulse" || !/#([0-9]+)$/u.test(activity.object.pulseId ?? "") ? "exact-contracted-clockkeeper-pulse-required" : null; }
function defaultLedger(options = {}) { const settlement = createSettlementStore({ settlementRoot: ROOT, agentUrl: options.agentUrl ?? process.env.WITNESS_JOURNAL_RDF_AGENT }); return { read: () => settlement.records(CATEGORY), append: (value, at) => settlement.record({ category: CATEGORY, recordedAt: at, record: value }) }; }
export function memoryLedger(seed = []) { const rows = [...seed]; return { read: () => [...rows], append: async (value) => { rows.push(value); return value; } }; }
export function invokeBoard(board, activity) { const boundary = inspectBoardBoundary(board); const result = spawnSync(process.execPath, [boundary.entry, "--operation", board.submitOperation], { cwd: boundary.root, input: JSON.stringify(activity), encoding: "utf8", timeout: 60_000, maxBuffer: 16 * 1024 * 1024, env: Object.fromEntries(["WITNESS_JOURNAL_RDF_AGENT", "IMPROVEMENT_BOARD_SETTLEMENT", "IMPROVEMENT_BOARD_DATA_ROOT"].flatMap((name) => process.env[name] === undefined ? [] : [[name, process.env[name]]])) }); let output; try { output = JSON.parse(result.stdout); } catch { throw new Error(`board ingress returned no typed JSON: ${String(result.stderr).slice(-1000)}`); } return output; }

export async function advanceSensor(activity, options = {}) {
  const policy = options.policy ?? loadPolicy(), at = options.recordedAt ?? new Date().toISOString(), problem = pulseProblem(activity, policy);
  if (problem) return response("Reject", activity, { type: "CodexSessionRsiSensorRefusal", reason: problem, customerMutation: false });
  const ledger = options.ledger ?? defaultLedger(options), prior = ledger.read().filter((item) => item.type === "CodexSessionRsiSensorTick").sort((left, right) => left.toInclusive.localeCompare(right.toInclusive)).at(-1);
  const fromExclusive = prior?.toInclusive ?? new Date(Date.parse(at) - policy.initialLookbackSeconds * 1000).toISOString();
  let measurements; try { measurements = (options.measure ?? measureSessionWindow)({ sessionRoot: policy.sessionRoot, fromExclusive, toInclusive: at, premiumModels: policy.premiumModels }); } catch (error) { return response("Reject", activity, { type: "CodexSessionRsiSensorRefusal", reason: error.message, customerMutation: false }); }
  const opportunity = selectOpportunity(measurements, policy, at); let boardReceipt = null, disposition = "quiet";
  if (opportunity) {
    const publication = record({ "@context": CONTEXT, type: "Create", actor: ACTOR, target: policy.board.actor, object: opportunity });
    try { boardReceipt = await (options.publish ?? invokeBoard)(policy.board, publication); disposition = boardReceipt?.type === "Accept" ? "published" : "customer-refused"; }
    catch (error) { disposition = "transport-residue"; boardReceipt = { type: "TransportResidue", reason: error.message }; }
  }
  const tick = record({ type: "CodexSessionRsiSensorTick", pulse: activity.id, fromExclusive, toInclusive: at, measuredSessions: measurements.length, selectedOpportunity: opportunity?.id ?? null, disposition, boardReceipt: boardReceipt?.id ?? null, transcriptDisclosed: false, inferenceCalls: 0, customerMutation: false }); await ledger.append(tick, at);
  return response("Accept", activity, { type: "CodexSessionRsiSensorTickReceipt", tick: tick.id, fromExclusive, toInclusive: at, measuredSessions: measurements.length, opportunity: opportunity?.id ?? null, disposition, boardReceipt, nextTickRequired: true, transcriptDisclosed: false, inferenceCalls: 0, customerMutation: false });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { try { const input = JSON.parse(readFileSync(0, "utf8")); process.stdout.write(`${JSON.stringify(await advanceSensor(input), null, 2)}\n`); } catch (error) { process.stderr.write(`${error.stack ?? error.message}\n`); process.exitCode = 1; } }
