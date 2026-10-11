/** Process cache of provider liveness and quota readings. */
const readings = new Map();

const integerHeader = (headers, names) => {
  for (const name of names) {
    const value = headers?.get?.(name);
    if (typeof value === "string" && /^\d+$/u.test(value.trim())) return Number(value);
  }
  return null;
};

const quotaWindow = (headers, { resource, unit, observedAt, limitHeaders, remainingHeaders, resetHeaders }) => {
  const remaining = integerHeader(headers, remainingHeaders);
  if (remaining === null) return null;
  const limit = integerHeader(headers, limitHeaders);
  return Object.freeze({
    resource,
    unit,
    ...(limit === null ? {} : { limit }),
    remaining,
    resetsAt: instantHeader(headers, resetHeaders, observedAt),
  });
};

/** Read independent provider-authored request and token windows from one HTTP response. */
export function providerQuotaWindows(response, observedAt) {
  const headers = response?.headers;
  if (!headers || typeof observedAt !== "string") return Object.freeze([]);
  return Object.freeze([
    quotaWindow(headers, { resource: "requests", unit: "request", observedAt,
      limitHeaders: ["x-ratelimit-limit-requests"], remainingHeaders: ["x-ratelimit-remaining-requests"], resetHeaders: ["x-ratelimit-reset-requests"] }),
    quotaWindow(headers, { resource: "tokens", unit: "token", observedAt,
      limitHeaders: ["x-ratelimit-limit-tokens"], remainingHeaders: ["x-ratelimit-remaining-tokens"], resetHeaders: ["x-ratelimit-reset-tokens"] }),
  ].filter(Boolean));
}

/** The provider's remaining-request reading, when it actually supplied one. */
export const providerRemainingRequests = (response) => integerHeader(response?.headers, ["x-ratelimit-remaining-requests", "ratelimit-remaining", "x-ratelimit-remaining"]);

const durationMilliseconds = (value) => {
  if (!/^(?:(?:\d+(?:\.\d+)?)h)?(?:(?:\d+(?:\.\d+)?)m)?(?:(?:\d+(?:\.\d+)?)s)?$/u.test(value) || value === "") return null;
  const parts = [...value.matchAll(/(\d+(?:\.\d+)?)([hms])/gu)];
  if (parts.length === 0) return null;
  return parts.reduce((total, [, amount, unit]) => total + Number(amount) * ({ h: 3_600_000, m: 60_000, s: 1_000 }[unit]), 0);
};

