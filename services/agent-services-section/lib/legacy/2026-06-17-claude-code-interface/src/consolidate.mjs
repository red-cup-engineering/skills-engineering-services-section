// src/consolidate.mjs -- at session end, fold the captured session into durable SWARM memory
// the same way SWARM processes a native `message` turn (swarm/src/index.mjs:90-167): descend
// the utterance, record the message fact, learn a governed memory row, dream, and write the
// player tuple. The ONE difference from a native turn: there is no provider model call -- the
// assistant reply already exists in the capture stream, so we synthesize the turn utterance
// from it instead of inferring one.
//
// This is the only place the harness writes durable, governed memory. Fail-open: consolidate
// never throws; it returns { ok, ... } so the Stop hook can never block the user's session.

import { createHash } from "node:crypto";

import ttmsWrite from "@561-group/computer/typed-term-memory-system/writing";
import ttmsRead from "@561-group/computer/typed-term-memory-system/reading";
import { settle, section } from "@561-group/computer/posix-holography/eavt-substrate";

import {
  recall,
  descendUtterance,
  recordMessage,
  learnFromMessage,
  dream,
  writePlayerTuple,
} from "./swarm.mjs";
import { readCaptureStream, CLAUDE_PROVIDER } from "./capture.mjs";

function turnId(parts) {
  return `msg-${createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 16)}`;
}

// The turn's prompt and reply are FUNCTIONAL on the session: one current value each, latest-t wins.
// tool-call-envelope is non-functional -- every tool that acted is its own affirmation, all kept.
const FUNCTIONAL_KINDS = new Set(["user-prompt", "assistant-reply"]);

// The ttms address (term) of a session's consolidated capture fold.
function sessionTerm(sessionId) {
  return `harness/claude/sessions/${sessionId}/fold`;
}

// const-unwrap a ttms cell coordinate ({const:v} for scalars, raw otherwise).
const value = (o) => (o !== null && typeof o === "object" && "const" in o ? o.const : o);

// Fold the captured session into its current value through the substrate, NOT a hand-rolled loop.
// Each capture row is witnessed as a session-subject EAVT datom (subject=session, predicate=kind,
// object=text, t=carrier-time) in a ttms term memory; reading that term back gives the settled
// presheaf, which substrate.settle projects under the FUNCTIONAL latest-t lens and substrate.section
// shadows to affirmed cells. The latest user-prompt and assistant-reply read straight off `affirmed`;
// the tool count is the number of tool-call-envelope witnesses in the trace.
function foldStream(root, sessionId, rows) {
  const term = sessionTerm(sessionId);
  let toolCount = 0;
  for (const row of rows) {
    const text = row.utterance?.[1]?.const ?? "";
    if (row.kind === "tool-call-envelope") toolCount += 1;
    // witness this capture as a session-subject datom (subject = the session term).
    ttmsWrite(root, term, { [row.kind]: text }, { t: row.created });
  }

  // read the term's settled memory back, then settle under the functional lens and shadow it.
  const memory = ttmsRead(root, term);
  const traceRows = memory.assignments.map(({ cell, charge }) => ({
    e: value(cell.subject),
    a: value(cell.predicate),
    v: value(cell.object),
    t: charge.evidence[0].length ? value(charge.evidence[0][0]) : "",
  }));
  const affirmed = traceRows.length
    ? section(settle(term, traceRows, { functional: FUNCTIONAL_KINDS })).affirmed
    : [];
  const latest = (kind) => affirmed.find((c) => c.predicate === kind)?.object ?? "";
  return { prompt: latest("user-prompt"), reply: latest("assistant-reply"), toolCount };
}

export function consolidateSession(root, session, options = {}) {
  try {
    const agent = session.agent;
    const rows = readCaptureStream(root, session.sessionId);
    const { prompt, reply, toolCount } = foldStream(root, session.sessionId, rows);
    if (!prompt && !reply) {
      return { ok: true, skipped: "empty-capture", sessionId: session.sessionId };
    }

    const created = options.now ?? new Date().toISOString();
    const id = options.id ?? turnId([session.sessionId, prompt, reply]);
    // SWARM-shaped utterance for the whole Claude turn (provider = claude-code carrier).
    const utterance = [
      {
        id,
        agent: agent.name,
        provider: CLAUDE_PROVIDER,
        model: options.model ?? CLAUDE_PROVIDER,
        prompt,
        created,
        providerResponseId: "",
        usage: {},
        apiKeyEnv: "",
      },
      { const: reply },
    ];

    // Mirror message()'s trace construction.
    const descent = descendUtterance(utterance);
    const trace = {
      id,
      articulated: !!descent.articulated,
      predicated: !!descent.predicated,
      settled: !!descent.settled?.sheaf,
      witnessed: false,
    };

    const memory = recordMessage(root, agent, prompt, utterance, trace);
    trace.witnessed = true;
    trace.log = memory.log;

    // Governed durable learning -- recall for relevance, then learn with provenance.
    const recalled = recall(root, agent, prompt || reply, options.recall).records;
    const learning = learnFromMessage(root, agent, prompt, reply, recalled, {
      ...options,
      messageId: id,
    });

    const dreaming = dream(root, agent, options);

    const player = writePlayerTuple(root, agent, prompt || reply, {
      ...options,
      tracePaths: [memory.log, ...learning.terms],
    });

    return {
      ok: true,
      sessionId: session.sessionId,
      office: agent.name,
      toolCount,
      trace,
      memory: { term: memory.term, log: memory.log },
      learning,
      dreaming,
      player: player?.term ?? player ?? null,
    };
  } catch (error) {
    // Fail open: a consolidation failure must never block session Stop.
    return { ok: false, error: String(error?.message ?? error), sessionId: session.sessionId };
  }
}
