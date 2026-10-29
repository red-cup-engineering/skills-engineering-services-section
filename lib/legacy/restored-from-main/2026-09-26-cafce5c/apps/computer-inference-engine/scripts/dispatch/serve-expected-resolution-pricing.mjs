#!/usr/bin/env node
import { createHttpServer } from "@red-cup-engineering/http-services-section/node-server";
// Serves the /rank and /observe endpoints expected-resolution-pricing-client.mjs
// calls. Until this ran, EXPECTED_RESOLUTION_PRICE_URL had no live implementation
// anywhere in the repo, so typed-inference-procurement.mjs's price-aware
// selection path (selectTypedInferenceOfferByExpectedResolution) was reachable
// code with nothing to reach: procureTypedInference only takes it when a
// pricingService endpoint is configured, and it always fell back to plain
// declared-amount Pareto-dominance. Point EXPECTED_RESOLUTION_PRICE_URL at this
// server's baseUrl to make cost-aware, reliability-weighted provider selection
// real instead of theoretical.
//
// Usage: node scripts/serve-expected-resolution-pricing.mjs [--port 8799] [--data-root <dir>]


import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { appendDelivery, appendObservation, appendProviderRefusal, loadObservations, rankOffers } from "../../src/dispatch/expected-resolution-pricing.mjs";

function respond(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

// Reopens the observation store on every /rank call rather than caching it in
// memory: this process runs as one long-lived daemon across many unrelated
// ranking calls, and ranking must sharpen as /observe lands real outcomes.
export function createExpectedResolutionPricingServer({ dataRoot } = {}) {
  return createHttpServer({ handle: (req, res) => {
    const requestUrl = new URL(req.url, "http://localhost");
    if (req.method === "GET" && requestUrl.pathname === "/health") {
      respond(res, 200, { ok: true, service: "expected-resolution-pricing", profile: "org.emsenn.expected-resolution-pricing.v1" });
      return;
    }
    if (req.method === "GET" && requestUrl.pathname === "/observations") {
      try {
        const taskClass = requestUrl.searchParams.get("taskClass");
        const offers = JSON.parse(requestUrl.searchParams.get("offers") ?? "[]");
        const limit = Number(requestUrl.searchParams.get("limit") ?? "64");
        const cursorText = requestUrl.searchParams.get("cursor");
        const cursor = cursorText === null ? 0 : (/^\d+$/u.test(cursorText) ? Number(cursorText) : NaN);
        if (typeof taskClass !== "string" || taskClass.trim() === "" || !Array.isArray(offers) || offers.length === 0 || offers.length > 32 || offers.some((offer) => !offer || typeof offer.offerId !== "string" || typeof offer.configurationIdentity !== "string") || !Number.isSafeInteger(limit) || limit < 1 || limit > 128 || !Number.isSafeInteger(cursor) || cursor < 0) throw new Error("taskClass, 1..32 exact offers, limit 1..128, and an opaque numeric cursor are required");
        const requested = new Map(offers.map((offer) => [offer.offerId, offer.configurationIdentity]));
        if (requested.size !== offers.length) throw new Error("requested offers must be unique");
        const matched = loadObservations({ dataRoot })
          .filter((item) => item.kind === "receiver-outcome" && item.taskClass === taskClass && requested.has(item.selectedOffer) && requested.get(item.selectedOffer) === item.configurationIdentity)
          .map((item) => ({ type: "WorkPlacementObservation", kind: "attempt", receipt: item.id, offerId: item.selectedOffer, configurationIdentity: item.configurationIdentity, taskClass: item.taskClass, outcome: item.outcome, ...(Number.isSafeInteger(item.durationMs) ? { latency: { unit: "millisecond", amount: { numerator: String(item.durationMs), denominator: "1" } } } : {}), ...(item.resources ? { resources: item.resources } : {}) }));
        const observations = matched.slice(cursor, cursor + limit);
        respond(res, 200, { ok: true, observations, matchedCount: matched.length, nextCursor: cursor + observations.length < matched.length ? String(cursor + observations.length) : null });
      } catch (error) {
        respond(res, 422, { ok: false, refusal: { code: "request-refused", reason: error.message } });
      }
      return;
    }
    if (req.method !== "POST" || !["/rank", "/deliver", "/observe", "/refuse"].includes(req.url)) {
      respond(res, 404, { ok: false, refusal: { code: "no-such-route" } });
      return;
    }
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      let payload;
      try {
        payload = JSON.parse(body || "{}");
      } catch (error) {
        respond(res, 400, { ok: false, refusal: { code: "malformed-json", reason: error.message } });
        return;
      }
      try {
        if (req.url === "/rank") {
          const ranked = rankOffers(payload.taskClass, payload.offers, loadObservations({ dataRoot }));
          respond(res, 200, { ok: true, result: { ranked } });
        } else if (req.url === "/deliver") {
          const delivery = appendDelivery(payload, { dataRoot });
          respond(res, 200, { ok: true, delivery });
        } else if (req.url === "/observe") {
          const observation = appendObservation(payload, { dataRoot });
          respond(res, 200, { ok: true, observation });
        } else {
          const refusal = appendProviderRefusal(payload, { dataRoot });
          respond(res, 200, { ok: true, refusal });
        }
      } catch (error) {
        respond(res, 422, { ok: false, refusal: { code: "request-refused", reason: error.message } });
      }
    });
  } });
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const flag = (name, fallback) => {
    const at = args.indexOf(`--${name}`);
    return at === -1 ? fallback : args[at + 1];
  };
  const port = Number(flag("port", process.env.PORT ?? "8799"));
  const dataRoot = flag("data-root", process.env.EXPECTED_RESOLUTION_DATA_ROOT);
  const server = createExpectedResolutionPricingServer({ dataRoot });
  server.listen(port, "127.0.0.1", () => {
    process.stdout.write(`expected-resolution-pricing listening on http://127.0.0.1:${server.address().port}\n`);
  });
}
