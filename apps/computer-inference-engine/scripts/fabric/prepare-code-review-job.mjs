#!/usr/bin/env node
import { isMain } from "@red-cup-engineering/javascript-file-services-section/javascript-file-main-guard";
import { writeFileAtomic, writeFileAtomicNew } from "@red-cup-engineering/computer-system-engine/filesystem";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { sha256Hex } from "@red-cup-engineering/cryptographic-computer-data-engineering-services-section/integrity";

const valued = new Set(["id", "root", "instruction-file", "file", "output", "difficulty", "max-tokens", "max-source-bytes", "capability"]), booleans = new Set(["overwrite", "help"]);
function parse(argv) {
  const out = { file: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index]; if (!raw.startsWith("--")) throw new Error(`unexpected argument ${raw}`);
    const key = raw.slice(2); if (booleans.has(key)) out[key] = true;
    else if (valued.has(key)) { const value = argv[++index]; if (!value || value.startsWith("--")) throw new Error(`missing value for --${key}`); if (key === "file") out.file.push(value); else out[key] = value; }
    else throw new Error(`unknown flag --${key}`);
  }
  return out;
}
const integer = (value, fallback, low, high, name) => { const number = value === undefined ? fallback : Number(value); if (!Number.isInteger(number) || number < low || number > high) throw new Error(`${name} must be an integer from ${low} to ${high}`); return number; };
const decimal = (value, fallback, low, high, name) => { const number = value === undefined ? fallback : Number(value); if (!Number.isFinite(number) || number < low || number > high) throw new Error(`${name} must be a number from ${low} to ${high}`); return number; };
const inside = (root, candidate) => { const path = relative(root, candidate); return path === "" || (!path.startsWith("..") && !isAbsolute(path)); };

export function prepareCodeReviewJob({ id, rootPath, instructionPath, filePaths, difficulty = 0.65, maxTokens = 600, maxSourceBytes = 512 * 1024, capability = "code-review" }) {
  if (typeof id !== "string" || !id || id.length > 200) throw new Error("id must be a nonempty string no longer than 200 characters");
  if (!Array.isArray(filePaths) || !filePaths.length || filePaths.length > 24) throw new Error("provide from 1 to 24 --file values");
  if (typeof capability !== "string" || !capability || capability.length > 100) throw new Error("capability must be a nonempty string");
  const root = realpathSync(resolve(rootPath)), instructionFile = realpathSync(resolve(instructionPath));
  if (!inside(root, instructionFile) || !lstatSync(instructionFile).isFile()) throw new Error("instruction-file must be a regular file inside root");
  const instruction = readFileSync(instructionFile, "utf8").trim(); if (!instruction || Buffer.byteLength(instruction) > 32 * 1024 || instruction.includes("\0")) throw new Error("instruction-file must contain 1 to 32768 bytes of UTF-8 text without NUL");
  const seen = new Set(); let totalBytes = 0;
  const sources = filePaths.map((supplied) => {
    const lexical = resolve(root, supplied); if (!inside(root, lexical)) throw new Error(`file escapes root: ${supplied}`);
    if (lstatSync(lexical).isSymbolicLink()) throw new Error(`file must not be a symbolic link: ${supplied}`);
    const path = realpathSync(lexical); if (!inside(root, path) || !lstatSync(path).isFile()) throw new Error(`file must be a regular file inside root: ${supplied}`);
    const label = relative(root, path).replaceAll("\\", "/"); if (seen.has(label)) throw new Error(`duplicate file: ${label}`); seen.add(label);
    const content = readFileSync(path); if (content.includes(0)) throw new Error(`file appears binary: ${label}`); totalBytes += content.length; if (totalBytes > maxSourceBytes) throw new Error(`source exceeds max-source-bytes (${maxSourceBytes})`);
    return { path: label, sha256: sha256Hex(content), bytes: content.length, content: content.toString("utf8") };
  });
  const manifest = sources.map(({ path, sha256, bytes }) => ({ path, sha256, bytes }));
  const sourceText = sources.map(({ path, sha256, bytes, content }) => `\n--- SOURCE ${path} sha256=${sha256} bytes=${bytes} ---\n${content}\n--- END SOURCE ${path} ---`).join("\n");
  return {
    id,
    workType: "code-review",
    requiredCapabilities: [capability],
    difficulty,
    maxTokens,
    messages: [
      { role: "system", content: "You have no repository tools. Review only the complete source files embedded in the user message. Never claim a file was unavailable. Return only the contracted JSON." },
      { role: "user", content: `${instruction}\n\nEcho inspectedSources exactly as supplied in the manifest. Do not report style preferences.\nMANIFEST ${JSON.stringify(manifest)}\n${sourceText}` }
    ],
    outputContract: {
      format: "json",
      schema: {
        type: "object",
        required: ["verdict", "inspectedSources", "criticalRisks", "nextTest"],
        properties: {
          verdict: { type: "string", enum: ["pass", "changes-required"] },
          inspectedSources: { const: manifest },
          criticalRisks: { type: "array", maxItems: 6, items: { type: "string", minLength: 15, maxLength: 500 } },
          nextTest: { type: "string", minLength: 20, maxLength: 500 }
        },
        additionalProperties: false
      }
    }
  };
}

