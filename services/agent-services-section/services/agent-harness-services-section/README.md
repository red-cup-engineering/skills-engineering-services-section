# Agent Harness Services Section

The provider-agnostic parent `openai-services-section/codex-harness-services-section`
and `anthropic-services-section/claude-harness-services-section` sit beside:
each owns one provider's runtime projector, and duplicated whole the one thing
that was never provider-specific — the MAPE-K actuation-office shape that
turns one admitted Leader move into an authority-bounded actuation, so that
"contact the harness service" means dispatching to a seated office, never a
session hand-running a projector script.

`bare-cedar-fog-codex-actuation-office` (seven duties: maintain situational
knowledge, diagnose, design, decompose, actuate, observe, account) is that
shape's only existing instance. This section extracts it once, generalized:
`services/mape-k-actuation-office-service` generates the office record from
`{ providerLabel, actorUrn, nodeId, jurisdiction, colleagueOffices }` rather
than each provider hand-authoring an 80-line duplicate of the same seven
duties under a different name.

## Field

| Actor | Operation | Boundary |
| --- | --- | --- |
| `mape-k-actuation-office-service` | `render-actuation-office` | One provider actor's identity to one MAPE-K actuation-office record, duty and deontic shape held identical across providers |

## What is generalized, and what is still per-provider

Generalized: the seven duties, their names, and the deontic profile.
Still per-provider, deliberately: the skills that discharge each duty (a
Codex actuation reads `.codex` state and mutates `.codex/config.toml`; a
Claude actuation reads `.claude` state and mutates `.claude/agents/` — the
mutation targets differ, so the skill bodies cannot be shared without
pretending two providers' state is one shape). `bare-cedar-fog-codex-
actuation-office` already has all twelve skills written. The generated
`bare-cedar-fog-claude-actuation-office` record names the same seven duties
against the same skill ids for parity and discoverability, but most of those
skill files do not exist yet for Claude — recorded as this office's own
`unrealized`, not silently assumed complete.
