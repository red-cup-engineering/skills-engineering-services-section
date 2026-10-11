import { createHash } from "node:crypto";
import { jsonValueId } from "../dispatch/sen-carrier.mjs";

const digest = (bytes) => `ni:///sha-256;${createHash("sha256").update(bytes).digest("base64url")}`;
const text = (value, field) => {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${field} must be nonempty text`);
  return value;
};

/** One provider-neutral media request, identified by its exact prompt and source bytes. */
export function createMediaArtifactWorkLot({ workLot, principal, capability, prompt, sources, outputMimeType }) {
  for (const [field, value] of Object.entries({ workLot, principal, capability, prompt, outputMimeType })) text(value, field);
  if (!Array.isArray(sources) || sources.some((source) => typeof source?.identity !== "string" || !/^ni:\/\/\/sha-256;[A-Za-z0-9_-]{43}$/u.test(source.identity))) throw new TypeError("sources must carry content-addressed identities");
  const body = { type: "MediaArtifactWorkLot", workLot, principal, capability, prompt, sources: structuredClone(sources), outputMimeType };
  return Object.freeze({ id: jsonValueId(body), ...body });
}

/** Record an actual provider output against the same work lot, without inventing quota. */
export function completeMediaArtifactWork(lot, { providerIdentity, product, executionMode, bytes, mimeType, providerArtifactId, packetIdentity, resource, accountIdentity, windowIdentity, recordedAt = new Date().toISOString() }) {
  if (lot?.type !== "MediaArtifactWorkLot" || lot.id !== jsonValueId(Object.fromEntries(Object.entries(lot).filter(([key]) => key !== "id")))) throw new TypeError("media work lot identity is invalid");
  for (const [field, value] of Object.entries({ providerIdentity, product, executionMode, mimeType })) text(value, field);
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw new TypeError("artifact bytes are required");
  if (mimeType !== lot.outputMimeType && !(lot.outputMimeType === "image/*" && ["image/png", "image/jpeg"].includes(mimeType))) throw new TypeError("artifact MIME type differs from work lot");
  if (!Number.isFinite(Date.parse(recordedAt))) throw new TypeError("recordedAt must be an instant");
  const body = {
    type: "MediaArtifactWorkCompletion", workLot: lot.workLot, request: lot.id, principal: lot.principal,
    capability: lot.capability, providerIdentity, product, executionMode,
    prompt: digest(Buffer.from(lot.prompt)), promptText: lot.prompt, sources: lot.sources,
    output: { identity: digest(bytes), bytes: bytes.length, mimeType },
    ...(packetIdentity ? { packet: text(packetIdentity, "packetIdentity") } : {}),
    ...(providerArtifactId ? { providerArtifactId: text(providerArtifactId, "providerArtifactId") } : {}),
    ...(resource ? { resource: structuredClone(resource) } : {}),
    ...(accountIdentity ? { accountIdentity: text(accountIdentity, "accountIdentity") } : {}),
    ...(windowIdentity ? { windowIdentity: text(windowIdentity, "windowIdentity") } : {}),
    recordedAt,
  };
  return Object.freeze({ id: jsonValueId(body), ...body });
}
