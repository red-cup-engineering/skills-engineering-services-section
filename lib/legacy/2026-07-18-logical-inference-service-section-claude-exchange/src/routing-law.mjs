export const TIER_ORDER = Object.freeze(["free-groq", "free-nim", "leader-claude"]);
export const TIER_CATALOG = Object.freeze({
  "free-groq": Object.freeze({ provider: "groq-inference-team", requestType: "GroqInferenceRequest", effects: Object.freeze(["external-network", "groq-inference-account"]), defaultModel: "llama-3.1-8b-instant" }),
  "free-nim": Object.freeze({ provider: "nvidia-inference-team", requestType: "NvidiaInferenceRequest", effects: Object.freeze(["external-network", "nvidia-inference-account"]), defaultModel: "meta/llama-3.1-8b-instruct" }),
  "leader-claude": Object.freeze({ provider: "claude-code-inference-team", requestType: "ClaudeCodeInferenceRequest", effects: Object.freeze(["external-network", "leader-inference-account"]), defaultModel: "claude-sonnet-4-6" })
});

export function validateRoutedRequest(request) {
  const problems = [];
  if (!request || typeof request !== "object" || Array.isArray(request)) return ["request"];
  if (!Array.isArray(request.messages) || request.messages.length === 0) problems.push("messages");
  else for (const [index, message] of request.messages.entries()) if (!message || !["system", "user", "assistant"].includes(message.role) || typeof message.content !== "string" || message.content.length === 0) problems.push(`messages[${index}]`);
  if (!Array.isArray(request.admissibleTiers) || request.admissibleTiers.length === 0 || request.admissibleTiers.some((tier) => !(tier in TIER_CATALOG))) problems.push("admissibleTiers");
  else {
    const indices = request.admissibleTiers.map((tier) => TIER_ORDER.indexOf(tier));
    if (new Set(request.admissibleTiers).size !== request.admissibleTiers.length || indices.some((value, index) => index > 0 && value <= indices[index - 1])) problems.push("admissibleTiers(strict forward order)");
  }
  if (request.models !== undefined && (!request.models || typeof request.models !== "object" || Array.isArray(request.models))) problems.push("models");
  else for (const [tier, model] of Object.entries(request.models ?? {})) if (!(tier in TIER_CATALOG) || typeof model !== "string" || model.length === 0) problems.push(`models.${tier}`);
  if (!Array.isArray(request.sufficiency) || request.sufficiency.length === 0) problems.push("sufficiency");
  else for (const [index, predicate] of request.sufficiency.entries()) {
    if (!predicate || !["min-chars", "max-chars", "contains", "json-object", "json-object-envelope"].includes(predicate.type)) problems.push(`sufficiency[${index}].type`);
    else if (["min-chars", "max-chars"].includes(predicate.type) && (!Number.isInteger(predicate.value) || predicate.value < 0)) problems.push(`sufficiency[${index}].value`);
    else if (predicate.type === "contains" && (typeof predicate.value !== "string" || predicate.value.length === 0)) problems.push(`sufficiency[${index}].value`);
  }
  if (request.maxTokens !== undefined && (!Number.isInteger(request.maxTokens) || request.maxTokens < 1)) problems.push("maxTokens");
  if (!['dry-run', 'live'].includes(request.executionMode ?? "live")) problems.push("executionMode(dry-run|live)");
  if (request.outputSchema !== undefined) {
    if (!request.outputSchema || typeof request.outputSchema !== "object" || Array.isArray(request.outputSchema)) problems.push("outputSchema");
    else if (Buffer.byteLength(JSON.stringify(request.outputSchema), "utf8") > 32_768) problems.push("outputSchema(max-32768-bytes)");
    if (Array.isArray(request.admissibleTiers) && request.admissibleTiers.some((tier) => tier !== "leader-claude")) problems.push("outputSchema(leader-claude-only)");
  }
  const c = request.marketConstraints;
  if (c !== undefined) {
    if (!c || typeof c !== "object" || Array.isArray(c)) problems.push("marketConstraints");
    else {
      if (c.requiredAvailability !== undefined && !["locally-admissible"].includes(c.requiredAvailability)) problems.push("marketConstraints.requiredAvailability");
      for (const [field, values] of [["allowedConsiderationDenominations", c.allowedConsiderationDenominations], ["requiredQualityEvidenceKinds", c.requiredQualityEvidenceKinds]]) if (values !== undefined && (!Array.isArray(values) || values.length === 0 || values.length > 16 || new Set(values).size !== values.length || values.some((v) => typeof v !== "string" || v.length === 0 || v.length > 128))) problems.push(`marketConstraints.${field}`);
      if (c.maxConsiderationPerRequest !== undefined && (!Number.isFinite(c.maxConsiderationPerRequest) || c.maxConsiderationPerRequest < 0 || !Array.isArray(c.allowedConsiderationDenominations) || c.allowedConsiderationDenominations.length === 0)) problems.push("marketConstraints.maxConsiderationPerRequest");
      if (c.minimumRemainingCapacity !== undefined && (!Number.isInteger(c.minimumRemainingCapacity) || c.minimumRemainingCapacity < 0)) problems.push("marketConstraints.minimumRemainingCapacity");
    }
  }
  return [...new Set(problems)];
}

