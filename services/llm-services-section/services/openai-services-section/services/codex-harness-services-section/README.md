# Codex Harness Services Section

This locus is the OpenAI Codex harness field. It does not implement an
agent loop as one controller. It exposes independently addressable operational
Actor models which a durable reaction may discover by recursive specification
and hire for its next
enabled proof pore.

The section also owns the Codex runtime projector. Machine-specific actors
provide configuration only; this section projects that configuration into a
disposable project-local `.codex` directory. Neither the user-level Codex home
nor a machine actor is a competing harness implementation.

## Field

| Actor | Operation | Boundary |
| --- | --- | --- |
| `codex-harness-projection-service` | `project-codex-harness <configuration> <output>` | One machine actor configuration to an explicit disposable runtime output; never an implicit project or user `.codex` tree |
