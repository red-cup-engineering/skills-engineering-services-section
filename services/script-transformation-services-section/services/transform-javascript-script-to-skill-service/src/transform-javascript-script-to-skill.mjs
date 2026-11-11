import { createHash } from "node:crypto";

const BLOCK_COMMENT = /\/\*\*([\s\S]*?)\*\//u;
const TAG_LINE = /^@([a-z-]+)\s*(.*)$/u;

const SCALARS = {
  description: "description",
};
const LISTS = {
  param: "params",
  returns: "returns",
  throws: "throws",
};

/**
 * Read the FIRST `/** *\/` block comment in a JavaScript source string as its
 * declaration header. Lines matching `@tag value` open a declaration; every
 * following non-blank line continues that same declaration's value, joined by
 * a single space, so a long `@description` need not be one unreadable line.
 * A blank line, or a fresh `@tag`, ends the continuation.
 *
 * Precondition: source is a string.
 * Input: source — the full text of a JavaScript file.
 * Output: `{ declarations: [{ tag, value }], prose }`, or null when the
 *   source carries no leading block comment.
 * Postcondition: declarations preserves source order; prose is every
 *   non-declaration line of the header, joined by newlines and trimmed.
 */
export function readDeclarationsFromJavascript(source) {
  if (typeof source !== "string") throw new TypeError("source must be a string");
  const match = BLOCK_COMMENT.exec(source);
  if (!match) return null;

  const lines = match[1].split("\n").map((line) => line.replace(/^\s*\*\s?/u, ""));
  const declarations = [];
  const prose = [];
  let current = null;

  for (const line of lines) {
    const tag = TAG_LINE.exec(line);
    if (tag) {
      current = { tag: tag[1], value: tag[2].trim() };
      declarations.push(current);
      continue;
    }
    if (current && line.trim() !== "") {
      current.value = `${current.value} ${line.trim()}`.trim();
      continue;
    }
    current = null;
    prose.push(line);
  }

  return { declarations, prose: prose.join("\n").trim() };
}

/**
 * The flat basename a skill script's record is named for, with its `.js` or
 * `.mjs` extension removed. The name is read off the FILENAME, never off a
 * declaration — a script does not get to assert its own name, since the
 * name is what the harness already resolves it by on disk.
 *
 * Precondition: filename is a non-empty string ending `.js` or `.mjs`.
 * Input: filename.
 * Output: the basename without its script extension.
 */
function nameFromFilename(filename) {
  return filename.replace(/\.mjs$/u, "").replace(/\.js$/u, "");
}

/**
 * Compose readDeclarationsFromJavascript's output into a candidate skill
 * record, mapping declaration tags to the skill vocabulary. This is a pure
 * transformation: it touches no filesystem and spawns no process, so it can
 * be tested and composed without any pool, any target, or any schema on
 * disk.
 *
 * The vocabulary is standard JSDoc, not an invented dialect: `@description`
 * is the only scalar; `@param`, `@returns`, and `@throws` repeat, each
 * repetition appending to `params`, `returns`, and `throws` respectively,
 * carrying their tag value verbatim (including any `{type}` the header
 * wrote). Nothing here parses a `{type}` or a name back out of that value —
 * this service reads what standard JSDoc tools already read, and does not
 * grow a second opinion about their shape.
 *
 * Precondition: source is a JavaScript source string; filename is the flat
 *   basename the projected script will carry (never a path).
 * Input: source, filename.
 * Output: `{ record, body }` on success — record.name is DERIVED from
 *   filename and record.script is DERIVED as `scripts/<filename>`, neither
 *   ever read from a declaration — or `{ error }` naming exactly what
 *   refused: no header, or an unknown `@tag`.
 * Postcondition: an unknown `@tag` is always a hard error, never silently
 *   dropped.
 */
export function transformJavascriptScriptToSkill(source, filename) {
  if (typeof filename !== "string" || filename === "") throw new TypeError("filename must be a non-empty string");

  const header = readDeclarationsFromJavascript(source);
  if (!header) return { error: "no leading block comment — a script without a header declares no skill" };

  const record = { name: nameFromFilename(filename) };

  for (const { tag, value } of header.declarations) {
    if (LISTS[tag]) {
      (record[LISTS[tag]] ??= []).push(value);
      continue;
    }
    if (SCALARS[tag]) {
      record[SCALARS[tag]] = value;
      continue;
    }
    return { error: `unknown declaration '@${tag}' — the record's keys are the schema's, and this is not one of them` };
  }

  // Derived, never declared: projection decides where the script lands, so a
  // declared path would be a second claim about one fact.
  record.script = `scripts/${filename}`;

  return { record, body: header.prose };
}


