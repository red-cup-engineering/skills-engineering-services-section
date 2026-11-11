import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { transformJavascriptScriptToSkill } from "@red-cup-engineering/transform-javascript-script-to-skill-service";

const SCRIPT_EXTENSIONS = new Set([".js", ".mjs"]);

/**
 * Read the original flat pool and report eligibility for the existing JSDoc-to-skill
 * transformer. Every negative remains visible so a producer can repair the
 * original script rather than confusing zero candidates with a successful scan.
 *
 * This is source discovery, NOT validation, skill projection, a harness grant,
 * evidence of a runnable main guard, or publication. Those belong to the
 * existing downstream Engineering services and the receiver.
 */
export function inspectSkillScriptsInADirectory(directory) {
  if (typeof directory !== "string" || directory === "") throw new TypeError("directory must be a non-empty string");
  const root = resolve(directory);
  let rootStat;
  try { rootStat = statSync(root); }
  catch (error) {
    if (error.code === "ENOENT") throw new Error("no such directory: " + root);
    throw error;
  }
  if (!rootStat.isDirectory()) throw new Error("not a directory: " + root);

  const candidates = [], rejected = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    // No arbitrary text matches, symlink escapes, nested pools, or second parser.
    if (!entry.isFile() || !SCRIPT_EXTENSIONS.has(extname(entry.name))) continue;
    const source = join(root, entry.name);
    const transformed = transformJavascriptScriptToSkill(readFileSync(source, "utf8"), entry.name);
    let reason = transformed.error;
    if (!reason && (typeof transformed.record.description !== "string" || !transformed.record.description.trim())) {
      reason = "missing nonempty JSDoc @description";
    }
    if (!reason && (typeof transformed.body !== "string" || !transformed.body.trim())) {
      reason = "missing nonempty instructional prose for SKILL.md";
    }
    if (reason) rejected.push({ path: source, reason });
    else candidates.push(source);
  }
  return Object.freeze({
    candidates: Object.freeze(candidates.sort()),
    rejected: Object.freeze(rejected.sort((left, right) => left.path.localeCompare(right.path)).map(Object.freeze)),
  });
}

/** Backward-compatible result shape, with current transform admission semantics. */
export function findSkillScriptsInADirectory(directory) {
  return [...inspectSkillScriptsInADirectory(directory).candidates];
}
