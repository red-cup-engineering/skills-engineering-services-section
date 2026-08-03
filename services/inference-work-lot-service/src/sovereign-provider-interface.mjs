import { isCanonicalSha256NiUri } from "@red-cup-engineering/semantic-content-identify-service";

export const HIERARCHICAL_CIRCUIT_PROFILE = "org.emsenn.rmn.hierarchical-circuit.v3";
export const SOVEREIGN_CIRCUIT_INTERFACE_PROFILE = "org.emsenn.rmn.sovereign-circuit-interface.v1";
export const SOVEREIGN_CIRCUIT_INTERFACE_EXTENSION = "ni:///sha-256;wzh-zYeFQCsh4zAzGS34uacNV4qJeIEmCKIUUWyRZ-M";
const CAIP10 = /^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}:[-.%a-zA-Z0-9]{1,128}$/u;
const exact = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
function fail(message) { const error = new Error(message); error.code = "malformed-circuit"; throw error; }
function four(value) { return exact(value, ["negativeEvidence", "positiveEvidence"]) && typeof value.positiveEvidence === "boolean" && typeof value.negativeEvidence === "boolean"; }

function normalizeLeaf(source) {
  if (!exact(source, ["behavior", "instances", "law", "nets", "ports", "profile"]) || source.profile !== HIERARCHICAL_CIRCUIT_PROFILE || !isCanonicalSha256NiUri(source.law)) fail("public circuit component has an invalid profile or law");
  if (!Array.isArray(source.ports) || !Array.isArray(source.instances) || !Array.isArray(source.nets) || source.instances.length !== 0 || source.nets.length !== 0) fail("public circuit component must be one black-box leaf");
  const ports = source.ports.map((port) => {
    if (!exact(port, ["carrier", "direction", "mode", "name", "predicate"]) || typeof port.name !== "string" || !["input", "output"].includes(port.direction) || !["tensor", "par"].includes(port.mode) || !isCanonicalSha256NiUri(port.predicate) || !isCanonicalSha256NiUri(port.carrier)) fail("public circuit port is invalid");
    return structuredClone(port);
  }).sort((left, right) => left.name.localeCompare(right.name));
  if (new Set(ports.map(({ name }) => name)).size !== ports.length) fail("public circuit repeats a port name");
  if (!exact(source.behavior, ["factors"]) || !Array.isArray(source.behavior.factors)) fail("public circuit behavior is invalid");
  const byName = new Map(ports.map((port) => [port.name, port]));
  const factors = source.behavior.factors.map((factor) => {
    if (!exact(factor, ["inputs", "outputs", "rows"]) || !Array.isArray(factor.inputs) || !Array.isArray(factor.outputs) || !Array.isArray(factor.rows)) fail("public circuit behavior factor is invalid");
    if (factor.inputs.some((name) => byName.get(name)?.direction !== "input") || factor.outputs.some((name) => byName.get(name)?.direction !== "output")) fail("public circuit behavior factor names the wrong pin direction");
    if (factor.rows.length !== 4 ** factor.inputs.length) fail("public circuit behavior factor is incomplete");
    for (const row of factor.rows) if (!exact(row, ["input", "output"]) || !Array.isArray(row.input) || row.input.length !== factor.inputs.length || !row.input.every(four) || !Array.isArray(row.output) || row.output.length !== factor.outputs.length || !row.output.every(four)) fail("public circuit behavior row is invalid");
    return structuredClone(factor);
  });
  return Object.freeze({ profile: source.profile, law: source.law, ports: Object.freeze(ports), instances: Object.freeze([]), nets: Object.freeze([]), behavior: Object.freeze({ factors: Object.freeze(factors) }) });
}

export function circuitInterfaceFromAgentCard(card) {
  const matches = card?.capabilities?.extensions?.filter(({ uri }) => uri === SOVEREIGN_CIRCUIT_INTERFACE_EXTENSION) ?? [];
  if (matches.length !== 1) fail("Agent Card must declare exactly one sovereign circuit interface extension");
  const params = matches[0].params;
  if (!exact(params, ["account", "authority", "component", "custody", "profile", "territory"]) || params.profile !== SOVEREIGN_CIRCUIT_INTERFACE_PROFILE) fail("Agent Card sovereign circuit interface params are invalid");
  if (!CAIP10.test(params.account ?? "")) fail("Agent Card sovereign circuit interface account is not CAIP-10");
  if (!isCanonicalSha256NiUri(params.authority) || !isCanonicalSha256NiUri(params.custody) || !isCanonicalSha256NiUri(params.territory)) fail("Agent Card sovereign circuit interface authorities are not NI URIs");
  return Object.freeze({ account: params.account.toLowerCase(), authority: params.authority, custody: params.custody, territory: params.territory, component: normalizeLeaf(params.component) });
}
