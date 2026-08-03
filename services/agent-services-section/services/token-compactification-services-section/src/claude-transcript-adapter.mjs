// claude-transcript-adapter.mjs — Claude Code JSONL transcript rows -> compaction spans.
//
// Row semantics mirror the proven filters in the Bare Cedar Fog Claude enterprise's
// claude-session-context.mjs: tool_result blocks are machine traffic carried on
// type:"user" rows; harness injections (<system-reminder>, command wrappers, caveats)
// are not the Leader speaking. Here nothing is discarded — every row becomes a span —
// but each span's KIND routes it to the right compaction treatment: real user speech
// is pinned, harness injections are cheap, tool results are maskable.

const HARNESS_PATTERN = /^(Caveat:|\[Request interrupted|<system-reminder>|<task-notification>|<command-name>|<local-command)/u;

function blockText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n");
}

function toolResultText(block) {
  const content = block?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return blockText(content);
  return JSON.stringify(content ?? "");
}

/**
 * spansFromClaudeTranscript(rows) -> spans for planCompaction().
 * rows: parsed JSONL rows ({type, message:{role, content}, ...}). Unparseable or
 * non-conversation rows are skipped — an adapter converts, it does not judge.
 */
export function spansFromClaudeTranscript(rows) {
  if (!Array.isArray(rows)) throw new TypeError("rows must be an array");
  const spans = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const role = row?.message?.role ?? row?.role;
    if (!["user", "assistant"].includes(role)) continue;
    const content = row?.message?.content ?? row?.content;
    if (Array.isArray(content)) {
      for (let b = 0; b < content.length; b += 1) {
        const block = content[b];
        if (block?.type === "tool_result") {
          spans.push({
            id: `r${index}b${b}`,
            kind: "tool_result",
            text: toolResultText(block),
            meta: { isError: block.is_error === true, toolUseId: block.tool_use_id ?? null },
          });
        }
      }
    }
    const text = blockText(content).trim();
    if (!text) continue;
    const kind = role === "assistant" ? "assistant" : HARNESS_PATTERN.test(text) ? "harness" : "user";
    spans.push({ id: `r${index}`, kind, text, meta: {} });
  }
  return spans;
}

/** parseTranscriptJsonl(source) -> rows, skipping malformed lines (not evidence). */
export function parseTranscriptJsonl(source) {
  const rows = [];
  for (const line of String(source).split(/\r?\n/u)) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      /* a malformed transcript row is not session evidence */
    }
  }
  return rows;
}
