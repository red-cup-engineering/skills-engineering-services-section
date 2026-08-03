import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

function nonempty(value, label) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${label} is required`);
  return value.trim();
}
function id(value) { return `urn:sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`; }

export function selectBoundedEvidence(input) {
  const root = resolve(nonempty(input?.root, "root"));
  const query = nonempty(input?.query, "query");
  const limit = input?.limit ?? 300, maxBytes = input?.maxBytes ?? 1024 * 1024;
  if (!Number.isSafeInteger(limit) || limit < 1) throw new TypeError("limit must be a positive safe integer");
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new TypeError("maxBytes must be a positive safe integer");
  const excludeGlobs = input?.excludeGlobs ?? [];
  if (!Array.isArray(excludeGlobs) || excludeGlobs.some((glob) => typeof glob !== "string" || glob === "")) throw new TypeError("excludeGlobs must contain strings");
  const args = ["--files-with-matches", "--fixed-strings", ...(input.ignoreCase === false ? [] : ["--ignore-case"]), ...excludeGlobs.flatMap((glob) => ["--glob", `!${glob}`]), "--", query, root];
  const result = spawnSync(input?.searchExecutable ?? "rg", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (![0, 1].includes(result.status)) throw new Error((result.stderr || `evidence selector exited ${result.status}`).trim());
  const sources = result.stdout.split(/\r?\n/u).filter(Boolean).sort().slice(0, limit).map((path) => {
    const absolute = resolve(path);
    if (!isAbsolute(absolute) || (absolute !== root && !absolute.startsWith(`${root}/`))) throw new Error("evidence selector returned a path outside root");
    const bytes = readFileSync(absolute);
    if (statSync(absolute).size > maxBytes) return Object.freeze({ path: relative(root, absolute), disposition: "excluded-too-large", bytes: statSync(absolute).size });
    return Object.freeze({ path: relative(root, absolute), disposition: "selected", bytes: bytes.length, digest: `urn:sha256:${createHash("sha256").update(bytes).digest("hex")}` });
  });
  const body = Object.freeze({ type: "BoundedEvidenceSourceCoverK", root, query, limit, maxBytes, excludeGlobs, sources, truncated: sources.length === limit });
  return Object.freeze({ id: id(body), ...body });
}

export async function invokeExternalActuator(input, transport, verify = null) {
  const actor = nonempty(input?.actor, "actor"), operation = nonempty(input?.operation, "operation");
  if (typeof transport !== "function") throw new TypeError("an actuator transport is required");
  if (!input.arguments || typeof input.arguments !== "object" || Array.isArray(input.arguments)) throw new TypeError("arguments must be an object");
  const request = Object.freeze({ type: "ExternalActuatorInvocationK", actor, operation, arguments: input.arguments, authorityEvidence: input.authorityEvidence ?? null });
  const requestId = id(request);
  const providerResult = await transport(Object.freeze({ id: requestId, ...request }));
  if (!providerResult || typeof providerResult !== "object") throw new TypeError("actuator transport returned no structured provider result");
  const verification = typeof verify === "function" ? await verify({ request: Object.freeze({ id: requestId, ...request }), providerResult }) : null;
  const body = Object.freeze({ type: "ExternalActuatorInvocationReceiptK", request: requestId, actor, operation, providerResult, verification, acceptance: null });
  return Object.freeze({ id: id(body), ...body });
}
