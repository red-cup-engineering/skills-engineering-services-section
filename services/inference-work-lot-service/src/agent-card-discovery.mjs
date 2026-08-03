import { AGENT_CARD_PATH, AgentCard, canonicalizeAgentCard } from "@a2a-js/sdk";
import { base64url, decodeProtectedHeader, flattenedVerify, importJWK } from "jose";

const ATTEMPTS = 6;
function transient(error) {
  const codes = new Set(["ECONNREFUSED", "ECONNRESET", "EPIPE", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET"]);
  for (let current = error; current; current = current.cause) if (codes.has(current.code) || current.message === "fetch failed") return true;
  return false;
}
async function fetchJson(url, options, fetchCard, signal, label) {
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) try {
    const response = await fetchCard(url, { ...options, signal });
    if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    if (attempt === ATTEMPTS || !transient(error)) throw error;
    await new Promise((accept, reject) => {
      if (signal?.aborted) return reject(signal.reason ?? new Error("Agent Card discovery retry aborted"));
      setImmediate(accept);
    });
  }
}
async function verifyCard(card, cardUrl, fetchCard, signal) {
  if (!card.signatures?.length) throw new Error("Agent Card has no signature");
  const normalized = AgentCard.toJSON(card); delete normalized.signatures;
  const payload = base64url.encode(new TextEncoder().encode(canonicalizeAgentCard(normalized)));
  let lastError;
  for (const signature of card.signatures) try {
    const { kid, jku, alg, typ } = decodeProtectedHeader(signature);
    if (!kid || !jku || !alg || typ !== "JOSE") throw new Error("Agent Card signature protected header is incomplete");
    const url = new URL(jku), expected = new URL("./jwks.json", cardUrl);
    if (url.href !== expected.href || url.search || url.hash) throw new Error("Agent Card jku must name the same-origin sibling .well-known/jwks.json resource");
    const jwks = await fetchJson(url, { headers: { Accept: "application/jwk-set+json, application/json" } }, fetchCard, signal, "Agent Card JWKS discovery");
    const matches = jwks?.keys?.filter((key) => key?.kid === kid && key?.alg === alg && !Object.hasOwn(key, "d")) ?? [];
    if (matches.length !== 1) throw new Error("Agent Card JWKS must expose exactly one public key for kid");
    await flattenedVerify({ payload, protected: signature.protected, signature: signature.signature, ...(signature.header ? { header: signature.header } : {}) }, await importJWK(matches[0], alg));
    return;
  } catch (error) { lastError = error; }
  throw new Error("Agent Card has no valid signature", { cause: lastError });
}

export async function discoverAgentCard({ agentUrl, fetch: fetchCard = globalThis.fetch, requireSignature = false, signal }) {
  let url; try { url = new URL(agentUrl); } catch { throw new Error("agentUrl must be an absolute Agent Card URL"); }
  if (!["http:", "https:"].includes(url.protocol) || !url.pathname.endsWith(`/${AGENT_CARD_PATH}`)) throw new Error(`agentUrl must name the standard /${AGENT_CARD_PATH} resource over HTTP or HTTPS`);
  const card = AgentCard.fromJSON(await fetchJson(url, { headers: { "A2A-Version": "1.0", Accept: "application/json" } }, fetchCard, signal, "Agent Card discovery"));
  if (!Array.isArray(card.supportedInterfaces) || card.supportedInterfaces.length === 0) throw new Error("Agent Card exposes no interface");
  for (const face of card.supportedInterfaces) if (face.protocolVersion !== "1.0" || !["JSONRPC", "HTTP+JSON"].includes(face.protocolBinding)) throw new Error("Agent Card exposes an unsupported interface");
  if (requireSignature) await verifyCard(card, url, fetchCard, signal);
  return card;
}
export async function discoverSignedAgentCard(options) {
  const card = await discoverAgentCard({ ...options, requireSignature: true });
  if (card.signatures.length !== 1) throw new Error("sovereign Agent Card profile requires exactly one valid JWS signature");
  return card;
}
