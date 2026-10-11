import { providerConfiguration, runProviderExchange } from "../openai/provider-runtime.mjs";

export const CONTEXT_PACKET_JUDGMENT_CRITERIA = Object.freeze([
  "self-containment",
  "machine-checkable-goal-conditions",
  "lane-boundaries",
  "resolvable-citations",
  "output-contract",
]);

const FALLBACK_LABEL = "untitled-packet";

function nonempty(value, label) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${label} must be a nonempty string`);
  return value;
}

function nonemptyPacket(packet) {
  if (packet === null || packet === undefined) throw new TypeError("context packet must be a nonempty JSON value");
  if (typeof packet === "string" && packet.trim() === "") throw new TypeError("context packet must be a nonempty JSON value");
  if (Array.isArray(packet) && packet.length === 0) throw new TypeError("context packet must be a nonempty JSON value");
  if (typeof packet === "object" && !Array.isArray(packet) && Object.keys(packet).length === 0) throw new TypeError("context packet must be a nonempty JSON value");
  return packet;
}

export function contextPacketLabel(packet, label) {
  if (label !== undefined) return nonempty(label, "label");
  if (packet && typeof packet === "object" && !Array.isArray(packet)) {
    for (const key of ["id", "name", "slug"]) if (typeof packet[key] === "string" && packet[key].trim() !== "") return packet[key];
  }
  return FALLBACK_LABEL;
}

export function contextPacketVerdictBand(total) {
  if (total >= 8) return "strong";
  if (total >= 4) return "adequate";
  return "deficient";
}

function extractJsonObject(text) {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/u.exec(text);
  const candidate = fenced ? fenced[1] : text;
  const first = candidate.indexOf("{");
  const last = candidate.lastIndexOf("}");
  if (first < 0 || last < first) return { error: "no JSON object found in the model response" };
  try { return { value: JSON.parse(candidate.slice(first, last + 1)) }; }
  catch (error) { return { error: `model response is not parseable JSON: ${error.message}` }; }
}

function exactKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

export function contextPacketVerdictDraftErrors(value) {
  const errors = [];
  if (!exactKeys(value, ["criteria"])) return ["response must contain exactly one criteria object"];
  if (!exactKeys(value.criteria, CONTEXT_PACKET_JUDGMENT_CRITERIA)) return ["criteria must contain exactly the five context-packet criteria"];
  for (const key of CONTEXT_PACKET_JUDGMENT_CRITERIA) {
    const criterion = value.criteria[key];
    if (!exactKeys(criterion, ["score", "reason"])) { errors.push(`${key} must contain exactly score and reason`); continue; }
    if (!Number.isInteger(criterion.score) || criterion.score < 0 || criterion.score > 2) errors.push(`${key}.score must be 0, 1, or 2`);
    if (typeof criterion.reason !== "string" || criterion.reason.length === 0 || criterion.reason.length > 240) errors.push(`${key}.reason must be 1..240 characters`);
  }
  return errors;
}

function judgmentInstruction() {
  return [
    "Judge the supplied context packet against exactly five criteria.",
    "Each score is 0, 1, or 2: 2 fully meets the criterion, 1 partially meets it, and 0 does not meet it.",
    "Reasons must be one concise sentence of at most 240 characters.",
    "Criteria: self-containment; machine-checkable-goal-conditions; lane-boundaries; resolvable-citations; output-contract.",
    'Return only JSON: {"criteria": {criterion: {"score": 0, "reason": "..."}, ...}}.',
    "Do not add total, verdict, commentary, or markdown; the engine computes those from valid criteria.",
  ].join("\n");
}

function repairInstruction(errors) {
  return [
    "The preceding response was invalid:",
    ...errors.map((error) => `- ${error}`),
    "Return only a corrected JSON object with exactly the required criteria object.",
  ].join("\n");
}

function assembleVerdict(label, draft) {
  const total = CONTEXT_PACKET_JUDGMENT_CRITERIA.reduce((sum, key) => sum + draft.criteria[key].score, 0);
  const criteria = Object.freeze(Object.fromEntries(CONTEXT_PACKET_JUDGMENT_CRITERIA.map((key) => [key, Object.freeze({ ...draft.criteria[key] })])));
  return Object.freeze({ "packet-label": label, criteria, total, verdict: contextPacketVerdictBand(total) });
}

/**
 * Judge one nonempty JSON context carrier through the inference engine's provider
 * runtime. The model supplies only criterion observations; the engine computes
 * the label, total, and band, and retries only malformed responses up to fuel.
 */
export async function judgeContextPacket(packet, {
  provider = "nvidia-nim",
  model,
  label,
  fuel = 3,
  resourceRoot,
  env,
  request,
  signal,
} = {}) {
  nonemptyPacket(packet);
  if (!Number.isInteger(fuel) || fuel < 1 || fuel > 3) throw new TypeError("fuel must be an integer from 1 through 3");
  const row = providerConfiguration(provider);
  const resolvedModel = model ?? row.defaultModel;
  nonempty(resolvedModel, "model");
  const resolvedLabel = contextPacketLabel(packet, label);
  const messages = [
    { role: "system", content: judgmentInstruction() },
    { role: "user", content: JSON.stringify(packet, null, 2) },
  ];
  const attempts = [];

  for (let attempt = 1; attempt <= fuel; attempt += 1) {
    const exchange = await runProviderExchange(row, {
      model: resolvedModel,
      messages,
      "max-tokens": 400,
      params: { temperature: 0.1 },
    }, { resourceRoot, ...(env === undefined ? {} : { env }), ...(request === undefined ? {} : { request }), ...(signal === undefined ? {} : { signal }) });
    if (exchange.outcome === "refusal") {
      attempts.push(Object.freeze({ attempt, valid: false, errors: Object.freeze([exchange.refusal.grounds]) }));
      return Object.freeze({ outcome: "refusal", reason: "provider-refusal", "packet-label": resolvedLabel, provider: row.providerId, model: resolvedModel, fuel: Object.freeze({ cap: fuel, spent: attempts.length }), attempts: Object.freeze(attempts) });
    }
    const raw = exchange.completion.text;
    const parsed = extractJsonObject(raw);
    const errors = parsed.error ? [parsed.error] : contextPacketVerdictDraftErrors(parsed.value);
    attempts.push(Object.freeze({ attempt, valid: errors.length === 0, errors: Object.freeze(errors) }));
    if (errors.length === 0) {
      return Object.freeze({ outcome: "judgment", verdict: assembleVerdict(resolvedLabel, parsed.value), provider: row.providerId, model: resolvedModel, fuel: Object.freeze({ cap: fuel, spent: attempts.length }), "first-attempt-valid": attempt === 1, attempts: Object.freeze(attempts) });
    }
    messages.push({ role: "assistant", content: raw });
    messages.push({ role: "user", content: repairInstruction(errors) });
  }
  return Object.freeze({ outcome: "refusal", reason: "invalid-model-verdict", "packet-label": resolvedLabel, provider: row.providerId, model: resolvedModel, fuel: Object.freeze({ cap: fuel, spent: attempts.length }), attempts: Object.freeze(attempts) });
}
