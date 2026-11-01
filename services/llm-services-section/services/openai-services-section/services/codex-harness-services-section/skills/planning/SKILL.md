---
name: planning
description: "Turn RequirementK and AnalysisK into a bounded ActuationPlanK: use source-grounded models, uncertainty, and falsification needs to choose the next repair move; never collapse an analysis artifact or generated code into execution."
---

# Plan Codex office work

Plan consumes the requirement and AnalysisK. It converts what was learned into
one smallest accountable next move; it does not ask a research supplier to
write the change.

1. Separate `settled evidence` from `model-derived hypothesis`. A plan may
   act directly on the former. For the latter, first name the cheapest
   observation or assay that would decide it.
2. Make each candidate move explicit: target boundary, precondition, intended
   external effect, receipt or verification expected, refusal condition, and
   rollback/containment where the effect is non-chain-native.
3. Prefer plans that improve the next MAPE-K cycle: emit a reusable table,
   parser, schema, source selector, or observer when it eliminates recurring
   rediscovery. Do not create a new harness merely to summarize this turn.
4. Treat NotebookLM CSV/JSON/Python artifacts as planning inputs. A Python
   artifact may be independently assayed as an analytical instrument in a
   bounded environment, but it is never a candidate repository patch and
   never crosses into Execute without a separately chosen implementation
   decision.
5. Produce ActuationPlanK with `authority`, `evidence`, `assumptions`,
   `selected move`, `verification`, `refusal/rollback`, and `next Monitor
   question`. When no candidate has settled authority, return the missing
   decision or observation rather than filling it with generated code.

In emergency repair mode, planning is short and non-bureaucratic: it must not
delay an evidenced repair, but it must preserve the distinction between
learning a system and changing it.

Outside emergency repair, purchased inference and design tiers are useful
tools, not jurisdictional vetoes. Preserve credentials. Keep only artifacts
that improve future execution; supersede process artifacts whose sole effect
is to block repair.
