// src/mcp.mjs -- the carrier tool surface. Each verb routes to a SWARM public function; the
// harness implements no math of its own. INWARD verbs read/derive over memory with no network;
// the one OUTWARD verb (swarm_message) runs a full governed SWARM turn, which is how this
// session acts THROUGH the swarm (e.g. ask the leader to create a mission or plan work).
//
// The office this session serves as is resolved once (config.resolveSession) and is the
// default subject for inward verbs and swarm_message.

import {
  recall,
  derivePlan,
  dream,
  message,
  summarizeWorkStatuses,
  costGraphSummary,
} from "./swarm.mjs";
import { resolveSession } from "./config.mjs";
import { projectSpacesuit } from "./spacesuit.mjs";

export const TOOLS = [
  {
    name: "swarm_remember",
    description:
      "Inward (no network): recognition-weighted recall of this office's settled SWARM memory for a query.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "What to recall." } },
      required: ["query"],
    },
  },
  {
    name: "swarm_context",
    description:
      "Inward (no network): project a context spacesuit (identity, memory, dreams, plan) for an optional focus. Reads only; writes nothing.",
    inputSchema: {
      type: "object",
      properties: { focus: { type: "string", description: "Optional focus prompt." } },
    },
  },
  {
    name: "swarm_plan",
    description: "Inward (no network): derive a next-action plan frontier for an aim.",
    inputSchema: {
      type: "object",
      properties: { aim: { type: "string", description: "The aim to plan toward." } },
      required: ["aim"],
    },
  },
  {
    name: "swarm_dream",
    description:
      "Inward (no network): run deterministic consolidation over this office's memory; may write one dream insight.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "swarm_message",
    description:
      "Outward: run a full governed SWARM turn through an office (defaults to this session's office). Use to create missions, plan work, or report through the leader-mediated boundary. May call a provider for non-local offices.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "The message to the office." },
        agent: { type: "string", description: "Office to address (default: this session's office)." },
      },
      required: ["prompt"],
    },
  },
  {
    name: "swarm_work_status",
    description: "Read-only: trace-folded work status summary (open/assigned/active/done/blocked).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "swarm_costs",
    description: "Read-only: cost-graph summary folded from the SWARM ledger families.",
    inputSchema: { type: "object", properties: {} },
  },
];

// Resolve the session context once for an MCP server lifetime (no hook payload here).
export function createMcpContext(options = {}) {
  const session = resolveSession({}, options);
  return { root: session.root, session, options };
}

export async function handleToolCall(name, args = {}, ctx) {
  const { root, session, options = {} } = ctx;
  const agent = session.agent;
  switch (name) {
    case "swarm_remember": {
      const { records } = recall(root, agent, String(args.query ?? ""), options.recall);
      return {
        tool: name,
        office: agent.name,
        recalled: records.map((r) => ({
          collection: r.collection,
          term: r.term,
          summary: r.doc.summary ?? r.doc.insight ?? r.doc.prompt ?? r.term,
          score: r.score,
        })),
      };
    }
    case "swarm_context": {
      const suit = projectSpacesuit(root, agent, String(args.focus ?? ""), options);
      return { tool: name, ...suit };
    }
    case "swarm_plan": {
      const recalled = recall(root, agent, String(args.aim ?? ""), options.recall).records;
      const plan = derivePlan(agent, String(args.aim ?? ""), recalled);
      return { tool: name, office: agent.name, plan };
    }
    case "swarm_dream": {
      return { tool: name, office: agent.name, ...dream(root, agent, options) };
    }
    case "swarm_message": {
      const office = args.agent ? String(args.agent) : agent.name;
      const result = await message(office, String(args.prompt ?? ""), { ...options, root });
      return {
        tool: name,
        office,
        reply: result.reply,
        trace: result.trace,
        memory: result.memory?.term ?? null,
        work: result.office?.work ?? [],
        governance: result.office?.governance ?? [],
      };
    }
    case "swarm_work_status": {
      return { tool: name, status: summarizeWorkStatuses(root, options) };
    }
    case "swarm_costs": {
      return { tool: name, costs: costGraphSummary(root) };
    }
    default:
      throw new Error(`swarm-conductor-mcp: unknown tool ${name}`);
  }
}
