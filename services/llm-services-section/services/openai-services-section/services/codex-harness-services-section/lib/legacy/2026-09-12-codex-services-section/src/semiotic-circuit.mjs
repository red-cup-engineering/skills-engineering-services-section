import { EMPTY_WITNESS_ROOT, identifyJsonSemanticContent } from "@red-cup-engineering/semantic-content-identify-service";

const NI = /^ni:\/\/\/sha-256;[A-Za-z0-9_-]{43}$/u;

export function semanticIdentity(value, objectKind = "bare-cedar-fog-codex.material") {
  return identifyJsonSemanticContent({ objectKind, value, witnessRoot: EMPTY_WITNESS_ROOT });
}

export function semanticByteIdentity(bytes, objectKind = "bare-cedar-fog-codex.byte-carrier") {
  const carrier = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return semanticIdentity({ encoding: "base64", bytes: carrier.toString("base64") }, objectKind);
}

export function semanticFileKey(token) {
  if (!NI.test(token)) throw new TypeError("semantic file key requires one SHA-256 NI identity");
  return Buffer.from(token.slice("ni:///sha-256;".length), "base64url").toString("hex");
}

export function unresolvedCircuitObstruction(recordType) {
  return Object.freeze({
    complete: false,
    recordType,
    obstruction: "Articulating→Predicating→Positing→Settling factorization is not yet admitted for this MAPE carrier; no evidence polarity, FOUR reading, generator, or fixed point is inferred.",
  });
}
