# pyfars

PyFARS is a substrate-of-cells system over arbitrary unix flatfiles.
Files of any registered format (markdown frontmatter, JSON, YAML, Python source, plain markdown body) are projected into a typed predication store via the projector framework; closure-rule systems run over that store; agentic operations — dispatch, agent invocation, federation — compose on top.

PyFARS gives you a single API for predication computation over unix flatfiles: load any directory of files as a substrate, project them into typed cells, compute closures, query the graph, append witnesses, federate by value-domain join.
When the substrate also carries the agentic resources — agents, endpoints, offices, governance records, closure-rule records — the same engine can dispatch work, invoke agents, and operate as a polity.
Agentic operation is what a substrate becomes when those resources are available; it is not what pyfars requires to be useful.

PyFARS is the Python realization of FARS (Flatfile Agentic Resource System) and is built on:

- **PyPredCalc** — the predication-categories engine providing `BilatticeValue`, `PredicationStore`, and `StoreClosureRuleSystem`.
- **LangGraph** — the state-graph runtime driving the engine's lifecycle (`validate → boot → tick → halt`) and the dispatch pipeline (`load_store → apply_eligibility_rules → select_winners → invoke_agent`).
- **PydanticAI** — the agent runtime that PyFARS compiles substrate agent records into.

## Documentation

