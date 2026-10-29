/**
 * app — the OpenAI-agent TUI: a chat session against any OpenAI-compatible
 * endpoint, driven by the pulse so every message contributes to continuous
 * learning.
 *
 * The TUI itself is the shared @emsenn/app-tui TerminalInterface; the only new
 * thing here is the World: an agentWorld whose `message` runs a pulse. The pulse
 * logs the turn to the data mount, derives state, and — when it judges necessary —
 * dreams. The reply lands in the scrollback; the run's standing (endpoint, regime,
 * tokens, whether it dreamed) rides the fiber into the GMCP panel (toggle: Ctrl-B).
 */
import { run, TerminalInterface, type TerminalInterfaceOptions } from "@emsenn/app-tui";
import { agentWorld, type AgentFiberCell, type AgentMessageResult } from "@emsenn/computing-with-terminal/world";
import { NodeTerminalScreen } from "@emsenn/computing-with-terminal/screen";
import { pulse, type PulseConfig, type PulseResult } from "@emsenn/organizing-with-openai-agents";

/**
 * Build an agent `message` function backed by the pulse. It keeps the running
 * conversation in a closure and threads it through each pulse, so the dialogue
 * accumulates and the agent's memory grows across turns.
 */
export function pulseAgentMessage(config: PulseConfig): (agent: string, prompt: string) => Promise<AgentMessageResult> {
  let conversation: PulseResult["conversation"] = [];
  return async (_agent, prompt) => {
    const result: PulseResult = await pulse(config, prompt, conversation);
    conversation = result.conversation;
    return {
      reply: result.reply,
      agent: { name: config.session, office: result.run.result.endpoint },
      trace: {
        endpoint: result.run.result.endpoint,
        model: result.run.result.model,
        regime: result.run.classification.regime,
        judgment: result.judgment,
        dream: result.dream,
      },
      fiber: fiberOf(result),
    };
  };
}

function fiberOf(result: PulseResult): readonly AgentFiberCell[] {
  const usage = result.run.result.usage;
  return [
    { predicate: "endpoint", object: result.run.result.endpoint, charge: true },
    { predicate: "model", object: result.run.result.model, charge: true },
    { predicate: "regime", object: result.run.classification.regime, charge: result.run.classification.settled },
    { predicate: "tokens", object: `${usage?.input ?? "?"}/${usage?.output ?? "?"}`, charge: true },
    { predicate: "subjects", object: String(result.state.subjects.length), charge: result.state.subjects.length > 0 },
    result.dream === null
      ? { predicate: "dreamed", object: result.judgment.reason, charge: false }
      : { predicate: "dreamed", object: `${result.dream.endpoint}/${result.dream.inwardRegime}`, charge: true },
  ];
}

/** Options for launching the OpenAI-agent TUI. */
export type OpenaiAgentTuiOptions = Readonly<{
  config: PulseConfig;
  name?: string;
  screen?: TerminalInterfaceOptions["screen"];
  exit?: (code: number) => void;
}>;

/**
 * Launch the TUI: an agentWorld over a pulse-backed message, rendered on the real
 * terminal (or an injected screen for tests). Returns the running interface.
 */
export function runOpenaiAgentTui(options: OpenaiAgentTuiOptions): TerminalInterface {
  const world = agentWorld({
    agent: options.config.session,
    kind: "openai-agent",
    message: pulseAgentMessage(options.config),
  });
  return run({
    name: options.name ?? `openai-agent · ${options.config.session}`,
    world,
    showPanel: true,
    screen: options.screen ?? new NodeTerminalScreen(),
    ...(options.exit === undefined ? {} : { exit: options.exit }),
  });
}