const instantHeader = (headers, names, observedAt) => {
  for (const name of names) {
    const value = headers?.get?.(name);
    if (typeof value !== "string" || value.trim() === "") continue;
    if (/^\d+$/u.test(value.trim())) {
      const amount = Number(value);
      const epoch = name === "retry-after" || amount < 315_360_000
        ? Date.parse(observedAt) + amount * 1000
        : amount * 1000;
      return new Date(epoch).toISOString();
    }
    if (name.startsWith("x-ratelimit-reset-")) {
      const duration = durationMilliseconds(value.trim());
      if (duration !== null) return new Date(Date.parse(observedAt) + duration).toISOString();
    }
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return null;
};

function reading(providerIdentity, update, observedAt, identity = providerIdentity) {
  const prior = readings.get(identity);
  const supplied = (name, fallback) => Object.hasOwn(update, name) ? update[name] : fallback;
  const latest = (name) => Object.hasOwn(update, name) ? update[name] : prior?.[name];
  const status = latest("status");
  const reason = latest("reason");
  const next = Object.freeze({
    type: "InferenceProviderReading",
    providerIdentity,
    state: update.state ?? prior?.state ?? "alive",
    incarnation: (prior?.incarnation ?? 0) + 1,
    observedAt,
    lastHiredAt: supplied("lastHiredAt", prior?.lastHiredAt ?? null),
    backoffUntil: supplied("backoffUntil", prior?.backoffUntil ?? null),
    quota: Object.freeze({
      remaining: supplied("remaining", prior?.quota?.remaining ?? null),
      renewsAt: supplied("renewsAt", prior?.quota?.renewsAt ?? null),
      windows: Object.freeze(supplied("windows", prior?.quota?.windows ?? []).map((window) => Object.freeze({ ...window }))),
    }),
    ...(status === undefined || status === null ? {} : { status }),
    ...(reason === undefined || reason === null ? {} : { reason }),
  });
  readings.set(identity, next);
  return next;
}

/** Record provider-authored rate-limit headers and witnessed HTTP status. */
export function observeProviderAvailability(provider, response, { now = () => new Date().toISOString(), identity = provider } = {}) {
  if (typeof provider !== "string" || provider.trim() === "" || !response || typeof response.status !== "number") return null;
  const observedAt = now();
  const remaining = providerRemainingRequests(response);
  const renewsAt = instantHeader(response.headers, ["retry-after", "x-ratelimit-reset-requests", "ratelimit-reset"], observedAt);
  const windows = providerQuotaWindows(response, observedAt);
  const exhaustedWindows = windows.filter((window) => window.remaining === 0);
  const exhausted = response.status === 429 || remaining === 0 || exhaustedWindows.length > 0;
  const windowBackoff = exhaustedWindows.map(({ resetsAt }) => Date.parse(resetsAt ?? "")).filter(Number.isFinite);
  const backoffUntil = response.ok === true && !exhausted ? null
    : windowBackoff.length ? new Date(Math.max(...windowBackoff)).toISOString()
      : renewsAt ?? new Date(Date.parse(observedAt) + 30_000).toISOString();
  return reading(provider, {
    state: response.ok === true && !exhausted ? "alive" : "suspect",
    status: response.status,
    reason: response.ok === true ? null : response.status === 429 ? "provider-rate-limited" : "provider-http-response-failed",
    // A successful response without quota headers proves reachability, not
    // that a previously exhausted window still has zero requests.
    ...(remaining === null && response.ok !== true ? {} : { remaining }),
    // A fresh rate limit without a reset header does not inherit a previous
    // window's deadline. Its zero balance is only valid during backoff.
    ...(exhausted || response.ok === true ? { renewsAt } : renewsAt === null ? {} : { renewsAt }),
    ...(windows.length ? { windows } : {}),
    backoffUntil,
    ...(response.status === 429 ? { remaining: 0 } : {}),
  }, observedAt, identity);
}

/** A refusal never removes a provider: it becomes suspect until its backoff. */
export function observeProviderObstruction(provider, { reason = "provider-refusal", renewsAt = null } = {}, { now = () => new Date().toISOString(), identity = provider } = {}) {
  const observedAt = now();
  return reading(provider, { state: "suspect", status: null, reason, backoffUntil: renewsAt ?? new Date(Date.parse(observedAt) + 30_000).toISOString() }, observedAt, identity);
}

export function observeProviderHired(provider, { remaining } = {}, { now = () => new Date().toISOString(), identity = provider } = {}) {
  const observedAt = now();
  const prior = readings.get(identity);
  const nextRemaining = remaining ?? (Number.isSafeInteger(prior?.quota?.remaining) ? Math.max(0, prior.quota.remaining - 1) : null);
  const exhausted = nextRemaining === 0;
  return reading(provider, { state: exhausted ? "suspect" : "alive", reason: null, lastHiredAt: observedAt,
    backoffUntil: exhausted ? prior?.quota?.renewsAt ?? prior?.backoffUntil ?? new Date(Date.parse(observedAt) + 30_000).toISOString() : null,
    remaining: nextRemaining }, observedAt, identity);
}

export function currentProviderAvailability(provider, { now = Date.now, identity = provider } = {}) {
  const at = Number(now());
  const value = readings.get(identity);
  if (value === undefined) return undefined;
  const renewed = value.quota.renewsAt !== null && Date.parse(value.quota.renewsAt) <= at;
  const windows = (value.quota.windows ?? []).filter((window) => window.resetsAt === null || Date.parse(window.resetsAt) > at);
  const windowsRenewed = windows.length !== (value.quota.windows ?? []).length;
  const exhaustedWindowResets = windows.filter((window) => window.remaining === 0 && window.resetsAt !== null)
    .map(({ resetsAt }) => Date.parse(resetsAt)).filter((reset) => reset > at);
  const quotaBlockedUntil = exhaustedWindowResets.length ? Math.max(...exhaustedWindowResets) : null;
  const quotaBlocked = quotaBlockedUntil !== null;
  const retryable = value.backoffUntil !== null && Date.parse(value.backoffUntil) <= at;
  if (!renewed && !retryable && !windowsRenewed && !quotaBlocked) return value;
  return reading(provider, {
    state: quotaBlocked ? "suspect" : retryable ? "alive" : value.state,
    ...(quotaBlocked ? { reason: "provider-quota-window-exhausted", backoffUntil: new Date(quotaBlockedUntil).toISOString() } : {}),
    ...(!quotaBlocked && retryable ? { status: null, reason: null } : {}),
    ...(!quotaBlocked ? { backoffUntil: retryable ? null : value.backoffUntil } : {}),
    remaining: renewed || (retryable && value.quota.remaining === 0 && value.quota.renewsAt === null)
      ? null : value.quota.remaining,
    renewsAt: renewed ? null : value.quota.renewsAt,
    windows,
  }, new Date(at).toISOString(), identity);
}

/** Restore a provider binding's witnessed HTTP or transport state. */
export function restoreProviderAvailability(provider, observation, { identity = provider } = {}) {
  if (!observation || observation.provider !== provider || !Number.isFinite(Date.parse(observation.observedAt))) return;
  const prior = readings.get(identity);
  if (prior && Date.parse(prior.observedAt) >= Date.parse(observation.observedAt)) return;
  const quota = observation.quota ?? {};
  reading(provider, { state: observation.state, status: observation.status, ...(observation.reason === undefined ? {} : { reason: observation.reason }),
    ...(observation.lastHiredAt === undefined ? {} : { lastHiredAt: observation.lastHiredAt }),
    remaining: Number.isSafeInteger(quota.remaining) ? quota.remaining : null,
    renewsAt: quota.renewsAt ?? null,
    ...(Array.isArray(quota.windows) ? { windows: quota.windows } : {}),
    backoffUntil: observation.backoffUntil ?? null }, observation.observedAt, identity);
}

/** Explicit membership/liveness observation, including authoritative death. */
export function observeProviderLiveness(provider, state, { now = () => new Date().toISOString() } = {}) {
  if (!new Set(["alive", "suspect", "dead"]).has(state)) throw new TypeError("provider liveness must be alive, suspect, or dead");
  return reading(provider, { state, ...(state === "alive" ? { status: null, reason: null, backoffUntil: null } : {}) }, now());
}

/** Snapshot suitable for node status surfaces; credentials never enter it. */
export function inferenceProviderReadings({ now = Date.now } = {}) {
  for (const [identity, value] of readings) currentProviderAvailability(value.providerIdentity, { now, identity });
  return Object.freeze([...readings.values()].map((value) => Object.freeze({ ...value, quota: Object.freeze({ ...value.quota }) })));
}

export function clearProviderAvailabilityObservations() { readings.clear(); }