/** A changed file reduced to its changed span: the differing lines between the common
 *  prefix and suffix, with the counts of unchanged lines omitted, for reviewing a candidate
 *  change instead of whole files. A new file is its complete source. */
export function changedSourceProjection(change) {
  const after = Buffer.from(change.after).toString("utf8");
  if (!change.before?.bytes) return { path: change.path, after, projection: "complete-after-source" };
  const beforeLines = Buffer.from(change.before.bytes).toString("utf8").split("\n"), afterLines = after.split("\n");
  let prefix = 0;
  while (prefix < beforeLines.length && prefix < afterLines.length && beforeLines[prefix] === afterLines[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < beforeLines.length - prefix && suffix < afterLines.length - prefix
    && beforeLines[beforeLines.length - 1 - suffix] === afterLines[afterLines.length - 1 - suffix]) suffix += 1;
  const beforeEnd = beforeLines.length - suffix, afterEnd = afterLines.length - suffix;
  return {
    path: change.path,
    projection: "exact-changed-span-with-context",
    beforeStartLine: prefix + 1,
    before: beforeLines.slice(prefix, beforeEnd).join("\n"),
    afterStartLine: prefix + 1,
    after: afterLines.slice(prefix, afterEnd).join("\n"),
    omittedUnchangedPrefixLines: prefix,
    omittedUnchangedSuffixLines: Math.min(beforeLines.length - beforeEnd, afterLines.length - afterEnd),
  };
}

function writeAtomic(path, content, overwrite) {
  const target = resolve(path);
  try {
    (overwrite ? writeFileAtomic : writeFileAtomicNew)(target, content, { mode: 0o600 });
  } catch (error) {
    if (error.code === "EEXIST") throw new Error(`output exists: ${target}`);
    throw error;
  }
}

async function main() {
  const args = parse(process.argv.slice(2));
  if (args.help) { process.stderr.write("usage: prepare-code-review-job --id ID --root PATH --instruction-file PATH --file PATH [--file PATH ...] [--output PATH] [--capability code-review] [--difficulty 0..1] [--max-tokens N] [--max-source-bytes N] [--overwrite]\n"); return; }
  for (const required of ["id", "root", "instruction-file"]) if (!args[required]) throw new Error(`--${required} is required`);
  const job = prepareCodeReviewJob({ id: args.id, rootPath: args.root, instructionPath: args["instruction-file"], filePaths: args.file, difficulty: decimal(args.difficulty, 0.65, 0, 1, "difficulty"), maxTokens: integer(args["max-tokens"], 600, 64, 8192, "max-tokens"), maxSourceBytes: integer(args["max-source-bytes"], 512 * 1024, 1024, 1024 * 1024, "max-source-bytes"), capability: args.capability ?? "code-review" });
  const encoded = `${JSON.stringify(job)}\n`; if (args.output) writeAtomic(args.output, encoded, args.overwrite); else process.stdout.write(encoded);
}

if (isMain(import.meta.url)) try { await main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 2; }
