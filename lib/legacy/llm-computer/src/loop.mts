// @red-cup-engineering/llm-computer — the agentic loop driver and governed tool execution.
//
// Pure computing: inference enters as an injected `Infer` function, so this module
// touches no socket and no key. The loop folds each turn into an @red-cup-engineering/organizing-with-llm-agents/running
// settling run carrier — accumulating the conversation, tool runs, and per-turn cost
// events — and stops at a fixed point (a final answer) or an obstruction (a step or
// cost bound). Tool calls pass through a governance gate before they run.

import {
  type ChatMessage,
  type InferenceRequest,
  type InferenceResult,
  type JsonValue,
  type ToolDefinition,
  type ToolCall,
  inferenceCostEvent,
} from "@red-cup-engineering/organizing-with-llm-agents/algebra";
import {
  chargeValueName,
  mark,
  valueOf,
  type ChargeCarrier,
  type ChargeValueName,
} from "@emsenn/relating";
import {
  type AgentRun,
  type LoopStop,
  type ToolRun,
  type ToolRunStatus,
  appendTurn,
  emptyRun,
  runCost,
  settleRun,
  toolRunCharge,
} from "@red-cup-engineering/organizing-with-llm-agents/running";

/** Inference as an injected capability — the holography layer supplies the real one. */
export type Infer = (request: InferenceRequest) => Promise<InferenceResult>;

// ── governed tool execution ────────────────────────────────────────────────────
export type ToolHandler = (call: ToolCall) => JsonValue | Promise<JsonValue>;

export type CapabilityGrant = ChargeValueName | ChargeCarrier;
export type CapabilityGrants = Readonly<Record<string, CapabilityGrant>>;
export type AgentProvisions = Readonly<{
  capabilities?: CapabilityGrants;
}>;

export type GovernOptions = Readonly<{
  handlers?: Readonly<Record<string, ToolHandler>>;
  /** The acting agent's capability grants. When given, the tool's required
   * coordinate is read as a bilattice charge name. */
  provisions?: AgentProvisions;
  /** Maps a tool call to the capability coordinate it requires; defaults to `tool.<name>`. */
  capabilityOf?: (call: ToolCall) => string;
}>;

/** The capability coordinate a tool call requires, by default `tool.<name>`. */
export function defaultCapabilityOf(call: ToolCall): string {
  return call.name.startsWith("tool.") ? call.name : `tool.${call.name}`;
}

/**
 * Run one tool call through the agent-capability gate. Malformed arguments are
 * refused before any capability check. When provisions are given, the required
 * capability coordinate is read from the agent's grants as a bilattice charge:
 * `potential` (provided) admits, `active` (denied) refuses, `stable` (⊤) holds a
 * contradiction (never collapsed), `absurd`/absent (no grant) refuses. With no
 * provisions the gate is open. Every outcome is a charge-bearing ToolRun.
 */
export async function runGovernedToolCall(call: ToolCall, options: GovernOptions = {}): Promise<ToolRun> {
  if (typeof call.arguments === "string") {
    return toolRun(call, "refused", "malformed-tool-arguments", "tool-call");
  }
  if (options.provisions !== undefined) {
    const coordinate = (options.capabilityOf ?? defaultCapabilityOf)(call);
    const grant: ChargeValueName = options.provisions.capabilities === undefined
      ? "absurd"
      : chargeNameOfGrant(options.provisions.capabilities[coordinate]);
    switch (grant) {
      case "potential":
        break; // provided — admitted
      case "active":
        return toolRun(call, "refused", `capability ${coordinate} denied`, "capability");
      case "stable":
        return toolRun(call, "contested", `capability ${coordinate} contested`, "capability");
      case "absurd":
        return toolRun(call, "refused", `no capability ${coordinate}`, "capability");
    }
  }

  const handler = options.handlers?.[call.name];
  if (handler === undefined) return toolRun(call, "refused", `no handler for ${call.name}`, "handler");
  try {
    const output = await handler(call);
    return { call, status: "ok", charge: toolRunCharge("ok", { tool: call.name }), output, ran: true, gate: "handler" };
  } catch (error) {
    return toolRun(call, "refused", error instanceof Error ? error.message : String(error), "handler");
  }
}

