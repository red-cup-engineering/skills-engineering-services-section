// Where this package caches tool-output evidence on disk. The package owns
// its state beside its source and callers may override it for tests or
// alternate installations with CODEX_TOOLKIT_STATE_ROOT.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dataCustodyDirectory } from "@red-cup-engineering/data-custody-directory-service";

const SECTION_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function defaultStateRoot() {
  return dataCustodyDirectory(SECTION_ROOT, "state");
}

export function stateRoot(options = {}) {
  return resolve(options.stateRoot ?? process.env.CODEX_TOOLKIT_STATE_ROOT ?? defaultStateRoot());
}