Long-form docs live in [`prose/`](prose/), organized along [Diátaxis](https://diataxis.fr/) lines:

- **[`prose/tutorials/installing-pyfars.md`](prose/tutorials/installing-pyfars.md)** — fresh checkout to working install.
- **[`prose/how-to/recovering-from-a-broken-install.md`](prose/how-to/recovering-from-a-broken-install.md)** — diagnose and fix a misbehaving install.
- **[`prose/explanation/the-install-pipeline.md`](prose/explanation/the-install-pipeline.md)** — design rationale for `make → nix → install` and why projected harness outputs are gitignored.

Architecture overview is in [`docs/PyFARS_Overview.md`](docs/PyFARS_Overview.md).
Self-theory atoms live in [`concepts/`](concepts/), [`objects/`](objects/), [`morphisms/`](morphisms/), and [`claims/`](claims/).
Governance (charter, decisions, offices, conventions) is in [`governance/`](governance/).
Active work (goals, milestones, tasks) is in [`work/`](work/).

## Primary Interface: OpenClaw

While PyFARS can be used directly via its CLI and engine API, the **primary human-facing interface** for interacting with PyFARS is through [OpenClaw](https://openclaw.ai).
OpenClaw provides:

- Persistent session memory and long-term MEMORY.md
- Integrated tool system for leveraging PyFARS skills
- Agent orchestration capabilities that map to PyFARS substrate records
- Rich interactive experience with voice, canvas, and messaging features
- Automatic harness projection that makes PyFARS agents available as OpenClaw agents

To use PyFARS through OpenClaw: 1.
Install the OpenClaw harness into your substrate: `pyfars install openclaw` 2.
Launch OpenClaw: `openclaw` (or use your preferred OpenClaw interface) 3.
PyFARS agents will be automatically discovered and available for interaction

## CLI: lifecycle-only

The CLI is *lifecycle-only* — boot an engine on a substrate, install/uninstall harnesses, get help.
Operations on a *running* engine (substrate manipulation, queries, dispatch, etc.) go through the engine's API surface (UDS-bound FastAPI app per [`governance/specifications/wiring-protocols.md`](governance/specifications/wiring-protocols.md) §4.2), not the CLI.
This is the Docker / Apache / systemd shape: the daemon's CLI is for starting and stopping; everything else goes through the running daemon's interface.

```
$ pyfars
verbs: clean, help, install, run

$ pyfars run                    # boot an engine on the current directory
$ pyfars run /path/to/substrate # boot an engine on another directory
$ pyfars install <harness>      # install a harness into the substrate
$ pyfars install --all          # install every available harness
$ pyfars install --uninstall <harness>
$ pyfars clean                  # remove every harness-projected file
$ pyfars help <verb>            # spec-driven help for one verb
```

`pyfars run` validates the substrate root (any directory with an `_index.md`), boots the engine, opens the event log, spawns supervised services (the FastAPI web app, per discovered `kind: website` assets), and ticks the lifecycle StateGraph.
SIGINT or SIGTERM halts cleanly and emits a halt-witness.
The default tick interval is 20 seconds; pass `--tick-interval` to override.
Pass `--autonomous` to invoke PydanticAI agents on each tick (off by default — boot/halt audits and replay determinism don't need real model calls).
The dispatch graph fires on every tick, but only does something when the substrate carries workitems and dispatchables to act on; on a substrate without those resources, the engine still runs — it just has nothing to dispatch.

## Architecture

The package is layered around the predication substrate.
The runtime is LangGraph-driven; closure-rule application runs through PyPredCalc; agents are PydanticAI Agents compiled from substrate records.

```
src/pyfars/
├── substrate/   substrate primitives over arbitrary flatfiles
│   ├── projector/  format-projector framework (data ↔ pypredcalc cells):
│   │               json_doc, yaml_doc, markdown_frontmatter, markdown_body,
│   │               python_source, compound (filesystem walker)
│   ├── parse/   text -> typed: frontmatter, links, citations, bibtex,
│   │            fm_relations, fm_references, fm_annotation, link_kind
│   ├── load/    path -> typed: flatfile, flatfiles, bib, path filters
│   ├── index/   collection -> derived: by_slug, by_kind, edges,
│   │            in_edges, out_edges, depends_on, dependents, claims
│   ├── types/   Flatfile, Predication, Diagnostic, Suggestion, Reference,
│   │            BibEntry, Claim, Link
│   ├── bilattice.py  the Belnap–Fitting FOUR; bridges into pypredcalc.algebra
│   ├── endpoint.py   LLM endpoint records (governance/assets/computing/endpoints/)
│   ├── flatfile.py   Flatfile dataclass (slug, dir, kind, fm, body, path, mtime)
│   ├── predication.py  typed graph edge between notes
│   ├── store.py      Substrate handle with cached-property indexes
├── operator/    substrate operators
│   ├── traversal/  ancestors, descendants, cycles, topo_sort,
│   │               foundation_distance, resolve_term, chain
│   ├── edit/       fm_set, fm_add, fm_rm, rewrite_fm, rename_fm_key,
│   │               rewrite_fm_slug, rewrite_body_link, move_note, snapshot
│   ├── witness.py  Witness records — every operator emits one
├── closure/     substrate validation/lint over the markdown view
│   ├── valuation/  note -> number/bool: inbound, broken_outbound, density,
│   │               firmness, structure, slop, citation_density, composite, …
│   ├── rule/       corpus -> diagnostics: cycles, broken_links, orphans,
│   │               capability_coverage, charter_binding, stubs, proofs, …
│   ├── lint/       corpus -> suggestions: depends_on_completeness,
│   │               empty_description, fm_key_casing, trailing_newline
├── runtime/     LangGraph-driven engine
│   ├── lifecycle.py        validate → boot → tick → halt StateGraph
│   ├── dispatch_graph.py   load_store → apply_eligibility_rules →
│   │                       select_winners → invoke_agent StateGraph
│   ├── eligibility_rules.py  closure-rule instantiator registry; each
│   │                         slug under objects/<slug>.md activates a rule
│   │                         (capabilities, skills, jurisdiction, rate-limit,
│   │                         charter-binding) over the PredicationStore
│   ├── closure_runner.py   Kleene-iterated closure with per-firing
│   │                       provenance and a deterministic rsv_hash
│   ├── agent_compiler.py   substrate record → PydanticAI Agent; model
│   │                       inferred via endpoint capability matching
│   ├── services.py         supervised long-running coroutines (web,
│   │                       control); discovers website assets on boot
│   ├── event_log.py        JSONL append-only log of operator witnesses
│   ├── ledger.py           lens over the witness log as double-entry postings
│   ├── federation.py       FederationCell / FederationEnvelope; CRDT merge
│   ├── boundary.py         transport-independent fiber composition
│   ├── belief.py           cellwise belief query over the witness log
│   ├── promote.py          settlement-path operator (observation → tool)
│   ├── group.py            polity / ship / office / personnel record loader
│   ├── office.py           offices with Hohfeldian deontic profiles
│   ├── session.py, agent.py, channel.py, container.py, instance.py,
│   │   profile.py
├── analyze/   read-only analytical queries: search, stats, impact,
│             ramp, where, context_walk, open_questions, demand_clusters,
│             realization_gaps, predicate_category, …
├── render/    data → string: bibtex, monograph, audit_report, fm_dump,
│             json_dump, context_blob, diagnostics, show_note, …
├── skills/    substrate skill records and helpers
├── web/       FastAPI app and browser UI (started by the service supervisor)
├── harnesses/
│             installable harness packages: agentic, claude-agent-sdk-plugin,
│             claude-code, claude-code-hooks, claude-code-instructions,
│             claude-code-mcp, cline-workflows, codex, nix-flake, openclaw,
│             replit, replit-config, replit-instructions, repository,
│             systemd-user
└── cli/       lifecycle CLI: __main__, run, install_harness, clean, help

src/pyfars/
├── api.py        programmatic entry points
├── convention.py KIND_LABEL, RELATION_KEYS, INTERNAL_FIELDS, …
├── spec.py       VerbSpec + Parameter + argparse/help generators
└── __main__.py   module dispatcher for the `pyfars` console script
```

The `closure/` substrate-validation layer is **not** the same as the runtime closure-rule system.
`closure/` produces diagnostics over the markdown view of authored content; `runtime/eligibility_rules.py` + `runtime/closure_runner.py` apply substrate-authorized closure rules over the typed `pypredcalc.
PredicationStore` at dispatch time.

## Running

The package is built and exercised through Nix.
From the PyFARS repository root:

```bash
nix develop -c pyfars <verb> [args...]
```

To build the package:

```bash
nix build
nix run .#pyfars -- <verb> [args...]
```

From the 561 meta-repo, run `make install` for normal live-system work.
It installs `pyfars` into the user's Nix profile, using the checked-out PyFARS member as the flake input when present.

## Tests

```bash
nix flake check
nix develop -c pytest tests -q
```

The suite covers:

- Substrate primitives (parse / load / index / projector / types)
- Operators (traversal, edit, witness)
- Closure rules and lint (`closure/rule/*`, `closure/lint/*`)
- Runtime (lifecycle, dispatch_graph, eligibility_rules, closure_runner, agent_compiler, services, event_log, ledger, federation, boundary, belief, promote, session, group, office, …)
- Convention invariants
- Generated-harness regressions

`nix flake check` is the package-level gate; direct `pytest` is for faster local narrowing inside the devshell.

## Extending

### Add a new projector

A *projector* is an adjoint pair `(extract, create)` between bytes-of-some-format and `pypredcalc.
PredicationCell` cells, satisfying the counit law `extract(create(cells)) ≈ cells`.

1. Write `src/pyfars/substrate/projector/<format>.py` exposing a `PROJECTOR` instance with `name`, `vocabulary`, `extract(data, *, subject) -> Iterable[PredicationCell]`, and (where invertible) `create(cells) -> data`.
2. Register the file extension in `EXTENSION_PROJECTORS` in `compound.py`.
3. Write `tests/test_projector_<format>.py`.

Pure functions only at the atomic level; I/O lives in the compound orchestrator.

### Add a new eligibility closure rule

The dispatch graph activates closure rules whose `objects/<slug>.md` records exist in the substrate.
Adding a new rule means authoring the substrate record and registering the runtime instantiator that grounds the rule against the live store.

1. Author `objects/<rule-slug>.md` declaring the rule's antecedent / consequent shape and the predicates it reads.
2. Write an instantiator in `src/pyfars/runtime/eligibility_rules.py`:
   ```python
   def instantiate_<rule_slug>(store: PredicationStore) -> list[StoreRule]:
       ...   # walk the store; emit grounded StoreRule objects
   ```
3. Register `"<rule-slug>": instantiate_<rule_slug>` in `RULE_INSTANTIATORS`.
4. Write `tests/test_runtime_eligibility_<rule_slug>.py`.

Presence of the `objects/<rule-slug>.md` record activates the rule; removing the record deactivates it.

### Add a new substrate-validation rule

1. Write `src/pyfars/closure/rule/<name>.py` exporting `def check(notes, ...) -> Iterator[Diagnostic]`.
2. Add the import + call in `closure/rule/compose_rules.py`.
3. Add the (code, title) entry to `render/diagnostics_report.py`'s `DEFAULT_SECTION_ORDER` so it appears in validate's report.
4. Write `tests/test_rule_<name>.py`.

### Add a new score

1. Write `src/pyfars/closure/valuation/<name>.py` exporting `def score(note_or_slug, *, …) -> ...
  `.
  One function, no orchestration.
2. Compose with others via `closure/valuation/composite.score(*signals, combine=...)
  ` for multi-signal products.

### Add a new analyze

Functions that return structured data (lists, tier dicts, ranked tuples) go in `analyze/`.
They're allowed to call into multiple `substrate/index/`, `operator/traversal/`, and `closure/valuation/` modules.
One function per file.

### Add a new linter

1. Write `src/pyfars/closure/lint/<name>.py` exporting `def find(notes, *, by_slug, root) -> list[Suggestion]`.
2. Each suggestion may carry an optional `apply` callable for `--fix` flows.
3. Add the import + call in `closure/lint/compose_lint.py`.

### Add a new harness

A *harness* is a runtime-specific view of the substrate for an external agent (Claude Code, Replit, OpenClaw, etc.).

1. Create `src/pyfars/harnesses/<harness>/` with an `_index.md` (`type: harness`) and, where applicable, a `templates/` directory of Jinja2 templates rendered against substrate-derived context at install time.
2. Implement the harness's install / uninstall logic (the `install_harness` CLI dispatcher reads each harness's manifest).
3. The new harness becomes available as `pyfars install <harness>`.

## Design rules

- **Any unix flatfile is fair game.** PyFARS's substrate is the projector framework over arbitrary file formats.
  Markdown is one format among several; new formats become first-class by adding a projector.
- **The CLI is lifecycle-only.** `run`, `install`, `clean`, `help`.
  Operations on a running engine go through its UDS-bound API.
- **Substrate is the source for dispatch policy.** Eligibility / disqualification closure rules live as `objects/<slug>.md` records; their presence activates them.
  Code is the runtime; cells are the policy.
- **One function per file.** Add a feature by adding a module, not by growing an existing function.
  Compose at the call site.
- **Constants live in one place.** `RELATION_KEYS`, `INTERNAL_FIELDS`, `META`, `SCALAR_CONFIG`, `KIND_LABEL`, `SUBCOLLECTIONS` each live in exactly one module (typically `convention.py`).
  Don't duplicate.
- **Witnesses are the audit primitive.** Every state change emits a `Witness` to the JSONL event log per `runtime/event_log.py`.
  The log replays into derived state via `runtime/belief.py`'s cellwise fold.
- **Federation goes through the substrate's value-domain join.** `runtime/federation.py` is the cellwise `∨_k` over the Belnap–Fitting FOUR; the rsv_hash from `closure_runner.py` stamps each dispatch run for replay-determinism across peers.
- **Path filter excludes draft + build content by default.** `triage/`, `archetypes/`, `node_modules/`, `.git/`, vendored markers.
  Override with a custom `path_filter` callable when a tool needs to see drafts.
- **Harnesses enable integration.** `install_harness` generates projections for various runtime systems (OpenClaw, Claude Code, Replit, etc.) that make PyFARS agents and capabilities available in those environments.

## History

The package was first greenfield-rebuilt from `operations/engineering/tools/triage/` (deleted), which was a six-package ad hoc Python workspace plus a 700-line `corpus-digraph/query.py`.
Each wonky tool there had its own `analysis.py` / `render.py` / CLI and re-derived overlapping graph queries.
The first rebuild collapsed it into one library where every primitive (descendant counts, body-link extraction, slug normalization) lives once and is reused.

The current refactor (May 2026) settled the runtime on **PyPredCalc + LangGraph + PydanticAI**: the bespoke dispatch table, hand-rolled heartbeat asyncio scaffolding, and in-house closure-rule plumbing were replaced.
Dispatch became substrate-authorized closure-rule application over a typed `PredicationStore`; agents became PydanticAI Agents compiled from substrate records with model selection inferred via endpoint matching; the lifecycle moved to a LangGraph StateGraph; and the CLI was stripped to lifecycle-only with all operational verbs migrating to the engine's API surface per `governance/specifications/wiring-protocols.md`.
