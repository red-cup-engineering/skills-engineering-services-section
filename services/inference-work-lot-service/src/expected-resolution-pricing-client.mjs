function singleObligation(candidate) {
  const obligations = candidate.consideration?.obligations;
  if (!Array.isArray(obligations) || obligations.length !== 1) throw new Error("expected-resolution pricing requires one consideration obligation per feasible offer");
  return obligations[0];
}

async function post(endpoint, path, value) {
  const url = new URL(path, endpoint);
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(value),
    });
  } catch (error) {
    const cause = error?.cause;
    const transport = [cause?.code ?? error?.code, cause?.address, cause?.port].filter((entry) => entry !== undefined).join(":");
    throw new Error(`pricing service transport obstructed ${path} at ${url.href}${transport ? ` (${transport})` : ""}: ${error?.message ?? String(error)}`, { cause: error });
  }
  const result = await response.json();
  if (!response.ok || result.ok !== true) throw new Error(`pricing service refused ${path}: ${result.refusal?.code ?? response.status}`);
  return result;
}

export async function rankInferenceCandidates(endpoint, taskClass, candidates) {
  const offers = candidates.map((candidate) => {
    const obligation = singleObligation(candidate);
    return {
      provider: candidate.entry.provider.actor,
      consideration: {
        kind: obligation.kind,
        asset: obligation.asset,
        unit: obligation.unit,
        amount: obligation.amount,
      },
    };
  });
  const response = await post(endpoint, "/rank", { taskClass, offers });
  const byProvider = new Map(candidates.map((candidate) => [candidate.entry.provider.actor, candidate]));
  return response.result.ranked.map((price) => ({ ...byProvider.get(price.provider), expectedResolutionPrice: price }));
}

export async function observeInferenceOutcome(endpoint, observation) {
  return (await post(endpoint, "/observe", observation)).observation;
}

export async function registerInferenceDelivery(endpoint, delivery) {
  return (await post(endpoint, "/deliver", delivery)).delivery;
}

export async function observeInferenceRefusal(endpoint, refusal) {
  return (await post(endpoint, "/refuse", refusal)).refusal;
}
