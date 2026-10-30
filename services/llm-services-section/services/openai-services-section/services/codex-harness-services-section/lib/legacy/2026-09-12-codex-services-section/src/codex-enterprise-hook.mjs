#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { appendObservation, claimHookDelivery, identity, ACTOR } from "./enterprise.mjs";
import { observeNativeUsage } from "./native-usage.mjs";
import { governedMutationDisposition, pausePromptCycleBoundary, providerLaunchDisposition, toolUseDisposition } from "./prompt-cycle.mjs";
import { boundedDiscoveryRewrite, compileToolEvidence, declaredToolBudget, recordToolBudget } from "./tool-evidence.mjs";
import { contextAddressForHookEvent } from "./context-address.mjs";
import { semanticIdentity } from "./semiotic-circuit.mjs";

const digest = (value) => semanticIdentity(value, "bare-cedar-fog-codex.hook-material").id;
export const HOOK_ADDITIONAL_CONTEXT_LIMIT = 512;
const EXACT_OBSERVATION_TOOL = "read_codex_tool_evidence";
const HARNESS_POLICY = new URL("../agents/harness/codex-agent-harness.json", import.meta.url);

function launchPolicy(options = {}) {
  return options.launchPolicy ?? JSON.parse(readFileSync(HARNESS_POLICY, "utf8")).delegationPolicy;
}

function semanticContext(event, evidence) {
  const coordinate = contextAddressForHookEvent(event);
  if (!evidence || evidence.type !== coordinate.type || !Array.isArray(evidence.observations)) {
    throw new TypeError("known hook context requires one typed coordinate and observation set");
  }
  const observations = evidence.observations.map(String);
  if (observations.some((observation) => !/^[a-z][a-z0-9_]*$/u.test(observation))) {
    throw new TypeError("hook context observations must be canonical operation names");
  }
  return `ADDRESS ${coordinate.address}. TYPE ${coordinate.type}. RESOLVE ${coordinate.resolver}. READ ${observations.join(", ")}.`;
}

function semanticEvidenceContext() {
  const coordinate = contextAddressForHookEvent("PostToolUse");
  return `ADDRESS ${coordinate.address}. TYPE ${coordinate.type}. RESOLVE ${coordinate.resolver}.`;
}

export function hookDeliveryIdentity(input) {
  const hookEventName = String(input?.hook_event_name ?? "unknown");
  return identity({
    type: "CodexHookDelivery",
    version: 1,
    hookEventName,
    sessionId: input?.session_id ?? null,
    turnId: input?.turn_id ?? null,
    nativeEventId: input?.hook_event_id ?? input?.event_id ?? null,
    toolUseId: input?.tool_use_id ?? null,
    agentId: input?.agent_id ?? input?.subagent_id ?? null,
    payload: identity(input ?? null),
  });
}

function subagentCapability(input) {
  const kind = String(input.agent_type ?? input.subagent_type ?? "bounded-agent-work").replace(/[^a-zA-Z0-9._-]/gu, "-");
  const model = String(input.model ?? "unknown-model").replace(/[^a-zA-Z0-9._-]/gu, "-");
  return `urn:capability:codex-subagent:${kind}:${model}`;
}

function subagentOperation(input) {
  return digest({
    session: input.session_id ?? "unknown",
    turn: input.turn_id ?? null,
    agent: input.agent_id ?? input.subagent_id ?? "unknown",
    type: input.agent_type ?? input.subagent_type ?? "unknown",
    model: input.model ?? "unknown",
  });
}
function observableSubagentResources(input) {
  const usage = input.usage ?? input.token_usage ?? null;
  const quantities = usage && typeof usage === "object" ? {
    inputTokens: Number.isSafeInteger(usage.input_tokens ?? usage.inputTokens) ? (usage.input_tokens ?? usage.inputTokens) : null,
    outputTokens: Number.isSafeInteger(usage.output_tokens ?? usage.outputTokens) ? (usage.output_tokens ?? usage.outputTokens) : null,
    cachedInputTokens: Number.isSafeInteger(usage.cached_input_tokens ?? usage.cachedInputTokens) ? (usage.cached_input_tokens ?? usage.cachedInputTokens) : null,
  } : null;
  const result = typeof input.last_assistant_message === "string" ? { amount: Buffer.byteLength(input.last_assistant_message), unit: "bytes", retained: false } : null;
  const elapsed = typeof input.elapsed_seconds === "number" && Number.isFinite(input.elapsed_seconds) ? { amount: input.elapsed_seconds, unit: "seconds" } : null;
  return { tokens: quantities, result, elapsed };
}

function providerProvenance(input) {
  const value = input?.provider ?? input?.provider_id ?? input?.provider_name;
  return typeof value === "string" && value.trim() ? value.trim() : "provider-native";
}

function persistHookContext(event, evidence, options = {}) {
  const compiled = compileToolEvidence({
    hook_event_name: event,
    tool_name: "codex-hook-context",
    tool_input: { event },
    tool_response: evidence,
    model: null,
    tool_use_id: null,
  }, {
    ...(options.enterpriseOptions ?? {}),
    provider: ACTOR,
    observedAt: options.observedAt,
    budget: {
      maximumPremiumContextBytes: HOOK_ADDITIONAL_CONTEXT_LIMIT,
      maximumFindingCount: 1,
      maximumFindingBytes: 64,
      maximumRawCaptureBytes: 33_554_432,
      phase: "context-discovery",
    },
  });
  return Object.freeze({
    receipt: compiled.receipt.id,
    context: semanticContext(event, evidence),
  });
}

