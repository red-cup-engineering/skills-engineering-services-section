#!/usr/bin/env node
import { serveMcpToolServerStdio } from "@red-cup-engineering/model-context-protocol-services-section";
import { closeDemand, openDemand, position, recordCustomerOutcome, recordDemandCompletionCondition, recordDemandObstruction, recordLeaderAuthorityGrant, recordProviderResourceGrant, recordResource, recordResourceConsumption, recordSupplierConsideration, recordSupplierExchange, recordSupplierOffer, revokeLeaderAuthorityGrant } from "./enterprise.mjs";
import { observeNativeUsage } from "./native-usage.mjs";
import { promptWorkBoard, setPromptWorkState } from "./prompt-cycle.mjs";
import { admitNextHistoricalDemand, observeHistoricalDemands } from "./historical-demands.mjs";
import { evaluateHarnessParity } from "./harness-parity.mjs";
import { observeRelevantPriorSessionEvidence } from "./relevant-history.mjs";
import { notebookResearchJobBoard, openNotebookResearchJob, settleNotebookResearchJob } from "./notebook-research-jobs.mjs";
import { compileNetworkToolEvidence, readToolEvidence } from "./tool-evidence.mjs";
import { contextResolverContract } from "./context-address.mjs";
import { createGithubSoftwareInductionCarrier } from "./github-software-induction.mjs";

const considerationSchema = { type: "object", required: ["denomination", "amount", "source"], properties: { denomination: { type: "string" }, amount: { type: "object" }, source: { type: "string" } }, additionalProperties: false };
const githubSoftwareInduction = createGithubSoftwareInductionCarrier();

