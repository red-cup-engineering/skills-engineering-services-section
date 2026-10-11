#!/usr/bin/env node
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { freezeJson } from "@red-cup-engineering/json-services-section";
import { parseLines, serializeLines } from "@red-cup-engineering/jsonl-services-section";
import { parseJavascriptArgv } from "@red-cup-engineering/javascript-node-services-section/argv";
import { readJavascriptFileExportDocumentation } from "@red-cup-engineering/read-javascript-file-export-documentation-service";

class SkillSourceRefusal extends Error {
  constructor(code, message, refusedPath = null) {
    super(message);
    this.code = code;
    this.refusedPath = refusedPath;
  }
}

function refuse(code, message, refusedPath = null) {
  throw new SkillSourceRefusal(code, message, refusedPath);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function exactKeys(value, keys, context) {
  if (!isRecord(value)) refuse("INVALID_RECORD", `${context} must be a JSON record`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) refuse("UNEXPECTED_FIELDS", `${context} must carry exactly: ${expected.join(", ")}`);
}

function refusal(error) {
  if (!(error instanceof SkillSourceRefusal)) throw error;
  return freezeJson({ type: "JavascriptOperationSkillSourceRefusal", version: 1, code: error.code, message: error.message, path: error.refusedPath });
}

/**
 * Admits one documented executable JavaScript operation and its source reading as a skill source.
 * @param {object} candidate A JavascriptOperationSkillSourceCandidate joining one TextFileRead with its documentation and main-guard reads.
 * @returns {object} An immutable JavascriptOperationSkillSource or a specific refusal record.
 */
export function admitJavascriptOperationSkillSource(candidate) {
  try {
    exactKeys(candidate, ["type", "version", "reading", "documentations", "mainGuards"], "candidate");
    if (candidate.type !== "JavascriptOperationSkillSourceCandidate" || candidate.version !== 1) refuse("INVALID_CANDIDATE", "candidate type and version must be JavascriptOperationSkillSourceCandidate@1");
    exactKeys(candidate.reading, ["type", "path", "text"], "reading");
    if (candidate.reading.type !== "TextFileRead" || typeof candidate.reading.path !== "string" || typeof candidate.reading.text !== "string") refuse("INVALID_READING", "reading must be a TextFileRead");
    const extension = path.posix.extname(candidate.reading.path);
    if (extension !== ".js" && extension !== ".mjs") refuse("INVALID_SCRIPT_PATH", "skill source path must end in .js or .mjs", candidate.reading.path);
    const name = path.posix.basename(candidate.reading.path, extension);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(name)) refuse("INVALID_SKILL_NAME", "source basename must be lowercase kebab-case", candidate.reading.path);
    if (!candidate.reading.text.startsWith("#!/usr/bin/env node\n")) refuse("MISSING_NODE_SHEBANG", "skill source must begin with the Node executable shebang", candidate.reading.path);
    if (!Array.isArray(candidate.documentations) || candidate.documentations.length !== 1) refuse("OPERATION_EXPORT_COUNT", "skill source must have exactly one documented exported operation", candidate.reading.path);
    const documentation = candidate.documentations[0];
    exactKeys(documentation, ["type", "version", "path", "name", "kind", "signature", "description", "parameters", "returns", "throws", "tags"], "documentation");
    if (documentation.type !== "JavascriptFileExportDocumentation" || documentation.version !== 1 || documentation.kind !== "function" || documentation.path !== candidate.reading.path) refuse("DOCUMENTATION_READING_MISMATCH", "documentation must be the exported function read from the same file", candidate.reading.path);
    if (typeof documentation.description !== "string" || documentation.description.trim().length === 0) refuse("MISSING_SKILL_BODY", "exported operation JSDoc prose must supply the skill body", candidate.reading.path);
    const retired = new Set(["skill", "verb-phrase", "closure-kind", "precondition", "postcondition", "witness", "fuel", "model"]);
    if (documentation.tags.some((tag) => retired.has(tag.name))) refuse("RETIRED_SKILL_TAG", "private skill declaration tags are not admitted", candidate.reading.path);
    const unsupported = documentation.tags.filter((tag) => tag.name !== "summary");
    if (unsupported.length > 0) refuse("UNSUPPORTED_SKILL_TAG", `unsupported skill-source JSDoc tag: @${unsupported[0].name}`, candidate.reading.path);
    const summaries = documentation.tags.filter((tag) => tag.name === "summary");
    if (summaries.length !== 1 || typeof summaries[0].text !== "string" || summaries[0].text.trim().length === 0 || summaries[0].text.includes("\n")) refuse("INVALID_SKILL_SUMMARY", "skill source must have exactly one nonempty single-line @summary", candidate.reading.path);
    if (!Array.isArray(candidate.mainGuards) || candidate.mainGuards.length !== 1) refuse("MAIN_GUARD_COUNT", "skill source must have exactly one real if (import.meta.main) guard", candidate.reading.path);
    const guard = candidate.mainGuards[0];
    exactKeys(guard, ["type", "version", "path", "start", "end"], "main guard");
    if (guard.type !== "JavascriptFileMainGuard" || guard.version !== 1 || guard.path !== candidate.reading.path) refuse("MAIN_GUARD_READING_MISMATCH", "main guard must have been read from the same file", candidate.reading.path);
    return freezeJson({
      type: "JavascriptOperationSkillSource",
      version: 1,
      name,
      summary: summaries[0].text.trim(),
      body: documentation.description.trim(),
      scriptPath: `scripts/${path.posix.basename(candidate.reading.path)}`,
      reading: candidate.reading,
      documentation,
      mainGuard: guard,
    });
  } catch (error) {
    return refusal(error);
  }
}

if (import.meta.main) {
  const parsed = parseJavascriptArgv({ type: "JavascriptArgvParsingRequest", version: 1, argumentVector: { type: "JavascriptArgumentVector", version: 1, arguments: process.argv }, options: { help: { type: "boolean", short: "h", default: false } }, allowPositionals: false, strict: true });
  if (parsed.options.help) {
    const source = await readFile(new URL(import.meta.url), "utf8");
    const [documentation] = readJavascriptFileExportDocumentation({ type: "TextFileRead", path: "scripts/admit-javascript-operation-skill-source.mjs", text: source });
    const helpOutput = `${documentation.name} — ${documentation.description}\n\n${documentation.signature}\n`;
    if (!process.stdout.write(helpOutput)) await once(process.stdout, "drain");
  } else {
    process.stdin.setEncoding("utf8");
    let text = "";
    for await (const chunk of process.stdin) text += chunk;
    const output = serializeLines(parseLines(text).map(admitJavascriptOperationSkillSource));
    if (!process.stdout.write(output)) await once(process.stdout, "drain");
  }
}
