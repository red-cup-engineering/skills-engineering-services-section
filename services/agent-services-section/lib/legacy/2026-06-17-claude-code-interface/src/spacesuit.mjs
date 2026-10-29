// src/spacesuit.mjs -- project a small, task-focused context ("spacesuit") from SWARM memory
// for the configured office, to inject into the Claude Code session. READ-ONLY by law:
// "context presence is not learning" -- start/prompt injection must write nothing durable.
//
// We compose SWARM's own read primitives (recall + derivePlan + renderCognitiveContext)
// directly and deliberately AVOID buildCognition: buildCognition persists a plan and runs
// tools (which can write a memory row for a "remember:" directive). The spacesuit only reads.

import { recall, derivePlan, renderCognitiveContext } from "./swarm.mjs";

// Build the projected context for a given focus (a prompt, or the office's standing focus).
export function projectSpacesuit(root, agent, focus, options = {}) {
  const query = focus && focus.trim() ? focus : agent.system ?? agent.name;
  const recalled = recall(root, agent, query, options.recall).records;
  const dreams = recall(root, agent, query, { collections: ["dreams"], limit: 3 }).records;
  const plan = derivePlan(agent, query, recalled); // pure: derivePlan does not write
  const body = renderCognitiveContext({ recalled, dreams, plan, toolResults: [] });

  const identity = [
    `SWARM OFFICE: ${agent.name}` + (agent.office ? ` (office: ${agent.office})` : ""),
    agent.system ? `MISSION: ${agent.system}` : null,
    Array.isArray(agent.capabilities) && agent.capabilities.length
      ? `CAPABILITIES: ${agent.capabilities.join(", ")}`
      : null,
  ].filter(Boolean).join("\n");

  const additionalContext = [identity, body].filter((part) => part && part.trim()).join("\n\n");

  return {
    additionalContext,
    office: agent.name,
    recalled: recalled.length,
    dreams: dreams.length,
    plan,
  };
}
