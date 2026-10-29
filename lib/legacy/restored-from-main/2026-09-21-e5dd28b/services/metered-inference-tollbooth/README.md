# Metered inference tollbooth

One typed operation, sold by the call through the one market, market.
561.group (`@red-cup-engineering/market-561-group`, catalog entry `inference/meter-inference`, `POST /v1/inference`):

- `meterInference(body, env)` conforms the caller's RMN proposal through the hired conformance agent, dispatches exactly one A2A task to the provider Agent Card the caller names in the body, assays the resulting transition through the hired wit-transition agent, conforms the completion, and returns the ActivityStreams `Accept` or `Reject` body.
  A contract-level failure is a `Reject`, never a thrown error, because the market has already settled payment by the time it runs.
- `validateMeteredInferenceRequest(body)` refuses a malformed request before the market prices it.

The only configuration this package reads is the `env` argument the market projects from its deployment: `RMN_CONFORMANCE_AGENT` and `WIT_TRANSITION_ASSAY_AGENT`, the two hired agents' Agent Card URLs.
Payment, the facilitator, settlement, and the settlement witness are the market's; the tollbooth's own x402 transport, runtime-admission gate, systemd unit, CDP facilitator client, and witness journal were deleted on the Founder's 2026-09-11 one-market ruling, and its runtime-admission record is kept under the market app's `data/records/legacy/metered-inference-tollbooth/`.

`npm test` runs the request-admission and refusal tests; the live A2A round trip skips with its reason when the fixture agents cannot start on the host.
