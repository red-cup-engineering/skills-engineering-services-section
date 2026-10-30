import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export function repoRoot(start) {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error("runtime: cannot locate repository root (no .git found above this package)");
    dir = parent;
  }
}

export function cliArg(name) {
  const at = process.argv.indexOf(name);
  return at === -1 ? undefined : process.argv[at + 1];
}
