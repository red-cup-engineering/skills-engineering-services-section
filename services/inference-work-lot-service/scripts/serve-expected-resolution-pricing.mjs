#!/usr/bin/env node
// Serves the /rank and /observe endpoints expected-resolution-pricing-client.mjs
// calls. Until this ran, EXPECTED_RESOLUTION_PRICE_URL had no live implementation
// anywhere in the repo, so typed-rmn-inference-procurement.mjs's price-aware
// selection path (selectTypedInferenceOfferByExpectedResolution) was reachable
// code with nothing to reach: procureTypedInference only takes it when a
// pricingService endpoint is configured, and it always fell back to plain
// declared-amount Pareto-dominance. Point EXPECTED_RESOLUTION_PRICE_URL at this
// server's baseUrl to make cost-aware, reliability-weighted provider selection
// real instead of theoretical.
//
// Usage: node scripts/serve-expected-resolution-pricing.mjs [--port 8799] [--data-root <dir>]

import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { appendDelivery, appendObservation, appendProviderRefusal, loadObservations, rankOffers } from "../src/expected-resolution-pricing.mjs";

function respond(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

// Reopens the observation store on every /rank call rather than caching it in
// memory: this process runs as one long-lived daemon across many unrelated
// ranking calls, and ranking must sharpen as /observe lands real outcomes.
export function createExpectedResolutionPricingServer({ dataRoot } = {}) {
  return createServer((req, res) => {
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
  });
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
