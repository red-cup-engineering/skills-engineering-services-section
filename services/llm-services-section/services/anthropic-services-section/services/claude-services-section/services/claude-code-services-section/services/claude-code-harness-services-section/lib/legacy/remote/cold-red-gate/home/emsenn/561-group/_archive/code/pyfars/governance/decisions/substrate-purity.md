---
title: "Substrate purity"
type: decision
status: committed
date: "2026-05-07"
theory-basis: [enterprise, charter-as-closure-system, normative-operational-layering]
---

# Substrate purity

## What

PyFARS is a substrate.
Interface concerns — CLI ergonomics, web UI features, harness-specific accommodations — are secondary to substrate correctness.
When a substrate operation and an interface convenience conflict, the substrate operation wins.

## Why

Hard-core commitments C1 (predication-substrate-commitment) and C3 (agential-self-generation) require that the substrate's mathematical integrity come first.
C1 says the storage primitive is the four-valued bilattice predication cell and that every substrate operation respects that structure.
C3 says that every operative element is a substrate entity — hardcoded configuration that cannot be derived from substrate records is structural debt.

An interface-first design inverts this priority.
Interface concerns (what's convenient for a human to type, what's easy to display in OpenClaw) produce pressure to add short-circuit paths that bypass the substrate's proper operations.
Each such bypass is a violation of C1 or C3.
The correct response to interface needs is to build the interface on top of clean substrate APIs, not to reach into the substrate and add interface-shaped primitives.

Per `normative-operational-layering`, the substrate is the *operations base* on which both the normative layer (governance records, office authority) and the operational layer (dispatch, execution) run.
An impure substrate corrupts both layers simultaneously.

## Rules out

- Adding substrate operations whose primary motivation is interface convenience rather than predication-substrate correctness.
- Building PyFARS as an OpenClaw-first system at the substrate level.
  G1 (OpenClaw-first) is a guidelines-tier decision about interface priority; it does not override C1 at the substrate level.
  Interface-facing features belong in harnesses.
- Hardcoded CLI behaviors that require changing the substrate API to remove.
- Functions that write interface-formatted files as if they were substrate operations.
  The earlier `cli/work/_emit.py` `write_workitem()` was an example of this pattern; it was removed in the May 2026 refactor when the CLI was stripped to lifecycle-only.
  Such helpers are harness utilities, not substrate.

## Does not constrain

- What interfaces exist over the substrate.
  CLI, web, OpenClaw harness, MCP transport — all valid; none are primary at the substrate level.
- The implementation language.
  Python is current practice; this decision is about substrate purity in the conceptual sense.
- Substrate operations that serve both substrate correctness and interface convenience.
  When a substrate operation is intrinsically useful, implementing it as a clean API that happens to be exposed through the CLI is not a violation.
