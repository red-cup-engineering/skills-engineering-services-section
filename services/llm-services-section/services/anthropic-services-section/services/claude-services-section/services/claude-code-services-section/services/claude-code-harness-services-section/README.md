# Claude Harness Services Section

This locus is the Claude Code harness field. It does not implement an
agent loop as one controller. It exposes independently addressable operational
Actor models which a durable reaction may discover by recursive specification
and hire for its next enabled proof pore.

The section also owns the Claude Code runtime projector. Machine-specific
actors provide configuration only; this section projects that configuration
into a project-local `.claude/agents/` roster — one named, fully-primed agent
per projected office, installed by the settlement's own
installing-claude-as-an-agent instrument. It never writes an agent file by
hand and never invents a substitute projector: the office record is the
source, the agent file is output, and this service is the one place a machine
actor's Claude harness policy is turned into that output. Neither a machine
actor nor a hand-authored `.claude/agents/*.md` file is a competing harness
implementation.

Standing law this section exists to enforce, corrected into place 2026-07-28:
a session may dispatch only a named agent already projected into
`.claude/agents/` from a defined office — never a bare, unprimed model
prompted fresh on the spot. Priming happens once, here, at projection time;
a dispatch spends none of the Leader's attention re-explaining scope, law, or
instruments the projected agent already holds from its own office record.

## Field

| Actor | Operation | Boundary |
| --- | --- | --- |
| `claude-harness-projection-service` | `project-claude-harness` | One machine actor's office-roster configuration to one project-local `.claude/agents/` projection |
