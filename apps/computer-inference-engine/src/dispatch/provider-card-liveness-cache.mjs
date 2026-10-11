import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { dataCustodyDirectory } from "@red-cup-engineering/data-custody-directory-service";

const DEFAULT_TTL_MS = 5 * 60 * 1000;

/**
 * @param {string} root - the owning package's absolute root directory
 * @returns {string} the durable liveness-cache file path under data/state/
 */
export function providerCardLivenessCachePath(root) {
  return `${dataCustodyDirectory(root, "state")}/provider-card-liveness.json`;
}

/**
 * @param {string} path
 * @returns {Record<string, {status: "offline", checkedAt: number, reason: string}>}
 */
function readCache(path) {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

/**
 * @param {string} path
 * @param {Record<string, unknown>} cache
 * @returns {void}
 */
function writeCache(path, cache) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
}

/**
 * Probe a provider agent card's liveness through a durable TTL cache so a
 * card that recently refused or errored is skipped without a repeat network
 * round trip, while still surfacing as offline residue to the caller.
 *
 * @param {string} root - the owning package's absolute root directory
 * @param {string} agentCardUrl - the provider card URL being probed
 * @param {() => Promise<*>} probe - performs the real network discovery
 * @param {{ttlMs?: number, now?: () => number}} [options]
 * @returns {Promise<*>} the probe's resolved value
 * @throws {Error} the cached or freshly observed probe failure
 */
export async function cachedProviderCardProbe(root, agentCardUrl, probe, { ttlMs = DEFAULT_TTL_MS, now = Date.now } = {}) {
  const path = providerCardLivenessCachePath(root);
  const cache = readCache(path);
  const entry = cache[agentCardUrl];
  const at = now();
  if (entry?.status === "offline" && at - entry.checkedAt < ttlMs) {
    const error = new Error(`provider card cached offline: ${entry.reason}`);
    error.code = "provider-card-cached-offline";
    error.cachedAt = entry.checkedAt;
    throw error;
  }
  try {
    const result = await probe();
    if (entry) {
      delete cache[agentCardUrl];
      writeCache(path, cache);
    }
    return result;
  } catch (error) {
    cache[agentCardUrl] = {
      status: "offline",
      checkedAt: at,
      reason: error instanceof Error ? error.message : String(error),
    };
    writeCache(path, cache);
    throw error;
  }
}

/**
 * @param {string} root - the owning package's absolute root directory
 * @returns {Record<string, {status: "offline", checkedAt: number, reason: string}>} the current cache contents
 */
export function readProviderCardLiveness(root) {
  return readCache(providerCardLivenessCachePath(root));
}