/**
 * Bounded, source-witnessed query over Engineering scripts. Caller supplies an
 * ordered iterable of actual files from an exact Git revision. A million
 * scripts need not become a million loaded SKILL.md files: only the selected
 * page is held. The candidates do not confer Coesite procedure standing,
 * Actor rights, office seating, installed harness powers, or market sales.
 *
 * This is a SEARCH candidate reader, never a second agency or script registry.
 */
export function deriveScriptSkillPage(entries, { query = "", after = null, limit = 25 } = {}) {
  if (!entries || typeof entries[Symbol.iterator] !== "function" || typeof entries === "string")
    throw new TypeError("a source-owned iterable of script observations is required");
  if (typeof query !== "string" || query.length > 200 ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > 100 ||
      (after !== null && (typeof after !== "string" || after.length > 512)))
    throw new TypeError("bounded query, page size and source cursor required");

  const terms = query.toLowerCase().trim().split(/\s+/u).filter(Boolean);
  const candidates = [], refusals = [];
  let previous = "", examined = 0, admissible = 0, matched = 0, refused = 0;
  let lastSelected = null, additional = false;
  for (const row of entries) {
    if (!row || typeof row !== "object" || Array.isArray(row) ||
        typeof row.repository !== "string" ||
        !/^red-cup-engineering\/[A-Za-z0-9_.-]+$/u.test(row.repository) ||
        typeof row.path !== "string" || row.path.length > 300 ||
        row.path.startsWith("/") || row.path.includes("\\") ||
        row.path.split("/").some(part => !part || part === "." || part === "..") ||
        !/^[a-z0-9]+(?:-[a-z0-9]+)*\.(?:m?js)$/u.test(row.path.split("/").at(-1)) ||
        typeof row.commit !== "string" || !/^[a-f0-9]{40}$/u.test(row.commit))
      throw new TypeError("script observation requires Engineering repository, canonical path and exact Git commit");
    const key = row.repository + ":" + row.path;
    if (key <= previous) throw new TypeError("script observations must be unique and source-sorted");
    previous = key;
    examined++;
    const decline = reason => {
      refused++;
      if (refusals.length < 8) refusals.push(Object.freeze({ source: key, reason }));
    };
    if (typeof row.source !== "string" || row.source.length > 262144 ||
        typeof row.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(row.sha256)) {
      decline("source-or-digest-unavailable"); continue;
    }
    // Unlike the legacy transformer, a later function's JSDoc never counts
    // as a script-level operating declaration.
    if (!/^(?:#![^\n]*\n)?\s*\/\*\*/u.test(row.source)) {
      decline("no-leading-script-declaration"); continue;
    }
    const actual = createHash("sha256").update(row.source, "utf8").digest("hex");
    if (actual !== row.sha256) { decline("source-digest-mismatch"); continue; }
    const basename = row.path.split("/").at(-1);
    const derived = transformJavascriptScriptToSkill(row.source, basename);
    if (derived.error || typeof derived.record?.description !== "string" ||
        !derived.record.description.trim()) {
      decline(derived.error ? "unrecognized-or-incomplete-jsdoc" : "no-task-description");
      continue;
    }
    admissible++;
    const haystack = (derived.record.name + " " + derived.record.description + " " + derived.body).toLowerCase();
    if (!terms.every(term => haystack.includes(term))) continue;
    matched++;
    if (after !== null && key <= after) continue;
    if (candidates.length >= limit) { additional = true; continue; }
    lastSelected = key;
    candidates.push(Object.freeze({
      candidateKey: key,
      source: Object.freeze({
        repository: row.repository, commit: row.commit, path: row.path,
        sha256: row.sha256, gitMembershipVerified: false,
      }),
      name: derived.record.name,
      description: derived.record.description,
      script: derived.record.script,
      argumentDeclarations: Object.freeze([...(derived.record.params ?? [])]),
      returnDeclarations: Object.freeze([...(derived.record.returns ?? [])]),
      exceptionDeclarations: Object.freeze([...(derived.record.throws ?? [])]),
      claimState: "source-bytes-matched-unqualified",
      coesiteSkillEnacted: false,
      actorAuthorized: false,
      installedInHarness: false,
      paidByCustomer: false,
    }));
  }
  return Object.freeze({
    kind: "engineering.script-skill-repertoire-page.v1",
    source: "source-witnessed-red-cup-javascript",
    query, after, limit,
    coverage: Object.freeze({
      examined, validScriptDeclarations: admissible, queryMatches: matched,
      refused, refusalExamples: Object.freeze(refusals),
      sourceSnapshotQualified: false,
    }),
    candidates: Object.freeze(candidates),
    nextAfter: additional ? lastSelected : null,
    complete: !additional,
    authorizationOrDeploymentGranted: false,
    originalConsumer: "Coesite agency procedure admission and source-owned harness projector",
  });
}
