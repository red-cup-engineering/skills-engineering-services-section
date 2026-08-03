---
title: "Markdown as projection"
type: decision
status: committed
date: "2026-05-07"
theory-basis: [witness-as-increment, operations-settling]
---

# Markdown as projection

## What

Markdown files in the corpus are of two kinds: (1) theory content (definitions, theorems, narratives — authored by humans or agents as primary intellectual work), and (2) operational records (tasks, execution events, observations, sessions — derived from the event log).
Kind 2 files are projections, not sources of truth.
The event log is the source of truth for kind 2.

## Why

The FARS spec commits to `event-sourcing`: every state change is an immutable event; the current state is the fold of events.
If an operational markdown file can be edited directly without going through the event log, the substrate's state becomes inconsistent with the event log and replay fails.

From THINGS-I-WANT-DONE: "PyFARS writes a bunch of files as Markdown note files when they should be appended to a JSONL EAVT append-only log.
Markdown records are meant to be projections of truth from those logs, or determinations of theories."

## Rules out

- Directly hand-editing execution-event records, session records, or observation records to change the operational state.
  Edit the event log (by appending a corrective event via the engine API) and regenerate the projection.
- Treating any auto-emitted markdown workitem file as the authoritative record.
  The earlier `cli/work/_emit.py`'s `write_workitem` was an example of this anti-pattern; it was removed in the May 2026 refactor.
- Operational record files (type: workitem) that have no corresponding event-log entry.

## Does not constrain

- Theory content (type: theorem, concept, object, morphism, narrative, etc.).
  These are primary authored content and are the source of truth for the theory.
  They are not projections.
- Work records in `work/` (tasks, milestones, decisions).
  These are governance/planning documents, not substrate events.
  They're primary authored content for the planning layer, with their own source-of-truth chain.
- Whether to generate markdown projections at all.
  They're useful for human readability and corpus queries; the decision is about what's *primary*, not about deleting the projections.