function chargeNameOfGrant(grant: CapabilityGrant | undefined): ChargeValueName {
  if (grant === undefined) return "absurd";
  if (typeof grant === "string") return grant;
  return chargeValueName(valueOf(grant));
}

function toolRun(call: ToolCall, status: Exclude<ToolRunStatus, "ok">, reason: string, gate: string): ToolRun {
  return { call, status, charge: toolRunCharge(status, { tool: call.name, reason }), reason, ran: false, gate };
}

/** The message appended to the conversation carrying a tool run's outcome. */
export function toolResultMessage(run: ToolRun): ChatMessage {
  const content = run.status === "ok"
    ? JSON.stringify(run.output ?? null)
    : JSON.stringify({ [run.status]: run.reason ?? run.status });
  return {
    role: "tool",
    name: run.call.name,
    ...(run.call.id === undefined ? {} : { toolCallId: run.call.id }),
    content,
  };
}

// ── the loop ───────────────────────────────────────────────────────────────────
export type CostRates = Readonly<{
  dollarsPerMillionInputTokens?: number;
  dollarsPerMillionOutputTokens?: number;
  settlementFuel?: number;
}>;

export type AgentLoopOptions = Readonly<{
  request: InferenceRequest;
  infer: Infer;
  now: string;
  id?: string;
  tools?: readonly ToolDefinition[];
  handlers?: Readonly<Record<string, ToolHandler>>;
  provisions?: AgentProvisions;
  capabilityOf?: (call: ToolCall) => string;
  maxSteps?: number;
  maxTokens?: number;
  cost?: CostRates;
}>;

const DEFAULT_MAX_STEPS = 8;

export async function runAgentLoop(options: AgentLoopOptions): Promise<AgentRun> {
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
  let run = emptyRun(options.id ?? `loop:${options.now}`, options.request.messages);

  while (run.stop === null) {
    if (run.turns.length >= maxSteps) {
      run = settleRun(run, "max-steps");
      break;
    }

    const result = await options.infer({
      ...options.request,
      messages: run.conversation,
      ...(options.tools === undefined ? {} : { tools: options.tools }),
    });
    const cost = inferenceCostEvent(result, {
      transactionTime: options.now,
      operation: "agent-loop",
      ...(options.cost ?? {}),
    });
    const assistant: ChatMessage = { role: "assistant", content: result.text };
    const toolCalls = result.toolCalls ?? [];

    if (toolCalls.length === 0) {
      run = appendTurn(run, { index: run.turns.length, assistant, toolCalls: [], toolRuns: [], cost }, [assistant]);
      run = settleRun(run, "final-answer", result.text);
      break;
    }

    const toolRuns: ToolRun[] = [];
    const added: ChatMessage[] = [assistant];
    for (const call of toolCalls) {
      const tr = await runGovernedToolCall(call, options);
      toolRuns.push(tr);
      added.push(toolResultMessage(tr));
    }
    run = appendTurn(run, { index: run.turns.length, assistant, toolCalls, toolRuns, cost }, added);

    const stop = stopAfterTurn(run, toolRuns, options.maxTokens);
    if (stop !== null) {
      run = settleRun(run, stop);
      break;
    }
  }

  return run;
}

function stopAfterTurn(run: AgentRun, toolRuns: readonly ToolRun[], maxTokens?: number): LoopStop | null {
  if (toolRuns.some((tr) => tr.status === "contested")) return "contested-tool";
  if (maxTokens !== undefined) {
    const { tokens } = runCost(run);
    if (tokens.input + tokens.output >= maxTokens) return "cost-bound";
  }
  return null;
}

// ── MCP tool conversion ──────────────────────────────────────────────────────
export type McpToolDescriptor = Readonly<{
  name: string;
  description?: string;
  inputSchema?: Readonly<Record<string, JsonValue>>;
}>;

/** Convert an MCP `tools/list` catalog into organizing-with-llm-agents algebra tool definitions. Pure. */
export function toolsFromMcpCatalog(descriptors: readonly McpToolDescriptor[]): ToolDefinition[] {
  return descriptors.map((d) => ({
    name: d.name,
    ...(d.description === undefined ? {} : { description: d.description }),
    ...(d.inputSchema === undefined ? {} : { parameters: d.inputSchema }),
  }));
}
