import { readFileSync } from "node:fs";

export async function readBoundedHookInput(stream, limit = 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > limit) throw new Error(`Claude hook input exceeds ${limit} bytes`);
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function cliArgument(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

/** A Bash PreToolUse/PostToolUse hook input's shell command text, wherever the tool input names it. */
export function commandText(toolInput) {
  if (typeof toolInput?.command === "string") return toolInput.command;
  if (typeof toolInput?.cmd === "string") return toolInput.cmd;
  return "";
}

/**
 * Splits a shell command into top-level segments at `&&`, `||`, `;`, and `|`, skipping any separator
 * found inside a quoted string or right after a backslash: a naive split cuts a real invocation in
 * half wherever its own argument text contains a literal separator — e.g. a `git commit -m "fixes
 * npm install"` message, or a `grep -i "a|b"` alternation — silently truncating away the very flags
 * or prose a caller needs to tell a real invocation from a mention inside a quoted argument.
 */
export function splitShellCommandTopLevel(command) {
  const segments = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (!inSingle && char === "\\") {
      current += char + (command[index + 1] ?? "");
      index += 1;
      continue;
    }
    if (!inDouble && char === "'") {
      inSingle = !inSingle;
      current += char;
      continue;
    }
    if (!inSingle && char === "\"") {
      inDouble = !inDouble;
      current += char;
      continue;
    }
    if (!inSingle && !inDouble) {
      if ((char === "&" || char === "|") && command[index + 1] === char) {
        segments.push(current);
        current = "";
        index += 1;
        continue;
      }
      if (char === ";" || char === "|") {
        segments.push(current);
        current = "";
        continue;
      }
    }
    current += char;
  }
  segments.push(current);
  return segments;
}

/**
 * Splits a shell command on its top-level separators into each segment's tokens, quote-aware: a
 * quoted argument's own text (a commit message, a grep pattern) never contributes tokens of its
 * own program name, so callers matching on `tokens[0]` never mistake prose inside quotes for an
 * invoked command.
 */
export function shellCommandSegmentTokens(command) {
  return splitShellCommandTopLevel(command).map((segment) => tokenizeQuoted(segment));
}

function tokenizeQuoted(segment) {
  const tokens = [];
  let current = "";
  let started = false;
  let inSingle = false;
  let inDouble = false;
  for (let index = 0; index < segment.length; index += 1) {
    const char = segment[index];
    if (!inSingle && char === "\\") {
      current += segment[index + 1] ?? "";
      index += 1;
      started = true;
      continue;
    }
    if (!inDouble && char === "'") {
      inSingle = !inSingle;
      started = true;
      continue;
    }
    if (!inSingle && char === "\"") {
      inDouble = !inDouble;
      started = true;
      continue;
    }
    if (!inSingle && !inDouble && /\s/u.test(char)) {
      if (started) tokens.push(current);
      current = "";
      started = false;
      continue;
    }
    current += char;
    started = true;
  }
  if (started) tokens.push(current);
  return tokens;
}

/**
 * Finds each real invocation of `program` in a Bash command's top-level segments — e.g. `npm` in
 * `npm install foo`, but never inside a quoted argument like a commit message that merely mentions
 * it. Returns each matching segment's tokens after the program name (its subcommand and arguments).
 */
export function commandInvocations(command, program) {
  return shellCommandSegmentTokens(command)
    .filter((tokens) => tokens.includes(program))
    .map((tokens) => tokens.slice(tokens.indexOf(program) + 1));
}

/** Extracts a user turn's plain text, across a string or content-block-array message shape. */
export function transcriptUserMessageText(entry) {
  if (!entry || typeof entry !== "object" || entry.message?.role !== "user") return "";
  const content = entry.message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((block) => block && block.type === "text" && typeof block.text === "string").map((block) => block.text).join("\n");
}

/** Parsed JSONL entries from a Claude Code transcript file, skipping blank or malformed lines. An unreadable file yields no entries. */
function transcriptEntries(transcriptPath) {
  let lines;
  try {
    lines = readFileSync(transcriptPath, "utf8").split("\n");
  } catch {
    return [];
  }
  const entries = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      continue;
    }
  }
  return entries;
}

/** Whether any user turn in a Claude Code transcript JSONL file matches one of the given patterns. Unreadable or malformed transcripts read as no match. */
export function transcriptHasUserPattern(transcriptPath, patterns) {
  for (const entry of transcriptEntries(transcriptPath)) {
    const text = transcriptUserMessageText(entry);
    if (text && patterns.some((pattern) => pattern.test(text))) return true;
  }
  return false;
}

/** Whether any assistant turn in a Claude Code transcript JSONL file already made a tool call the predicate accepts, given the tool's name and input. Unreadable or malformed transcripts read as no match. */
export function transcriptHasToolUse(transcriptPath, predicate) {
  for (const entry of transcriptEntries(transcriptPath)) {
    if (entry?.message?.role !== "assistant" || !Array.isArray(entry.message.content)) continue;
    for (const block of entry.message.content) {
      if (block?.type === "tool_use" && predicate(block.name, block.input)) return true;
    }
  }
  return false;
}
