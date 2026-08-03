---
name: contract-cheapest-inference
description: Route bounded language-model work through the Logical Inference Service Section's verified, registry-priced inference fabric before spending interactive Codex inference on it. Use for classification, extraction, summarization, inquiry, code review, candidate generation, repeated text transformations, parallel reviews, and any larger task with text-only subproblems that can be supplied finite context and checked without granting tools or mutation authority.
---

# Contract Cheapest Inference

## Leader interaction and time budget

Ordinary inference procurement **MUST NOT** open an escalation or approval
dialog. The Leader's attention is a scarcer resource than background settlement
time.

- Use the stable, already-approved dispatcher command shown below for Codex-
  initiated work. If sandbox policy denies access to the persistent Unix
  socket, fall back to this dispatcher; **do not** request escalated socket or
  network access.
- Treat a job with a durable unique ID, input record, and output destination as
  asynchronous by default. Start it, retain its execution/session identifier,
  and continue independent work. Do not poll or narrate its elapsed wall time.
- Wait for or poll a result only when the next authorized action genuinely
  depends on that result. A long provider settlement is not itself a delay or
  a defect.
- Host installation, user-service mutation, or other actions that cannot use an
  existing approval grant are separate administrative work. Defer and batch
  them; never smuggle their approval prompts into ordinary inference dispatch.

The stable Codex-side dispatcher prefix is:

```sh
node --env-file=/home/emsenn/info/.env \
  /home/emsenn/info/lib/emsenn/services/561-group/services/red-cup-engineering/services/logical-inference-service-section/src/dispatch-jsonl.mjs
```

Pass bounded `--input`, `--output`, `--registry`, and concurrency arguments to
that command. Other host clients may use the socket-activated service directly;
this fallback exists specifically to keep an interactive Codex sandbox from
charging approval dialogs to the Leader.

Treat interactive Codex, cloud providers, and private OpenAI-compatible workers as competing inference supplies. Buy verified resolution, not merely returned tokens.

## Decide what can leave Codex

Send a subproblem to the fabric when all are true:

- Supply all required context as finite messages without credentials or unrelated private data.
- Require no filesystem, shell, network, signing, human judgment, or target mutation by the model.
- State a bounded work type, difficulty, token ceiling, capabilities, and acceptance condition.
- Verify the result deterministically, or price an explicit semantic-review pass.

Keep tool-bearing and authority-bearing acts local. Decompose their text-only analysis, extraction, review, and candidate-generation portions and dispatch those portions.

## Dispatch

Use this settlement root:

`lib/emsenn/services/561-group/services/red-cup-engineering/services/logical-inference-service-section/`

1. Write unique JSONL jobs under the settlement's dated `data/fabric-runs/YYYY/MM/DD/` path. Include `id`, `messages`, `workType`, `requiredCapabilities`, `maxTokens`, and either explicit `difficulty` or enough bounded content for the heuristic.
2. Add `outputContract` for machine-checkable work. Prefer `{"format":"json","schema":...}`. Use exact `const`/`enum` constraints for deterministic classification and extraction; use bounded object schemas when exact text is inappropriate.
3. Dry-run the jobs through `src/dispatch-jsonl.mjs` with `content/config/inference-fabric-registry.json`. Inspect quote traces and refusals before live execution.
4. Run one live dispatcher from outside the settlement working directory with the Leader-provided environment file. Use one new output path, its automatic lock, bounded global concurrency, and bounded attempts. Never launch a second dispatcher or concurrent resume for the same output.
5. Inspect records as they append. A job settles only when the output contract passes. Treat `verificationFailure` as supplier failure and allow the quoted fallback path.
6. Use verified prior result files with `--history` when their work type and acceptance contract are comparable. Do not train success priors from uncontracted or known-flawed runs.

## Price resolution

Rank feasible suppliers by:

`expected resolution cost = (dispatch + inference + verification + scarcity + latency shadow) / p(verified success | endpoint, work type, difficulty)`

Require comparable cost units and capability closure. Let observed verification failures reduce the supplier's success estimate. Use interactive Codex only when no external offer is feasible, external verification would cost more than local completion, or the task carries tools/authority that cannot lawfully leave the session.

For semantic outputs that a JSON schema cannot judge, procure a separate review only when the risk justifies it. Do not label schema-valid prose semantically correct by default.

## Admit private workers

Before enabling a Tailscale, vLLM, Ollama, llama.cpp, or other OpenAI-compatible endpoint, run `src/probe-openai-endpoint.mjs` with its base URL supplied through an environment variable. Admit the emitted registry candidate only when `admitted` is true. Preserve its measured concurrency, latency, and verified-yield prior; never place keys or credential-bearing URLs in registry or result records.

## Witness

The 2026-07-18 benchmark is the bad-incumbent test: uncontracted output delivered 94.04 jobs/minute but only 2/12 strict JSON results; the rectified path delivered 12/12 schema-verified results, automatically rerouted two bad attempts, and settled at 74.10 verified jobs/minute. Optimize the latter measure.