const tools = [
  { name: "observe_codex_enterprise_position", description: "Read Codex's own customer-enterprise position, supplier pressure, unresolved self-execution demand, and honestly unknown P/L fields.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "observe_codex_harness_parity", description: "Read the digest-bound meet-or-beat position for every preserved Codex harness capability.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "observe_codex_usage_gauges", description: "Read the latest compact native turn gauge, including call/result correlation and output-byte accounting without retaining transcript contents. Weekly history and all turns are opt-in.", inputSchema: { type: "object", properties: { sessionId: { type: "string" }, turnId: { type: "string" }, includeWeekly: { type: "boolean", default: false }, includeAllTurns: { type: "boolean", default: false } }, additionalProperties: false } },
  { name: "compile_codex_tool_evidence", description: "Compile one explicitly bounded tool result into a content-addressed, typed, decision-relevant receipt. Exact bytes remain in the enterprise evidence store; unlike resource quantities are never collapsed into one score.", inputSchema: { type: "object", required: ["provider", "raw", "maximumRawBytes"], properties: { provider: { const: "urn:ame:bare-cedar-fog-codex" }, raw: { type: "string", maxLength: 16777216 }, maximumRawBytes: { type: "integer", minimum: 1024, maximum: 16777216 }, tool: { type: "string" }, input: { type: "object" }, model: { type: "string" }, operation: { type: "string" }, sourceProvider: { type: "string" }, phase: { enum: ["context-discovery", "implementation", "verification", "coordination", "final-reasoning"] } }, additionalProperties: false } },
  { name: "read_codex_tool_evidence", description: "Read one exact bounded page from a local content-addressed tool-evidence receipt. The default and maximum page sizes prevent drill-down from replaying a corpus into premium context.", inputSchema: { type: "object", required: ["receipt"], properties: { receipt: { type: "string", pattern: "^ni:///sha-256;[A-Za-z0-9_-]{43}$" }, stream: { type: "string", description: "Named carrier such as stdout or stderr; defaults to the first carrier." }, offset: { type: "integer", minimum: 0, default: 0 }, maximumBytes: { type: "integer", minimum: 1, maximum: 16384, default: 8192 } }, additionalProperties: false } },
  { name: "resolve_codex_context_address", description: "Type-check a canonical Codex proof-path context address and return its resolver operation. Dynamic selectors resolve through the returned bounded operation; opaque receipt hashes are not injected into model context.", inputSchema: { type: "object", required: ["address"], properties: { address: { type: "string", pattern: "^codex/actor/bare-cedar-fog-codex/(?:continuity/session-start|prompt-cycle/active|evidence/current-tool-result)$" } }, additionalProperties: false } },
  { name: "observe_codex_session_context", description: "Resolve the canonical session-start context selector into bounded enterprise position and work-board observations.", inputSchema: { type: "object", required: ["address"], properties: { address: { const: "codex/actor/bare-cedar-fog-codex/continuity/session-start" } }, additionalProperties: false } },
  { name: "observe_codex_prompt_context", description: "Resolve the canonical active prompt-cycle selector into its bounded work-board and enterprise-position observations.", inputSchema: { type: "object", required: ["address"], properties: { address: { const: "codex/actor/bare-cedar-fog-codex/prompt-cycle/active" } }, additionalProperties: false } },
  { name: "observe_codex_tool_context", description: "Resolve the canonical current-tool-result selector into the newest bounded tool-evidence receipt observation. Request exact bytes separately and explicitly with its returned receipt.", inputSchema: { type: "object", required: ["address"], properties: { address: { const: "codex/actor/bare-cedar-fog-codex/evidence/current-tool-result" } }, additionalProperties: false } },
  { name: "observe_github_software_induction_readiness", description: "Read whether the GitHub software-induction sender and provider configuration names are present. Values, including credentials and paths, are never returned.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "github_software_induction", description: "Submit one GitHub software-induction proposal only with complete configured sender/provider identity and exact explicit external-mutation confirmation.", inputSchema: { type: "object", required: ["proposal", "confirmExternalMutation"], properties: { proposal: { type: "object" }, confirmExternalMutation: { const: true } }, additionalProperties: false } },
  { name: "observe_codex_work_board", description: "Read a bounded newest-first Codex work summary. Exact source prompts are omitted unless explicitly requested.", inputSchema: { type: "object", properties: { states: { type: "array", items: { enum: ["open", "in-progress", "blocked", "completed", "withdrawn"] } }, limit: { type: "integer", minimum: 1, maximum: 50, default: 10 }, includeSourcePrompts: { type: "boolean", default: false } }, additionalProperties: false } },
  { name: "observe_historical_codex_demands", description: "Page through exact provider-native user prompts newest-to-oldest across retained Codex session transcripts, with source digests, deduplication, admission state, totals, and parse problems. Pagination has no global ceiling.", inputSchema: { type: "object", required: ["offset", "pageSize"], properties: { offset: { type: "integer", minimum: 0 }, pageSize: { type: "integer", minimum: 1 } }, additionalProperties: false } },
  { name: "observe_relevant_prior_session_evidence", description: "Select exact prior-session evidence for the current normalized Leader move without returning or caching raw prompt bodies, replaying stale work, or inferring semantic similarity.", inputSchema: { type: "object", required: ["leaderMove", "session"], properties: { leaderMove: { type: "object", required: ["desiredOutcome", "source"], properties: { desiredOutcome: { type: "string" }, source: { type: "string" }, customer: { const: "urn:leader:emsenn" } }, additionalProperties: false }, session: { type: "string" }, cap: { type: "integer", minimum: 1 } }, additionalProperties: false } },
  { name: "admit_next_historical_codex_demand", description: "Admit exactly the next pending retained user demand in newest-to-oldest order into a persisted MAPE cycle and the free-cloud work-item queue, retaining transcript source receipts.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "update_codex_work", description: "Update one known persistent work cycle without rewriting its source prompt or inferring completion from a turn boundary.", inputSchema: { type: "object", required: ["cycle", "state", "issuer", "evidence", "observedAt"], properties: { cycle: { type: "string" }, state: { enum: ["open", "in-progress", "blocked", "completed", "withdrawn"] }, issuer: { type: "string" }, evidence: { type: "string" }, observedAt: { type: "string" } }, additionalProperties: false } },
  { name: "open_notebook_research_job", description: "Queue one bounded NotebookLM Analyze or Plan job against a known prompt cycle. The job carries a source search, exact question, artifact type, and no execution authority.", inputSchema: { type: "object", required: ["cycle", "stage", "match", "question", "observedAt"], properties: { cycle: { type: "string" }, stage: { enum: ["analyze", "plan"] }, match: { type: "string" }, question: { type: "string" }, artifactType: { enum: ["data-table", "json", "code", "report"] }, resultSchema: { type: "string" }, sourceLimit: { type: "integer", minimum: 1 }, requestedBy: { type: "string" }, observedAt: { type: "string" } }, additionalProperties: false } },
  { name: "observe_notebook_research_jobs", description: "Read queued and settled NotebookLM Analyze/Plan jobs linked to durable prompt cycles.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "settle_notebook_research_job", description: "Attach one seated NotebookLM exchange record to a queued research job; artifacts remain Analyze/Plan evidence, never an execution authorization.", inputSchema: { type: "object", required: ["job", "exchangePath", "observedAt"], properties: { job: { type: "string" }, exchangePath: { type: "string" }, observedAt: { type: "string" } }, additionalProperties: false } },
  { name: "record_leader_authority_grant", description: "Record one qualitative, revocable Leader authority grant. It has scope but no resource quantity or spending power.", inputSchema: { type: "object", required: ["issuer", "scope", "revocable", "evidence", "observedAt"], properties: { issuer: { const: "urn:leader:emsenn" }, recipient: { const: "urn:ame:bare-cedar-fog-codex" }, scope: { type: "array", minItems: 1, items: { type: "string" } }, revocable: { type: "boolean" }, evidence: { type: "string" }, observedAt: { type: "string" } }, additionalProperties: false } },
  { name: "revoke_leader_authority_grant", description: "Record revocation of one revocable Leader authority grant.", inputSchema: { type: "object", required: ["grant", "issuer", "evidence", "observedAt"], properties: { grant: { type: "string" }, issuer: { const: "urn:leader:emsenn" }, evidence: { type: "string" }, observedAt: { type: "string" } }, additionalProperties: false } },
  { name: "open_codex_demand", description: "Open a durable Codex-owned demand under one named active Leader authority grant and observable completion conditions.", inputSchema: { type: "object", required: ["desiredOutcome", "authorityGrant", "completionConditions", "source", "observedAt"], properties: { desiredOutcome: { type: "string" }, authorityGrant: { type: "string" }, completionConditions: { type: "array", minItems: 1, items: { type: "string" } }, source: { type: "string" }, observedAt: { type: "string" }, reactionLaw: { type: "string" } }, additionalProperties: false } },
  { name: "record_supplier_offer", description: "Retain one provider-authored offer against a known Codex demand; a quote is not an incurred cost.", inputSchema: { type: "object", required: ["demand", "provider", "capability", "offer", "protocol", "observedAt"], properties: { demand: { type: "string" }, provider: { type: "string" }, capability: { type: "string" }, offer: { type: "string" }, protocol: { type: "string" }, observedAt: { type: "string" }, quotedConsideration: considerationSchema }, additionalProperties: false } },
  { name: "record_codex_demand_obstruction", description: "Retain a witnessed missing capability that currently prevents a known Codex demand from reaching a supplier exchange.", inputSchema: { type: "object", required: ["demand", "issuer", "missingCapability", "reason", "evidence", "observedAt"], properties: { demand: { type: "string" }, issuer: { type: "string" }, missingCapability: { type: "string" }, reason: { type: "string" }, evidence: { type: "string" }, observedAt: { type: "string" } }, additionalProperties: false } },
  { name: "record_supplier_exchange", description: "Retain a real provider-authored A2A/ActivityPub/EVM/MCP supplier receipt in Codex's own trajectory.", inputSchema: { type: "object", required: ["provider", "capability", "receipt", "protocol", "observedAt"], properties: { demand: { type: "string" }, offer: { type: "string" }, provider: { type: "string" }, capability: { type: "string" }, receipt: { type: "string" }, protocol: { type: "string" }, observedAt: { type: "string" }, quotedConsideration: considerationSchema }, additionalProperties: false } },
  { name: "record_supplier_consideration", description: "Retain a separately witnessed quoted, authorized, incurred, or settled consideration fact for a known exchange.", inputSchema: { type: "object", required: ["issuer", "exchange", "phase", "consideration", "evidence", "observedAt"], properties: { issuer: { type: "string" }, exchange: { type: "string" }, phase: { enum: ["quoted", "authorized", "incurred", "settled"] }, consideration: considerationSchema, evidence: { type: "string" }, observedAt: { type: "string" } }, additionalProperties: false } },
  { name: "record_customer_outcome", description: "Retain a typed acceptance or rejection issued by the named customer endpoint for a real supplier exchange.", inputSchema: { type: "object", required: ["issuer", "exchange", "disposition", "evidence", "observedAt"], properties: { issuer: { const: "urn:leader:emsenn" }, exchange: { type: "string" }, disposition: { enum: ["accepted", "rejected"] }, evidence: { type: "string" }, observedAt: { type: "string" } }, additionalProperties: false } },
  { name: "record_demand_completion_condition", description: "Record evidence that one completion condition named by a demand has been observed.", inputSchema: { type: "object", required: ["demand", "condition", "issuer", "evidence", "observedAt"], properties: { demand: { type: "string" }, condition: { type: "string" }, issuer: { type: "string" }, evidence: { type: "string" }, observedAt: { type: "string" } }, additionalProperties: false } },
  { name: "record_provider_resource_grant", description: "Record a provider/API resource grant with an exact native quantity or an explicitly unknown one. It never records a quota or cost by implication.", inputSchema: { type: "object", required: ["provider", "surface", "credentialReference", "resource", "quantityKind", "quantity", "scope", "revocable", "evidence", "observedAt"], properties: { provider: { type: "string" }, surface: { type: "string" }, credentialReference: { type: "string" }, resource: { type: "string" }, quantityKind: { enum: ["tokens", "money", "wall-time", "rate-limit-pressure", "provider-work"] }, quantity: { type: "object" }, scope: { type: "array", minItems: 1, items: { type: "string" } }, revocable: { type: "boolean" }, evidence: { type: "string" }, observedAt: { type: "string" } }, additionalProperties: false } },
  { name: "record_resource_consumption", description: "Record native resource consumption for one operation under a known provider/API resource grant.", inputSchema: { type: "object", required: ["grant", "operation", "quantityKind", "amount", "unit", "source", "observedAt"], properties: { grant: { type: "string" }, operation: { type: "string" }, quantityKind: { enum: ["tokens", "money", "wall-time", "rate-limit-pressure", "provider-work"] }, amount: { type: "object" }, unit: { type: "string" }, source: { type: "string" }, observedAt: { type: "string" } }, additionalProperties: false } },
  { name: "record_codex_resource", description: "Retain one provider-native resource observation without translating tokens, money, time, or provider work into each other.", inputSchema: { type: "object", required: ["provider", "surface", "quantityKind", "amount", "unit", "source", "observedAt"], properties: { provider: { type: "string" }, surface: { type: "string" }, quantityKind: { enum: ["tokens", "money", "wall-time", "rate-limit-pressure", "provider-work"] }, amount: { type: "object" }, unit: { type: "string" }, source: { type: "string" }, observedAt: { type: "string" } }, additionalProperties: false } },
  { name: "close_codex_demand", description: "Close a known demand as fulfilled only after every named completion condition is observed under its active Leader authority, or withdraw it without simulating fulfillment.", inputSchema: { type: "object", required: ["demand", "issuer", "disposition", "evidence", "observedAt"], properties: { demand: { type: "string" }, issuer: { type: "string" }, disposition: { enum: ["fulfilled", "withdrawn"] }, evidence: { type: "string" }, observedAt: { type: "string" } }, additionalProperties: false } },
];
function result(value) { return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value }; }

function compactWorkBoard(board, args) {
  const filtered = Array.isArray(args.states) ? board.filter((item) => args.states.includes(item.state)) : board;
  const limit = Number.isSafeInteger(args.limit) ? args.limit : 10;
  const selected = [...filtered].sort((left, right) => String(right.observedAt ?? "").localeCompare(String(left.observedAt ?? ""))).slice(0, limit);
  return {
    total: filtered.length,
    returned: selected.length,
    items: selected.map((item) => {
      const { prompt, evidence, workItems, ...identity } = item;
      return {
        ...identity,
        workItemCount: Array.isArray(workItems) ? workItems.length : 0,
        workItems: Array.isArray(workItems) ? workItems : [],
        evidencePreview: typeof evidence === "string" ? evidence.slice(0, 512) : null,
        ...(args.includeSourcePrompts === true ? { prompt } : {}),
      };
    }),
  };
}
async function call(name, args) {
  if (name === "observe_codex_enterprise_position") return position();
  if (name === "observe_codex_harness_parity") return evaluateHarnessParity();
  if (name === "observe_codex_usage_gauges") { const gauges = observeNativeUsage({ ...args, includeWeekly: args.includeWeekly === true }); return args.includeAllTurns === true ? gauges : { type: gauges.type, observedAt: gauges.observedAt, latestTurn: gauges.latestTurn, weekly: gauges.weekly, monetaryPricePerToken: gauges.monetaryPricePerToken, transcriptRetainedByEnterprise: gauges.transcriptRetainedByEnterprise }; }
  if (name === "compile_codex_tool_evidence") return compileNetworkToolEvidence(args);
  if (name === "read_codex_tool_evidence") return readToolEvidence(args);
  if (name === "resolve_codex_context_address") return contextResolverContract(args.address);
  if (name === "observe_codex_session_context") {
    contextResolverContract(args.address);
    return { type: "CodexSessionContext", address: args.address, enterprise: position(), workBoard: compactWorkBoard(promptWorkBoard(), { limit: 10 }) };
  }
  if (name === "observe_codex_prompt_context") {
    contextResolverContract(args.address);
    return { type: "CodexPromptContext", address: args.address, enterprise: position(), workBoard: compactWorkBoard(promptWorkBoard(), { limit: 10 }) };
  }
  if (name === "observe_codex_tool_context") {
    contextResolverContract(args.address);
    const latest = readTrajectory().filter((row) => row.type === "ToolEvidenceObserved").at(-1) ?? null;
    return { type: "CodexToolContext", address: args.address, evidence: latest ? { receipt: latest.receipt, phase: latest.phase, tool: latest.tool, provider: latest.provider, truncated: latest.truncated, toolOutputBytes: latest.toolOutputBytes } : null };
  }
  if (name === "observe_github_software_induction_readiness") return githubSoftwareInduction.observeReadiness();
  if (name === "github_software_induction") return githubSoftwareInduction.submit(args);
  if (name === "observe_codex_work_board") return compactWorkBoard(promptWorkBoard(), args);
  if (name === "observe_relevant_prior_session_evidence") return observeRelevantPriorSessionEvidence(args);
  if (name === "observe_historical_codex_demands") {
    const ledger = observeHistoricalDemands();
    const offset = args.offset, pageSize = args.pageSize;
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(pageSize) || pageSize < 1) throw new TypeError("historical demand observation requires a nonnegative offset and positive pageSize");
    return { ...ledger, demands: ledger.demands.slice(offset, offset + pageSize), page: { offset, pageSize, returned: Math.min(pageSize, Math.max(0, ledger.demands.length - offset)), nextOffset: offset + pageSize < ledger.demands.length ? offset + pageSize : null } };
  }
  if (name === "admit_next_historical_codex_demand") return admitNextHistoricalDemand();
  if (name === "update_codex_work") return { record: setPromptWorkState(args) };
  if (name === "record_leader_authority_grant") return recordLeaderAuthorityGrant(args);
  if (name === "revoke_leader_authority_grant") return revokeLeaderAuthorityGrant(args);
  if (name === "open_notebook_research_job") return { record: openNotebookResearchJob(args), jobs: notebookResearchJobBoard() };
  if (name === "observe_notebook_research_jobs") return notebookResearchJobBoard();
  if (name === "settle_notebook_research_job") return { record: settleNotebookResearchJob(args), jobs: notebookResearchJobBoard() };
  if (name === "open_codex_demand") return openDemand(args);
  if (name === "record_supplier_offer") return recordSupplierOffer(args);
  if (name === "record_codex_demand_obstruction") return recordDemandObstruction(args);
  if (name === "record_supplier_exchange") return recordSupplierExchange(args);
  if (name === "record_supplier_consideration") return recordSupplierConsideration(args);
  if (name === "record_customer_outcome") return recordCustomerOutcome(args);
  if (name === "record_demand_completion_condition") return recordDemandCompletionCondition(args);
  if (name === "record_provider_resource_grant") return recordProviderResourceGrant(args);
  if (name === "record_resource_consumption") return recordResourceConsumption(args);
  if (name === "record_codex_resource") return recordResource(args);
  if (name === "close_codex_demand") return closeDemand(args);
  throw new Error(`unknown Codex enterprise operation ${name}`);
}
await serveMcpToolServerStdio({
  serverInfo: { name: "bare-cedar-fog-codex-enterprise", version: "0.4.0" },
  instructions: "Record Codex enterprise receipts; never infer acceptance or cost.",
  tools,
  dispatchResult: "mcp",
  dispatch: async (name, args) => result(await call(name, args)),
});