export function validateInferenceServiceBid(step, bid) {
  const problems = []; if (!bid || bid.type !== "InferenceServiceBid") return ["bid.type"];
  if (bid.provider !== `urn:ame:${step.provider}`) problems.push("bid.provider"); if (bid.model !== step.model) problems.push("bid.model"); if (typeof bid.requestScopeDigest !== "string" || !bid.requestScopeDigest.startsWith("sha256:")) problems.push("bid.requestScopeDigest");
  if (!["locally-admissible", "unavailable", "unknown"].includes(bid.availability)) problems.push("bid.availability");
  if (!bid.capacity || typeof bid.capacity.unit !== "string" || !["unknown"].includes(bid.capacity.remaining) || !["unknown"].includes(bid.capacity.period)) problems.push("bid.capacity");
  if (!bid.consideration || !["unknown"].includes(bid.consideration.denomination) || !["unknown"].includes(bid.consideration.maxPerRequest) || !["unknown"].includes(bid.consideration.monetary)) problems.push("bid.consideration");
  if (!bid.qualityEvidence || typeof bid.qualityEvidence.kind !== "string" || !["unknown"].includes(bid.qualityEvidence.reference)) problems.push("bid.qualityEvidence"); return problems;
}
export function evaluateBidCompatibility(bid, constraints = {}) {
  const reasons = []; if (bid.availability === "unavailable") reasons.push("availability:unavailable"); if (constraints.requiredAvailability && bid.availability !== constraints.requiredAvailability) reasons.push("availability:incompatible-or-unknown");
  if (constraints.allowedConsiderationDenominations && !constraints.allowedConsiderationDenominations.includes(bid.consideration.denomination)) reasons.push("considerationDenomination:unknown-or-disallowed"); if (constraints.maxConsiderationPerRequest !== undefined && typeof bid.consideration.maxPerRequest !== "number") reasons.push("consideration:max-unknown"); if (constraints.minimumRemainingCapacity !== undefined && typeof bid.capacity.remaining !== "number") reasons.push("capacity:remaining-unknown"); if (constraints.requiredQualityEvidenceKinds && !constraints.requiredQualityEvidenceKinds.includes(bid.qualityEvidence.kind)) reasons.push("qualityEvidence:incompatible-or-unknown"); return { compatible: reasons.length === 0, reasons };
}

export function evaluateSufficiency(text, predicates) {
  return predicates.map((predicate) => {
    if (predicate.type === "min-chars") return { predicate, satisfied: typeof text === "string" && text.length >= predicate.value };
    if (predicate.type === "max-chars") return { predicate, satisfied: typeof text === "string" && text.length <= predicate.value };
    if (predicate.type === "contains") {
      const haystack = predicate.caseSensitive === true ? text : text.toLowerCase(); const needle = predicate.caseSensitive === true ? predicate.value : predicate.value.toLowerCase();
      return { predicate, satisfied: typeof text === "string" && haystack.includes(needle) };
    }
    if (predicate.type === "json-object") { try { const value = JSON.parse(text); return { predicate, satisfied: value !== null && typeof value === "object" && !Array.isArray(value) }; } catch { return { predicate, satisfied: false }; } }
    if (predicate.type === "json-object-envelope") { try { const value = JSON.parse(jsonObjectEnvelope(text)); return { predicate, satisfied: value !== null && typeof value === "object" && !Array.isArray(value) }; } catch { return { predicate, satisfied: false }; } }
    return { predicate, satisfied: false };
  });
}

/** Admit exactly a naked JSON value or one conventional outer Markdown JSON fence. */
export function jsonObjectEnvelope(text) {
  if (typeof text !== "string") throw new TypeError("JSON object envelope must be text");
  const trimmed = text.trim();
  const fenced = /^```json\s*\n([\s\S]*?)\n```$/i.exec(trimmed);
  return fenced === null ? trimmed : fenced[1].trim();
}

export function routeEffects(request) {
  return [...new Set(request.admissibleTiers.flatMap((tier) => TIER_CATALOG[tier].effects))].sort();
}

export function routePlan(request) {
  return request.admissibleTiers.map((tier, index) => ({ index, tier, provider: TIER_CATALOG[tier].provider, model: request.models?.[tier] ?? TIER_CATALOG[tier].defaultModel, effects: [...TIER_CATALOG[tier].effects] }));
}
