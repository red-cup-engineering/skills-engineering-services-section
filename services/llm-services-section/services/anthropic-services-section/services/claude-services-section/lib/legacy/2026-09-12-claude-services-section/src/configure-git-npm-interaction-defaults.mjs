import { spawnSync } from "node:child_process";

// Measured 2026-09-11 on this checkout: `git status` with the default
// `status.submodulesummary` walks all 5 submodules on top of the 270k-file
// tree — 9.4s wall / 22.8s sys — against 2.9s wall / 3.7s sys with it off.
// npm's `audit`/`fund` defaults each add a registry round-trip to every
// install this session's publish and repin operators run, and
// `prefer-offline=false` makes npm revalidate against the registry instead
// of trusting the multi-gigabyte warm local cache. None of the three change
// what gets installed, published, or committed — only how much the host
// pays to answer.
const GIT_DEFAULTS = Object.freeze({ "status.submodulesummary": "false" });
const NPM_DEFAULTS = Object.freeze({ audit: "false", fund: "false", "prefer-offline": "true" });

function defaultRun(command, args, options) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.error) throw result.error;
  return result;
}

function applyConfig({ run, command, key, value, getArgs, setArgs, cwd }) {
  const read = run(command, getArgs, { cwd });
  const previous = read.status === 0 ? read.stdout.trim() : null;
  if (previous === value) return Object.freeze({ key, previous, applied: value, changed: false });
  const write = run(command, setArgs, { cwd });
  if (write.status !== 0) throw new Error(`${command} ${setArgs.join(" ")} failed: ${(write.stderr || write.stdout || "").trim()}`);
  return Object.freeze({ key, previous, applied: value, changed: true });
}

/**
 * Idempotently applies this host's known-cheap Git and npm interaction defaults. Safe to run every
 * session start: a setting already at its target value is left untouched and reported unchanged.
 *
 * @param {{repositoryRoot: string, run?: typeof defaultRun}} options
 * @returns {{git: ReadonlyArray<{key: string, previous: string|null, applied: string, changed: boolean}>, npm: ReadonlyArray<{key: string, previous: string|null, applied: string, changed: boolean}>}}
 * @throws {TypeError} When repositoryRoot is missing.
 * @throws {Error} When a config write fails.
 */
export function configureGitNpmInteractionDefaults({ repositoryRoot, run = defaultRun } = {}) {
  if (typeof repositoryRoot !== "string" || repositoryRoot === "") throw new TypeError("repositoryRoot is required");
  const git = Object.entries(GIT_DEFAULTS).map(([key, value]) =>
    applyConfig({ run, command: "git", key, value, cwd: repositoryRoot, getArgs: ["config", "--get", key], setArgs: ["config", key, value] }),
  );
  const npm = Object.entries(NPM_DEFAULTS).map(([key, value]) =>
    applyConfig({ run, command: "npm", key, value, cwd: repositoryRoot, getArgs: ["config", "get", key], setArgs: ["config", "set", key, value] }),
  );
  return Object.freeze({ git: Object.freeze(git), npm: Object.freeze(npm) });
}
