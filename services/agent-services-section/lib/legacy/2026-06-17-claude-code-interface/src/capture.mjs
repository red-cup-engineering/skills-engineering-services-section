// src/capture.mjs -- decode Claude Code hook IO into utterance-shaped experience rows and
// append them to a per-session capture stream. Capturing is admitting experience
// (articulate); it is NOT durable learning. Nothing here is governed memory -- consolidate.mjs
// promotes the stream into durable governed SWARM memory at session end.
//
// The capture stream is an EAVT trace: each captured utterance is an ENTITY, and every fact
// about it (its kind, session, office, the spoken text, the acting tool) is one positive {e,a,v,t}
// datom appended to the session log. We borrow computer's eavt-append/eavt-read for the
// append-only G-Set discipline and the jsonl<->presheaf read -- the harness owns no row algebra.
//
// The utterance shape mirrors SWARM's own (swarm/src/infer.mjs):
//   [ { id, agent, provider, model, prompt, created, providerResponseId, usage, apiKeyEnv },
//     { const: <text> } ]
// so that consolidate.mjs can hand a synthesized turn straight to SWARM's recordMessage /
// descendUtterance without reshaping. The provider is "claude-code": this session is a
// carrier worker, not an API provider call. readCaptureStream rebuilds that utterance shape by
// folding the EAVT cells of each utterance entity back together.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import eavtAppend from "@561-group/computer/posix-holography/eavt-append";
import eavtRead from "@561-group/computer/posix-holography/eavt-read";

export const CLAUDE_PROVIDER = "claude-code";

function nowIso(options = {}) {
  return options.now ?? new Date().toISOString();
}

// Carrier-side id for a captured utterance entity. This identifies an experience row; it is not
// substrate math -- SWARM owns term addressing for anything durable.
function rowId(parts) {
  return `cap-${createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 16)}`;
}

export function captureDir(root, sessionId) {
  return join(root, "harness", "claude", "sessions", sessionId);
}

export function capturePath(root, sessionId) {
  return join(captureDir(root, sessionId), "capture.jsonl");
}

// Build a SWARM-shaped utterance for a captured text.
export function buildUtterance(session, text, { kind, created, meta = {} } = {}) {
  const created_ = created ?? new Date().toISOString();
  const provenance = {
    id: rowId([session.sessionId, kind, text, created_]),
    agent: session.office,
    provider: CLAUDE_PROVIDER,
    model: meta.model ?? CLAUDE_PROVIDER,
    prompt: meta.prompt ?? "",
    created: created_,
    providerResponseId: "",
    usage: {},
    apiKeyEnv: "",
  };
  return [provenance, { const: String(text ?? "") }];
}

// Project a capture row to the EAVT datoms that witness it. The utterance entity `e` is the
// provenance id; each fact about it (kind, session, office, the spoken text, optional tool) is
// one positive {e,a,v,t} datom -- the model the task calls for ("model the utterance as an EAVT
// datom"). t is the carrier-time the experience was admitted.
function rowToDatoms(row) {
  const e = row.utterance[0].id;
  const t = row.created;
  const datoms = [
    { e, a: "kind", v: row.kind, t },
    { e, a: "session", v: row.sessionId, t },
    { e, a: "office", v: row.office, t },
    { e, a: "text", v: row.utterance[1].const, t },
  ];
  if (row.meta && "tool" in row.meta) datoms.push({ e, a: "tool", v: row.meta.tool, t });
  return datoms;
}

export function appendCapture(root, session, row) {
  const path = capturePath(root, session.sessionId);
  for (const datom of rowToDatoms(row)) eavtAppend(path, datom);
  return path;
}

// Read the capture stream back as capture rows. The session log is an EAVT trace of utterance
// entities; eavt-read folds the jsonl into a cell presheaf. We group cells by utterance entity
// (in first-appearance order) and rebuild the utterance shape consolidate.mjs and the hooks read.
export function readCaptureStream(root, sessionId) {
  const path = capturePath(root, sessionId);
  if (!existsSync(path)) return [];
  const presheaf = eavtRead(path).potential[1]; // eavt/reading returns articulate([token, presheaf])
  const value = (o) => (o !== null && typeof o === "object" && "const" in o ? o.const : o);

  const byEntity = new Map(); // utterance id -> collected facts, first-appearance order
  for (const { cell, charge } of presheaf.assignments) {
    const e = value(cell.subject);
    const a = value(cell.predicate);
    const v = value(cell.object);
    const t = charge.evidence[0].length ? value(charge.evidence[0][0]) : undefined;
    if (!byEntity.has(e)) byEntity.set(e, { id: e, t });
    const facts = byEntity.get(e);
    facts[a] = v;
    if (facts.t === undefined) facts.t = t;
  }

  const rows = [];
  for (const facts of byEntity.values()) {
    const meta = "tool" in facts ? { tool: facts.tool } : {};
    rows.push({
      kind: facts.kind,
      sessionId: facts.session,
      office: facts.office,
      created: facts.t,
      utterance: [
        {
          id: facts.id,
          agent: facts.office,
          provider: CLAUDE_PROVIDER,
          model: CLAUDE_PROVIDER,
          prompt: "",
          created: facts.t,
          providerResponseId: "",
          usage: {},
          apiKeyEnv: "",
        },
        { const: facts.text ?? "" },
      ],
      meta,
    });
  }
  return rows;
}

// --- decoders: hook payload / text -> capture row -------------------------------------

function makeRow(session, kind, text, options = {}) {
  const created = nowIso(options);
  return {
    kind,
    sessionId: session.sessionId,
    office: session.office,
    created,
    utterance: buildUtterance(session, text, { kind, created, meta: options.meta ?? {} }),
    meta: options.meta ?? {},
  };
}

export function captureUserPrompt(root, session, payload, options = {}) {
  const text = payload.prompt ?? "";
  const row = makeRow(session, "user-prompt", text, options);
  return { row, path: appendCapture(root, session, row) };
}

export function captureToolCall(root, session, payload, options = {}) {
  // A tool-call envelope: name + a bounded view of input/response. We keep it small and
  // string-shaped; the carrier records that a tool acted, not the full payload.
  const name = payload.tool_name ?? payload.tool ?? "tool";
  const input = payload.tool_input ?? payload.input ?? {};
  const text = `${name}: ${JSON.stringify(input).slice(0, 600)}`;
  const row = makeRow(session, "tool-call-envelope", text, {
    ...options,
    meta: { ...(options.meta ?? {}), tool: name },
  });
  return { row, path: appendCapture(root, session, row) };
}

export function captureAssistantReply(root, session, text, options = {}) {
  const row = makeRow(session, "assistant-reply", text, options);
  return { row, path: appendCapture(root, session, row) };
}

// Read the final assistant text from a Claude Code transcript (JSONL). Defensive: the Stop
// hook payload carries transcript_path but not the reply itself. Returns "" if unreadable.
export function readLastAssistantText(transcriptPath) {
  if (!transcriptPath || !existsSync(transcriptPath)) return "";
  let lastText = "";
  for (const line of readFileSync(transcriptPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type !== "assistant") continue;
    const content = event.message?.content;
    if (typeof content === "string") {
      lastText = content;
    } else if (Array.isArray(content)) {
      const text = content
        .filter((part) => part?.type === "text" && typeof part.text === "string")
        .map((part) => part.text)
        .join("\n")
        .trim();
      if (text) lastText = text;
    }
  }
  return lastText;
}