export function handle(input, options = {}) {
  if (["SessionStart", "UserPromptSubmit"].includes(input.hook_event_name)) return {}; // Native root instructions and memories already supply startup context.
  const enterpriseOptions = options.enterpriseOptions ?? {};
  // Admission is pure and must run before lifecycle de-duplication. Otherwise
  // retrying one denied or defaulted native spawn would silently receive {}.
  const launch = input.hook_event_name === "PreToolUse"
    ? providerLaunchDisposition(input, { ...enterpriseOptions, launchPolicy: launchPolicy(options) })
    : null;
  if (launch) {
    if (!launch.allowed) return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: launch.reason,
      },
    };
    if (launch.applies && launch.updatedInput) return {
      systemMessage: "Bounded provider work defaults to Terra with medium reasoning.",
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        updatedInput: launch.updatedInput,
      },
    };
  }
  const deliveryIdentity = hookDeliveryIdentity(input);
  const delivery = (options.claimDelivery ?? claimHookDelivery)(deliveryIdentity, enterpriseOptions);
  if (!delivery.claimed) return {};
  const at = (options.now ?? (() => new Date().toISOString()))();
  const common = { actor: ACTOR, hookDelivery: deliveryIdentity, sessionFace: digest(input.session_id ?? "unknown"), turn: input.turn_id ?? null, observedAt: at };
  let output = {};
  if (input.hook_event_name === "PreToolUse") {
    const budget = declaredToolBudget(input);
    recordToolBudget(input, budget, { ...enterpriseOptions, observedAt: at });
    const rewrite = boundedDiscoveryRewrite(input, { budget, provider: providerProvenance(input) });
    const governedInput = rewrite ? { ...input, tool_input: rewrite.updatedInput } : input;
    if (!launch.applies) {
      const governance = governedMutationDisposition(governedInput);
      if (!governance.allowed) return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: governance.reason,
        },
      };
      const disposition = toolUseDisposition(input, enterpriseOptions);
      if (!disposition.allowed) return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: disposition.reason,
        },
      };
    }
    if (rewrite) return {
      systemMessage: `Bounded ${budget.phase} capture is active; raw evidence will remain content-addressed outside premium context.`,
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        updatedInput: rewrite.updatedInput,
      },
    };
    const tool = String(input.tool_name ?? "unknown");
    const market = /^(?:Agent|spawn_agent|collaboration\.spawn_agent)$/u.test(tool) || /^mcp__.*(?:market|enterprise|supplier|capability)/u.test(tool);
    appendObservation({ type: market ? "SupplierCoordinationObserved" : "DirectCodexExecutionObserved", ...common, toolClass: tool, invocation: digest(input.tool_input ?? {}), argumentsRetained: false }, enterpriseOptions);
  } else if (input.hook_event_name === "PostToolUse") {
    const response = input.tool_response ?? null;
    appendObservation({ type: "CodexExecutionResultObserved", ...common, toolClass: String(input.tool_name ?? "unknown"), result: digest(response), failed: response?.isError === true || response?.success === false || Number(response?.exit_code ?? response?.exitCode ?? 0) !== 0, resultRetained: false }, enterpriseOptions);
    const evidence = compileToolEvidence(input, { ...enterpriseOptions, provider: providerProvenance(input), observedAt: at });
    // Exact output remains retrievable as a receipt. Do not replace or halt the
    // native tool result: the interactive agent needs that result to work.
    void evidence;
  } else if (input.hook_event_name === "SubagentStart") {
    appendObservation({
      type: "SupplierWorkStartedObserved",
      ...common,
      provider: providerProvenance(input),
      capability: subagentCapability(input),
      operation: subagentOperation(input),
      model: input.model ?? "unknown",
      providerReceiptSource: "provider-native Codex SubagentStart lifecycle",
      transcriptRetained: false,
    }, enterpriseOptions);
  } else if (input.hook_event_name === "SubagentStop") {
    const operation = subagentOperation(input);
    appendObservation({
      type: "SupplierExchangeObserved",
      ...common,
      provider: providerProvenance(input),
      capability: subagentCapability(input),
      receipt: `urn:${operation}`,
      protocol: "CodexSubagentLifecycle",
      providerDisposition: input.status ?? input.reason ?? "unknown",
      candidateDisposition: "pending-customer-disposition",
      providerReceiptSource: "provider-native Codex SubagentStop lifecycle",
      resources: observableSubagentResources(input),
      transcriptRetained: false,
    }, enterpriseOptions);
  } else if (input.hook_event_name === "Stop" || input.hook_event_name === "SessionEnd") {
    if (input.turn_id) pausePromptCycleBoundary(input, { ...enterpriseOptions, now: options.now });
    appendObservation({ type: "CodexLifecycleBoundaryObserved", ...common, boundary: input.hook_event_name, reason: input.reason ?? null }, enterpriseOptions);
    const gauges = (options.observeUsage ?? observeNativeUsage)({ sessionId: input.session_id, turnId: input.turn_id, includeWeekly: false });
    if (gauges.latestTurn) appendObservation({ type: "CodexNativeUsageGaugeObserved", ...common, gauge: gauges.latestTurn, weekly: gauges.weekly, monetaryPricePerToken: "unknown", source: "provider-native Codex rollout receipt; transcript not retained" }, enterpriseOptions);
  }
  // These lifecycle hooks are observational only. Interactive context is
  // supplied by the host and must not be inflated with enterprise locators.
  if (input.hook_event_name === "PostToolUse") return {};
  return output;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const input = JSON.parse(readFileSync(0, "utf8"));
    process.stdout.write(`${JSON.stringify(handle(input))}\n`);
  } catch (error) {
    process.stderr.write(`codex-enterprise-hook: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
