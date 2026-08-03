import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const HAS_SKILL_TAG = /@skill\s/u;

/**
 * Every flat file directly inside one directory that carries an `@skill`
 * declaration in its text — found by reading each file, not by trusting a
 * name pattern or a hardcoded pool path.
 *
 * Precondition: `directory` exists on disk.
 * Input: `directory` — an absolute or relative path, taken as an argument.
 *   This service never hardcodes a pool path; the caller names the pool it
 *   means.
 * Output: an array of absolute paths, sorted, to every regular file directly
 *   inside `directory` whose text matches `@skill `.
 * Postcondition: subdirectories are not descended into; a directory that
 *   does not exist raises a clear error rather than returning an empty
 *   array, since an absent pool and an empty pool are different facts.
 */
export function findSkillScriptsInADirectory(directory) {
  if (typeof directory !== "string" || directory === "") throw new TypeError("directory must be a non-empty string");
  const root = resolve(directory);
  if (!existsSync(root)) throw new Error(`no such directory: ${root}`);
  if (!statSync(root).isDirectory()) throw new Error(`not a directory: ${root}`);

  return readdirSync(root)
    .map((entry) => join(root, entry))
    .filter((path) => statSync(path).isFile())
    .filter((path) => HAS_SKILL_TAG.test(readFileSync(path, "utf8")))
    .sort();
}
