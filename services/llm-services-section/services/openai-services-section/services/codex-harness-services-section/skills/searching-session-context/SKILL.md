---
name: searching-session-context
description: Retrieve compact, exact prior Codex corrections from local rollouts before reasoning about a repeated, cross-session, harness, cost, or Morgan-correction issue.
---

# Recover Session Context

Before spending model context rediscovering a repeated issue, run the local
retriever with a short, concrete query made from the current demand:

```bash
CODEX_SESSIONS_ROOT=/home/emsenn/.codex/sessions node /home/emsenn/info/lib/emsenn/services/561-group/services/red-cup-engineering/services/software-services-section/services/inference-services-section/services/notebooklm-services-section/src/codex-session-context.mjs \
  --query "<current problem in 3-12 words>" \
  --max-bytes 18432
```

Read the returned prior user corrections and immediate outcomes before proposing
work. It is a local deterministic index: it has no model or NotebookLM cost.

If the bounded retrieval does not settle the question, use the disposable
network consultation with only current matching evidence and any explicitly
authorized transcript. Do not fall back to a pinned transcript corpus or paste
whole session logs into the model.

Never use this retrieval to override the current user request; it supplies
constraints and prior evidence only.

At the end of substantial work, write one bounded handoff instead of making
the next session reconstruct the work from a long transcript:

```bash
node /home/emsenn/info/lib/emsenn/services/561-group/services/red-cup-engineering/services/software-services-section/services/inference-services-section/services/notebooklm-services-section/src/codex-session-handoff.mjs \
  --demand "<demand>" --corrections "<binding corrections>" \
  --changed "<comma-separated paths>" --verification "<fresh result>" \
  --next "<one exact next action>"
```
