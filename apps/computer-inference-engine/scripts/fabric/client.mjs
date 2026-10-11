// One EXECUTE-stage gate any model actor can hire, instead of each provider
// hand-copying the same mechanics under its own name. Extracted from what
// were, until this service existed, two byte-identical implementations
// (bare-cedar-fog-claude and bare-cedar-fog-codex each carried their own
// src/authority-bounded-integration.mjs, differing only in the literal
// strings CLAUDE/CODEX baked into type names and error messages). Record
// type names here stay actor-neutral for the same reason enterprise.mjs
// keeps its own observation types actor-neutral: the actor field, not the
// type name, says whose act it was.
//
// Mechanics: single-use authority claim by atomic exclusive file create,
// content-addressed intent binding, before/after byte verification,
// path-escape and symlink refusal, atomic write. Closure-kind: process. No
// branching on surprise — every unmet precondition throws with the reason.

import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

function nonempty(value, label) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${label} is required`);
  return value.trim();
}

function relativeTarget(value) {
  const path = nonempty(value, "target path");
  if (path.startsWith("/") || path.split("/").some((part) => part === "" || part === "." || part === "..")) throw new TypeError("target path must be one normalized workspace-relative path");
  return path;
}

function digestList(value, label) {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError(`${label} must be nonempty`);
  return Object.freeze(value.map((entry, index) => nonempty(entry, `${label}[${index}]`)));
}

function targetWithinWorkspace(workspaceRoot, path) {
  const root = realpathSync(resolve(workspaceRoot));
  const target = resolve(root, path);
  const rel = relative(root, target);
  if (rel === "" || rel.startsWith("..") || rel.startsWith("/") || rel.includes("/../")) throw new TypeError("target escapes the authorized workspace");
  const parent = realpathSync(dirname(target));
  const parentRel = relative(root, parent);
  if (parentRel.startsWith("..") || parentRel.startsWith("/")) throw new TypeError("target parent escapes the authorized workspace through a symlink");
  if (existsSync(target) && lstatSync(target).isSymbolicLink()) throw new TypeError("symbolic-link mutation targets are refused");
  return target;
}

// actor: this actuator's own urn:ame:... identity.
// customer: the urn that alone may issue authority to this actor.
// identity(value): the caller's own content-addressing function, so this
//   service shares one hash discipline with the rest of its caller's records
//   instead of carrying a second, possibly-drifted copy.
// byteDigest(bytes): the caller's own byte-digest function, same reason.
// defaultStateRoot: where authority claims are recorded absent an explicit
//   claimsRoot option.
export function createAuthorityBoundedIntegration({ actor, customer, identity, byteDigest, defaultStateRoot, provider = actor, offer = `urn:offer:${actor?.startsWith("urn:ame:") ? actor.slice("urn:ame:".length) : actor}-authority-bounded-integration` }) {
  nonempty(actor, "actor");
  nonempty(customer, "customer");
  if (typeof identity !== "function") throw new TypeError("identity is required");
  if (typeof byteDigest !== "function") throw new TypeError("byteDigest is required");
  nonempty(defaultStateRoot, "defaultStateRoot");
  nonempty(provider, "provider");
  nonempty(offer, "offer");

  const AUTHOR_PROCESS_DIGEST = identity({ type: "ActuatorProcessK", actor, pid: process.pid, startedAt: new Date().toISOString() });

  function exact(value, label, type) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an exact object`);
    const { id, ...body } = value;
    if (id !== identity(body)) throw new TypeError(`${label} must be content addressed exactly`);
    if (body.type !== type || body.version !== 1) throw new TypeError(`${label} must be ${type} version 1`);
    return Object.freeze({ id, ...body });
  }

  function mutationIntent(body) {
    const afterContent = body?.afterContent;
    if (typeof afterContent !== "string" || afterContent.length === 0) throw new TypeError("afterContent is required");
    const selected = {
      type: "MutationIntentK", version: 1, actor,
      demand: nonempty(body?.demand, "demand"), plan: nonempty(body?.plan, "plan"),
      path: relativeTarget(body?.path), operation: "write-file",
      beforeDigest: body?.beforeDigest ?? null, afterDigest: byteDigest(Buffer.from(afterContent)),
      afterContent, sourceProviderReceipts: digestList(body?.sourceProviderReceipts, "sourceProviderReceipts"),
      conveys: [],
    };
    return Object.freeze({ id: identity(selected), ...selected });
  }

  function leaderAuthority(body) {
    const scope = body?.scope;
    if (!Array.isArray(scope) || scope.length !== 1) throw new TypeError("LeaderAuthorityK must authorize exactly one bounded mutation");
    const selectedScope = Object.freeze(scope.map((entry) => Object.freeze({
      path: relativeTarget(entry?.path), operation: entry?.operation === "write-file" ? "write-file" : (() => { throw new TypeError("authority operation must be write-file"); })(),
      beforeDigest: entry?.beforeDigest ?? null, afterDigest: nonempty(entry?.afterDigest, "scope.afterDigest"),
    })));
    const selected = {
      type: "LeaderAuthorityK", version: 1, issuer: customer, actor,
      demand: nonempty(body?.demand, "demand"), plan: nonempty(body?.plan, "plan"),
      sourceDigest: nonempty(body?.sourceDigest, "sourceDigest"), transportReceipt: nonempty(body?.transportReceipt, "transportReceipt"),
      issuedAt: nonempty(body?.issuedAt, "issuedAt"),
      singleUse: true, scope: selectedScope, conveys: ["repository-mutation"],
    };
    return Object.freeze({ id: identity(selected), ...selected });
  }

  function validatePlan(value) {
    const plan = exact(value, "actuationPlan", "RequirementBoundActuationPlanK");
    if (plan.actor !== actor || plan.mutationAuthorized !== false || plan.acceptanceAuthorized !== false || !Array.isArray(plan.conveys) || plan.conveys.length !== 0) throw new TypeError("actuation plan must be inert and belong to this actor");
    return plan;
  }

  function validateAuthority(value, { demand, plan, intent }) {
    const authority = exact(value, "authority", "LeaderAuthorityK");
    if (authority.issuer !== customer || authority.actor !== actor) throw new TypeError("only the exact customer may issue authority to this actor");
    if (authority.demand !== demand || authority.plan !== plan.id) throw new TypeError("authority demand or plan binding mismatch");
    if (authority.singleUse !== true || JSON.stringify(authority.conveys) !== JSON.stringify(["repository-mutation"])) throw new TypeError("authority must be single-use repository-mutation authority");
    if (!Number.isFinite(Date.parse(authority.issuedAt))) throw new TypeError("authority must retain a valid issuance observation");
    const expected = [{ path: intent.path, operation: intent.operation, beforeDigest: intent.beforeDigest, afterDigest: intent.afterDigest }];
    if (JSON.stringify(authority.scope) !== JSON.stringify(expected)) throw new TypeError("authority scope does not bind the exact mutation bytes");
    return authority;
  }

  function claimAuthority(authority, claimsRoot, now) {
    mkdirSync(claimsRoot, { recursive: true, mode: 0o700 });
    const path = resolve(claimsRoot, `${authority.id.slice("urn:sha256:".length)}.json`);
    let descriptor;
    try {
      descriptor = openSync(path, "wx", 0o600);
      writeFileSync(descriptor, `${JSON.stringify({ authority: authority.id, claimedBy: actor, claimedAt: now.toISOString() })}\n`);
    } catch (error) {
      if (error?.code === "EEXIST") throw new TypeError("LeaderAuthorityK has already been consumed");
      throw error;
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
    }
    return byteDigest(readFileSync(path));
  }

  // The one call permitted to touch the filesystem, and only given a plan
  // that carries no authority of its own plus a single-use authority token
  // that names the exact bytes being written. Everything before this point
  // (demand, plan, intent) is inert data; nothing here trusts a claim that
  // this data was vetted upstream — it re-derives every check from the raw
  // inputs.
  function executeAuthorityBoundIntegration(input, options = {}) {
    if (input?.actor !== actor) throw new TypeError(`execution actor must be ${actor}`);
    const demand = nonempty(input?.demand, "demand");
    const plan = validatePlan(input?.actuationPlan);
    if (plan.demand !== demand) throw new TypeError("plan demand binding mismatch");
    const intent = exact(input?.intent, "intent", "MutationIntentK");
    if (intent.actor !== actor || intent.demand !== demand || intent.plan !== plan.id || intent.operation !== "write-file" || !Array.isArray(intent.conveys) || intent.conveys.length !== 0) throw new TypeError("mutation intent does not bind the exact plan without authority");
    digestList(intent.sourceProviderReceipts, "intent.sourceProviderReceipts");
    if (typeof intent.afterContent !== "string" || intent.afterContent.length === 0 || intent.afterDigest !== byteDigest(Buffer.from(intent.afterContent))) throw new TypeError("mutation intent after bytes drifted");
    const now = options.now?.() ?? new Date();
    const authority = validateAuthority(input?.authority, { demand, plan, intent });
    const workspaceRoot = options.workspaceRoot ?? process.cwd();
    const target = targetWithinWorkspace(workspaceRoot, intent.path);
    const observedBefore = existsSync(target) ? byteDigest(readFileSync(target)) : null;
    if (observedBefore !== intent.beforeDigest) throw new TypeError("workspace bytes changed since the authorized mutation was formed");
    const nativeResourceReceipt = nonempty(input?.nativeResourceReceipt, "nativeResourceReceipt");
    const claimsRoot = resolve(options.claimsRoot ?? resolve(defaultStateRoot, "authority-claims"));
    const authorityClaimReceipt = claimAuthority(authority, claimsRoot, now);
    const temporary = `${target}.${authority.id.slice(-16)}.actuator-candidate`;
    const descriptor = openSync(temporary, "wx", existsSync(target) ? lstatSync(target).mode : 0o600);
    try { writeFileSync(descriptor, intent.afterContent); } finally { closeSync(descriptor); }
    renameSync(temporary, target);
    const observedAfter = byteDigest(readFileSync(target));
    if (observedAfter !== intent.afterDigest) throw new TypeError("materialized candidate digest mismatch");
    const body = {
      type: "CandidatePatchK", version: 1, provider,
      actor, customer, demand, plan: plan.id, authority: authority.id,
      authorityClaimReceipt, intent: intent.id, path: intent.path, operation: intent.operation,
      beforeDigest: observedBefore, afterDigest: observedAfter, sourceProviderReceipts: intent.sourceProviderReceipts,
      nativeResourceReceipt, offer,
      authorProcessDigest: AUTHOR_PROCESS_DIGEST, materializedAt: now.toISOString(),
      consideration: input?.consideration ?? null,
      considerationDisposition: "preserved-native-resource-observation-not-invented-cost",
      verification: null, customerOutcome: null, mutationAuthority: false, acceptanceAuthority: false, conveys: [],
    };
    return Object.freeze({ id: identity(body), ...body });
  }

  return Object.freeze({
    actor, customer, provider, offer, AUTHOR_PROCESS_DIGEST,
    mutationIntent, leaderAuthority, executeAuthorityBoundIntegration,
  });
}
