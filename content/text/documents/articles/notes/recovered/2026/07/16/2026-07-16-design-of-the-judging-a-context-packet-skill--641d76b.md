---
title: "Design of the judging-a-context-packet skill"
description: "Low-level design for seating judging-a-context-packet as a real, fuel-capped, inquiry-kind skill — the IRB's rejudge-the-distribution-pilot allocation, option 3 (continue narrowly): formalize test two's scratch discrimination experiment as a seated instrument, not the other three named-but-unfunded candidates."
date-created: 2026-07-16
kind: low-level-design
in-service-of: lib/emsenn
tags:
  - skill-design
  - inquiry
  - judging-a-context-packet
  - packet-verdict
  - nvidia
  - distribution
  - pilot
status: implemented
declared-by: claude
---

# Design of the judging-a-context-packet skill

This is a low-level design under `writing-a-low-level-design`. It is written before any code and must clear senior-software-engineer review before implementation begins — this run produces the design only.

## 1. Position

**What is funded.** `lib/emsenn/services/board-of-directors/services/executive-office/data/decision-records/rejudge-the-distribution-pilot.json`, decision (option 3, "continue at a narrow, stated next scale"): exactly one further instrument — a `judging-a-context-packet` inquiry skill, seated end to end the same way `drafting-a-term.js` was, fuel-capped at ≤3, actuating one named NVIDIA endpoint, validating through `read-a-schema.js`. Not funded by this verdict: the endpoint register, the context-packet class, the model-trust-ordering routing rule. This design touches none of those three.

**The requirement cell this realizes.** `lib/emsenn/services/board-of-directors/services/executive-office/data/requirements/route-work-by-measured-complexity-across-inference-tiers.json`, cell `skill:judging-a-context-packet-is-a-fueled-inquiry` — met-when a script under `lib/emsenn/services/board-of-directors/services/executive-office/lib/management/skills/` (flat or projected) greps `judging-a-context-packet`, `@closure-kind inquiry`, and `@fuel`.

**The task and its work-items.** `lib/emsenn/services/board-of-directors/services/executive-office/data/tasks/seat-the-judging-a-context-packet-skill.json`, discharging `realizing-a-requirement`, work-item `seat-the-judging-a-context-packet-skill-work` (actions: `write-the-low-level-design` — this document — `carry-the-design-to-review`, `author-the-inquiry-skill`, `project-the-skill`).

**No HLD names this unit.** The module-developer office's own roster records this as an unrealized gap generally ("no unit has a low-level design, because no high-level design names any unit"). This unit is no exception: there is no module-lead HLD allocating it an interface. Its authority chain runs decision-record → requirement cell → task → dispatch, the same chain that seated its precedent (`drafting-a-term.js` carries no HLD citation either — it was seated directly under the prior pilot's own funding decision). Flagging this plainly rather than inventing an HLD citation that does not exist: **a reviewer should fault an invented interface citation here, not the absence of one.**

**Interfaces this unit actually participates in** (not HLD-allocated, but real): it calls `read-a-schema.js` as a sibling subprocess (the one validator, never copied); it is called by nothing yet — this is a standalone CLI instrument, not wired into any orchestrator, consistent with the pilot's bounded scope; it consumes `emsenn/schema/packet-verdict`, a schema this same implementation pass seats via `write-a-schema.js` (see §2) before the skill script is written, since the skill's own precondition requires the schema already resolve through `read-a-schema.js`.

## 2. Structure and data

### 2.1 The `packet-verdict` schema (new, seated via `write-a-schema.js` as a prerequisite step of implementation — never written inline in the skill script)

File: `lib/emsenn/services/board-of-directors/services/executive-office/lib/schemas/packet-verdict.schema.json`, `$id: emsenn/schema/packet-verdict`.

```jsonc
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "emsenn/schema/packet-verdict",
  "title": "Packet Verdict",
  "type": "object",
  "required": ["packet-label", "criteria", "total", "verdict"],
  "additionalProperties": false,
  "properties": {
    "packet-label": { "type": "string", "minLength": 1, "maxLength": 200 },
    "criteria": {
      "type": "object",
      "required": [
        "self-containment",
        "machine-checkable-goal-conditions",
        "lane-boundaries",
        "resolvable-citations",
        "output-contract"
      ],
      "additionalProperties": false,
      "properties": {
        "self-containment": { "$ref": "#/$defs/criterion-shape" },
        "machine-checkable-goal-conditions": { "$ref": "#/$defs/criterion-shape" },
        "lane-boundaries": { "$ref": "#/$defs/criterion-shape" },
        "resolvable-citations": { "$ref": "#/$defs/criterion-shape" },
        "output-contract": { "$ref": "#/$defs/criterion-shape" }
      }
    },
    "total": { "type": "integer", "minimum": 0, "maximum": 10 },
    "verdict": { "type": "string", "enum": ["strong", "adequate", "deficient"] }
  }
}
```

**Corrected per senior review, finding 1 (blocking).** The review caught, correctly, that this block as first drafted used a single literal placeholder key (`"<each of the five keys above>"`) under `properties`, which — combined with `additionalProperties: false` — would make `read-a-schema.js` refuse every one of the five real criteria keys as "not allowed" on every attempt, while `required` simultaneously demanded those same five keys be present: unsatisfiable, on every real invocation, exhausting all 3 fuel turns and refusing every time. The seated schema (`lib/emsenn/services/board-of-directors/services/executive-office/lib/schemas/packet-verdict.schema.json`) writes the five keys out as **explicit, separately named properties** — each carrying the identical `{type: object, required: [score, reason], additionalProperties: false, properties: {score, reason}}` subschema — closing that gap. (The seated file inlines the subschema five times rather than via `$defs`/`$ref`, to keep the five real key names maximally literal on the page for the next reader, rather than folding them behind a level of indirection; both forms are equivalent to `read-a-schema.js`, which implements `$ref`/`$defs`.) `verdict` also now carries `type: string` alongside its `enum`, matching `score`'s `type: integer` + `enum` pairing (finding 5, non-blocking).

Bounds, and why:

- **Five fixed criteria keys, `additionalProperties: false` on `criteria`.** These are exactly the five test two proved discriminable: self-containment, machine-checkable goal conditions, lane boundaries, resolvable citations, output contract (evidence note, "Test two" section). A sixth key is refused, not ignored — the same discipline `read-a-schema.js` itself enforces on unimplemented keywords.
- **`score` is an enum of exactly `[0, 1, 2]`**, not an open integer range — per the task's own framing ("scoring each 0/1/2").
- **`reason` is capped at 240 characters.** This is the tight-reply-contract lesson applied at the schema level, not just the prompt level: the note's own conclusion is that "reply-contract tightness beats model tier," and a schema that permits an unbounded `reason` string re-opens exactly the looseness the cap is designed to close. 240 chars is roughly one sentence — enough to state a reason, not enough to hedge at length.
- **`total` and `verdict` are declared fields, not schema-enforced sums.** JSON Schema (and this pool's `read-a-schema.js`, which implements a stated subset of 2020-12 and refuses unimplemented keywords rather than silently accepting them) has no arithmetic keyword to enforce "`total` equals the sum of the five scores" or "`verdict` is the correct band for `total`." **This is a genuine residual gap, named rather than hidden**: a hand-built record fed straight to `read-a-schema.js`, bypassing the skill script, could carry an inconsistent `total`/`verdict` and still validate. The invariant is enforced by the *script* that assembles the record (§3), never by the schema. This is one of the two things I expect the reviewer to push on hardest (see §7).
- **No `model` or `fuel` field on the verdict record itself**, matching the `term` schema precedent: `emsenn/schema/term` carries no provenance-of-drafting fields either (`lib/emsenn/services/board-of-directors/services/executive-office/lib/schemas/term.schema.json`, `id`/`name`/`definition`/`specified-by`/`see-also`/`x-source`/`x-provenance`). Provenance (which model, how much fuel spent) lives in the CLI's outer JSON wrapper (§3.5), the same layer `drafting-a-term.js` puts `model`/`fuel`/`attempts` in (lines 310–319), never inside the record that gets validated against the class.

### 2.2 The stdin contract (the context packet itself)

Unlike `drafting-a-term.js`, which wraps its input in a request object (`{slug, domain, context}`, lines 185–195), this skill's stdin **is** the context packet, unwrapped — the task's own framing is exact: "a context packet (JSON on stdin)." No context-packet class exists yet (unfunded; requirement cell `schema:context-packet-class-seated` is separately unmet), so this skill imposes no shape on the packet beyond "parses as JSON and is not empty." Emptiness is checked generically across JSON types: `null`; `""`  (after trim); `{}` (zero keys); `[]` (zero length) are all refused; any other JSON value (object, array, string, number, boolean) is accepted as a packet to judge. This mirrors `drafting-a-term.js`'s `if (!request.slug...)` gate (line 195) at the same position in the control flow, generalized because there is no fixed field to check for.

### 2.3 Packet identity: `--label`

A context packet has no guaranteed `id` (no class constrains it). The verdict record's `packet-label` is resolved, in order: (1) `--label <string>` if given on the CLI; (2) if the packet is a JSON object carrying `id`, `name`, or `slug` as a string, that value; (3) the literal string `"untitled-packet"`.

**Corrected per senior review, finding 2 (blocking).** As first drafted, this fallback chain was named as an open identity-ambiguity question for the reviewer, but the review found it understated: with `--verdict-dir` given, two packets that both fall through to `"untitled-packet"` slug to the identical filename, and the second `writeFileSync` silently overwrites the first verdict — exit 0 both times, no warning, a caller's earlier verdict simply gone. That is a data-loss bug, not an open design question, and the review required it fixed rather than merely named. **Resolution (the review's option (a), the simpler of the two offered): the script refuses `--verdict-dir` outright whenever the resolved label is the bare `"untitled-packet"` fallback and no explicit `--label` was given.** A caller who wants a verdict written to disk for a packet with no identity of its own must name it first; a caller who does not care to write to disk can still judge the packet, stdout-only, without ever supplying a label. This is no longer a residual named for the reviewer to weigh — it is closed.

## 3. Logic and algorithms

### 3.1 The `@declaration` header, verbatim as it will ship

```js
/**
 * @skill judging-a-context-packet
 * @verb-phrase judging a context packet
 * @closure-kind inquiry
 * @model nvidia/nemotron-3-nano-30b-a3b
 * @fuel 3 turns
 * @description Takes a context packet (JSON on stdin) and scores it 0/1/2 against five fixed criteria — self-containment, machine-checkable goal conditions, lane boundaries, resolvable citations, output contract — each with a stated reason, actuates a bounded NVIDIA cloud model under a tight inline reply contract (the model returns only the five scored criteria; every other field — packet-label, total, verdict — is computed by this script, never trusted from the model), assembles a full packet-verdict record, validates it through read-a-schema.js against emsenn/schema/packet-verdict, and on a failed validation feeds the model its own errors and retries — at most @fuel times. Emits either a valid verdict or a structured refusal listing every unmet error; never seats, routes, or dispatches on the strength of its own verdict. Use to judge whether a context packet is fit to hand to a smaller model or script before it is actually distributed — the judgment is this instrument's product, not the distribution decision itself.
 *
 * @precondition stdin carries a non-empty JSON value — the context packet to judge
 * @precondition API_KEY_INFERENCE_NVIDIA is set in the environment; refused, never printed or written, if absent
 * @precondition emsenn/schema/packet-verdict is seated and reachable through read-a-schema.js from --from
 * @postcondition every candidate verdict is checked by read-a-schema.js — the one validator — never a private copy of its rules
 * @postcondition the actuator makes at most @fuel attempts and stops the instant one attempt validates
 * @postcondition on exhausting @fuel with no valid attempt, a structured refusal lists every attempt's unmet errors and nothing is emitted as if it had passed
 * @postcondition a valid verdict is written only to stdout or --verdict-dir, never seated, routed, or acted on by this script — judging a packet is not deciding what becomes of it
 * @witness the packet judged (its caller-given or derived label) and the fuel cap in force
 * @witness every attempt's validity and validation errors, so raw first-attempt validity and post-repair validity are both on the record
 * @witness on refusal, every attempt's unmet errors
 */
```

Pattern source: this header's shape, tag-for-tag, is `drafting-a-term.js` lines 2–19 (the `@skill` … `@witness` block). `@description`, `@precondition`, `@postcondition`, `@witness` counts differ only where the domain differs (packet vs. term request; verdict vs. draft).

**`@model` — why `nvidia/nemotron-3-nano-30b-a3b` and not the 49b tier test two also used.** Test two ran both the nano tier and `nvidia/llama-3.3-nemotron-super-49b-v1.5` and found discrimination held at *both*; the note's own conclusion is that reply-contract tightness, not model size, drove the result. The decision record's ceiling is explicit: fuel "may not exceed fuel 3 — the same bound the proven precedent (drafting-a-term.js) used; this verdict does not license a larger cap on the strength of the pilot's success alone." I read that same discipline as applying to model tier, not only fuel count: shipping the 49b tier when the nano tier tested equally well would be spending more than the evidence justifies, for a result the pilot already showed the cheaper tier delivers. `--model` remains overridable per-run (§3.6), so nothing forecloses a future run against the larger tier — it is just not the shipped default.

**`@fuel 3 turns` — why the ceiling itself, not fewer.** Test two needed zero repairs at either tier. That is evidence the *inline* reply contract works, not evidence that 1 turn suffices in production: test two ran exactly two hand-picked packets (one strong, one deliberately deficient control); a live packet population will vary more than a two-point test set. Fuel 3 is the IRB's own hard ceiling for this tranche, and taking headroom up to the ceiling — rather than presuming test two's zero-repair result generalizes and shipping fuel 1 — is the conservative reading of "may not exceed fuel 3," not an argument for a larger cap.

### 3.2 Control flow (patterned on `drafting-a-term.js`'s `run()`, lines 262–296, with one added step)

1. Parse CLI flags (`--from`, `--verdict-dir`, `--label`, `--model`, `--fuel`, `--help`) — pattern: lines 80–89, 98–112.
2. Read stdin; refuse absent/unparseable/empty (§2.2, §4) — pattern: lines 185–195 (generalized per §2.2).
3. Read `API_KEY_INFERENCE_NVIDIA`; refuse if unset, never logged — pattern: lines 197–203.
4. Resolve `read-a-schema.js` via `findSkill`/`findUp` — **copied verbatim**, lines 118–153 (byte-identical resolution discipline: nearest-up, sibling-beside-script fallback). Refuse if not found — pattern: line 156.
5. Read `emsenn/schema/packet-verdict` via `read-a-schema.js --show` — pattern: `readTermSchema()`, lines 158–168, renamed `readVerdictSchema()`.
6. Resolve `packet-label` (§2.3).
7. Build the system + user messages (§3.3) — pattern: `systemPrompt()`/`userPrompt()`, lines 207–225, **content diverges deliberately** (§3.3).
8. Loop `i = 1..FUEL`:
   a. `actuate(messages)` — **copied verbatim** except `max_tokens` and `temperature` (§5) — pattern: lines 235–247. On fetch failure: record the attempt, `break` (fuel is not spent chasing a dead endpoint) — pattern: lines 273–278.
   b. `extractJson(raw)` — **copied verbatim**, lines 249–260. On failure: record attempt, push a repair message asking for the criteria object only, `continue` — pattern: lines 280–286.
   c. **New step, absent from the precedent**: compose the full candidate record from the parsed `{criteria: {...}}` plus the script's own known fields — `packet-label` (step 6), `total` (sum of the five `criteria.*.score`, computed directly from whatever values are present — **not** pre-checked or clamped before summing, see the finding-4 correction in §3.4 for why that matters), and `verdict` (banded from `total`: `total >= 8` → `strong`, `4 <= total <= 7` → `adequate`, `total <= 3` → `deficient`, mirroring test two's own strong-vs-deficient binary with a middle band added for production packets that are neither the pilot's confirming case nor its control — **provisional and unevidenced**, per the finding-3 correction, marked as such in `packet-verdict.schema.json`'s own `$comment` on `verdict`).
   d. Validate the composed candidate via `read-a-schema.js` against `packet-verdict` — pattern: `validateTerm()`, lines 170–183, renamed `validateVerdict()`.
   e. Valid → `draft = candidate; break`. Invalid → push assistant/user repair turn with the errors — pattern: `repairPrompt()`, lines 227–233, and lines 288–296.
9. Emit success (`ok: true`, the verdict, `model`, `fuel: {cap, spent}`, `first-attempt-valid`, `post-repair-valid: true`, `attempts`) or refusal (`ok: false, refusal: true`, same provenance fields, `post-repair-valid: false`) — pattern: lines 298–334, `out()`/`die()` helpers at lines 91–96.

### 3.3 The prompt / reply contract — the load-bearing design decision

`drafting-a-term.js`'s system prompt dumps the *entire* JSON Schema into the prompt (`JSON.stringify(termSchema, null, 2)`, line 212) and asks the model to produce a document that validates against all of it. That is exactly the shape test one showed fails on the first attempt 5/6 of the time. Test two's system prompt instead gave an **exact inline example shape** and succeeded 4/4 across both tiers. This design ports test two's approach, not test one's, and narrows it further: **the model is asked for only the `criteria` object — nothing computed (`packet-label`, `total`, `verdict`) is ever requested from the model**, because those three fields are arithmetic or lookup, not judgment, and asking a model to also get arithmetic right is spending reply-contract tightness on a part of the task that does not need a model at all.

**System prompt (verbatim as it will ship):**

```
You judge a context packet — a bundle of instructions and information
handed to a smaller model or a script to act on — against five fixed
criteria. Score each criterion 0, 1, or 2:
  2 = fully met
  1 = partially met
  0 = not met
State one concise reason for each score, one sentence, under 200 characters.

Criteria:
1. self-containment — everything needed to act is present in the packet
   itself; no assumed shared context.
2. machine-checkable-goal-conditions — the packet's goal can be checked
   by a machine command, not by prose judgment.
3. lane-boundaries — the packet states what is, and is not, in scope.
4. resolvable-citations — every reference the packet makes points
   somewhere that actually resolves.
5. output-contract — the packet states exactly what shape its own
   output must take.

Return ONLY a single JSON object, no markdown fences, no commentary,
in EXACTLY this shape:
{
  "criteria": {
    "self-containment": {"score": 0, "reason": "..."},
    "machine-checkable-goal-conditions": {"score": 0, "reason": "..."},
    "lane-boundaries": {"score": 0, "reason": "..."},
    "resolvable-citations": {"score": 0, "reason": "..."},
    "output-contract": {"score": 0, "reason": "..."}
  }
}
Nothing else — no total, no overall verdict, no restatement of the
packet. Every score is exactly the integer 0, 1, or 2.
```

**User prompt:** the packet JSON verbatim (`JSON.stringify(packet, null, 2)`), preceded by one line naming it ("Context packet to judge:") — pattern: `userPrompt()`, lines 222–225.

**Repair prompt on a failed `read-a-schema.js` check:** identical structure to `repairPrompt()` (lines 227–233) — list every error, ask for the corrected `{criteria: {...}}` object only, no fences, no commentary. Because the model only ever owns the `criteria` object, a repair turn never has to explain arithmetic errors in `total`/`verdict` to the model — those errors cannot occur, because the model never produces those fields. The only errors a repair turn can ever list are: a missing/misnamed criterion key, a `score` outside `{0,1,2}`, or a `reason` empty or over 240 characters. That is a strictly smaller error surface than `drafting-a-term.js` hands its model, by design.

### 3.4 Composing the candidate — where the invariant actually lives

```
candidate = {
  "packet-label": label,
  "criteria": parsed.value.criteria,     // exactly as the model returned it
  "total": sum(criteria[k].score for k in the five keys),
  "verdict": band(total),
}
```

If the model's JSON is missing the `criteria` key entirely, or `criteria` is not an object, composing still proceeds (candidate.criteria = undefined or non-object) and `read-a-schema.js` reports the resulting violation (`$/criteria is required` or a type mismatch) exactly as it would for any malformed record — no special-case handling needed, the one validator carries this.

**Corrected per senior review, finding 4 (non-blocking).** The first draft claimed scores are "clamped to the schema's 0–10 range by construction since each score is itself checked to be 0/1/2 before summing" — the review caught that this does not match the pseudocode above, which sums first and lets `read-a-schema.js` check ranges only afterward, against the assembled candidate. Nothing in the composing step itself clamps or pre-validates a score before `sum()` runs. **The corrected account:** the range check is entirely post-hoc — `total` is computed from whatever values are present (a missing or non-numeric `score` makes a term of the sum `NaN`, which propagates to make the whole `total` `NaN`), and it is `read-a-schema.js`'s validation of the *assembled* candidate against `packet-verdict` that catches an out-of-range or missing score and drives a repair turn, exactly as it would for any other malformed field. Separately, `band(total)` must do something sensible with a `NaN` total even though that candidate will also fail schema validation on its `criteria` shape (both problems fire together, not sequentially): `band()` is written as `if (total >= 8) return "strong"; if (total >= 4) return "adequate"; return "deficient";` and `NaN >= 8` and `NaN >= 4` are both `false` in JavaScript, so a `NaN` total falls through to `"deficient"` — the worst band, never the best one, on an incomplete or malformed reply. This is written down as the intended behavior rather than left as an accident of comparison-operator semantics, per the review's request.

### 3.5 Output wrapper (unchanged shape from precedent, renamed fields)

```jsonc
// success, exit 0
{
  "ok": true,
  "verdict": { /* the packet-verdict record */ },
  "path": "...",              // only if --verdict-dir given
  "model": "nvidia/nemotron-3-nano-30b-a3b",
  "fuel": { "cap": 3, "spent": 1 },
  "first-attempt-valid": true,
  "post-repair-valid": true,
  "attempts": [ { "attempt": 1, "valid": true, "errors": [] } ]
}
// refusal, exit 1
{
  "ok": false,
  "refusal": true,
  "packet-label": "...",
  "model": "...",
  "fuel": { "cap": 3, "spent": 3 },
  "first-attempt-valid": false,
  "post-repair-valid": false,
  "attempts": [ /* every attempt, every error */ ]
}
```

Pattern: lines 302–334.

### 3.6 CLI flags

`--from <dir>` (schema/skill resolution root, default cwd — line 80), `--verdict-dir <dir>` (write the verdict to `<dir>/<slug(packet-label)>.json`, additionally to stdout — pattern: `--draft-dir`, lines 81, 303–309), `--label <string>` (§2.3), `--model <id>` and `--fuel <n>` (override header defaults for one run — pattern: lines 82–83), `--help` (usage text — pattern: lines 98–110).

**Divergence from precedent, stated explicitly: `--fuel` is capped at 3.** `drafting-a-term.js`'s `--fuel` accepts any positive integer (line 112: only checks `Number.isInteger(FUEL) && FUEL >= 1`) — an operator could already override it past whatever the header declares. This design adds `if (FUEL > 3) die(...)`, because the IRB's allocation names *this skill's fuel cap* as the ceiling on a specific tranche's recurring spend ("may not exceed fuel 3"), and an unbounded CLI override would let a caller quietly spend past a board-set allocation. This is a real divergence from the copied precedent and is named here so the reviewer can decide whether it should also be back-ported to `drafting-a-term.js` (out of scope for this unit) or whether the divergence itself is wrong.

`slug(packet-label)`: lowercase, non-`[a-z0-9-]` runs collapsed to a single `-`, leading/trailing `-` trimmed. Stated so a reviewer can fault the transform, not just its existence.

## 4. Error paths (every refusal, its trigger, and its exit code)

| # | Condition | Exit | Pattern |
|---|---|---|---|
| 1 | no stdin | 1 | line 187 analog |
| 2 | stdin not parseable JSON | 1 | lines 189–193 analog |
| 3 | stdin parses to an empty JSON value (`null`, `""`, `{}`, `[]`) | 1 | new — §2.2 |
| 4 | `--fuel` not a positive integer | 1 | line 112 |
| 5 | `--fuel` > 3 | 1 | new — §3.6 divergence |
| 6 | `read-a-schema.js` not found on the resolution walk | 1 | line 156 |
| 7 | `emsenn/schema/packet-verdict` does not read (`--show` fails or `ok:false`) | 1 | lines 159–168 analog |
| 8 | `API_KEY_INFERENCE_NVIDIA` unset | 1 | lines 200–203 |
| 9 | a fetch to the NVIDIA endpoint fails mid-loop | attempt recorded, loop `break`s (no further fuel spent chasing a dead endpoint), falls through to refusal | 1 (via #10) | lines 273–278 |
| 10 | fuel exhausted with no attempt validating | 1 (structured refusal, every attempt's errors listed) | lines 322–334 |
| — | `--help` | 0 (usage text, not a refusal) | lines 98–110 |
| — | success: a composed candidate validates within the fuel budget | 0 | lines 302–320 |

**Named residual, not a refusal path:** a hand-crafted record that bypasses this script and is validated directly by `read-a-schema.js` can carry a `total`/`verdict` inconsistent with its `criteria` scores and still validate — the schema cannot enforce that arithmetic (§2.1). This script's own composition step (§3.4) is the only place the invariant is actually held.

## 5. Resource use

- **Processes:** one `read-a-schema.js` spawn for the initial `--show` (schema read), one further spawn per attempt for validation — at most `FUEL + 1 = 4` child processes per invocation, matching precedent's shape (lines 159, 172).
- **Network:** one HTTPS POST to `https://integrate.api.nvidia.com/v1/chat/completions` per attempt, at most `FUEL = 3` — same endpoint, same call shape as `drafting-a-term.js` (line 84, lines 236–247), copied verbatim including the absence of a client-side timeout. That absence is inherited from the precedent, not introduced here; hardening it is out of this unit's funded scope.
- **Tokens:** `temperature: 0.1` (lower than the precedent's `0.2` — this is a scoring judgment, not creative drafting, and consistency across repeat runs of the same packet is worth more here than in open-ended drafting); `max_tokens: 400` (down from the precedent's `1200` — the reply contract asks for five short `{score, reason<=240 chars}` pairs and nothing else, so the whole valid reply is well under 400 tokens; a reply that runs past this budget is treated as a truncated/unparseable attempt by `extractJson` and consumes one fuel unit, which is an intended, not accidental, consequence of the budget being tight).
- **Disk:** at most one write, to `--verdict-dir`, only on success — same as precedent (lines 304–309).
- **Memory:** bounded by one packet, one message array of at most `2*FUEL` turns, and `FUEL` attempt records held in memory for the final report — no unbounded accumulation.

## 6. What this skill will NOT do

- **Will not seat anything.** No write to any `content/` pool. A verdict is judgment output, exactly as a term draft is drafting output (`drafting-a-term.js`'s own "When NOT to use," lines 62–66) — seating, if it ever happens, is someone else's act, on some future record this pilot has not funded.
- **Will not route.** It does not consult, implement, or approximate the model-trust-ordering rule the note names as a fourth candidate instrument (unfunded by this decision record). A strong verdict is not a dispatch, and a deficient verdict is not a rejection — this script hands back a score, never a decision about what happens to the packet next.
- **Will not touch the endpoint register or the context-packet class.** Both are named in the same research note and explicitly not funded by `rejudge-the-distribution-pilot`'s option 3. This design reads and writes nothing under either name.
- **Will not spend past its fuel cap**, including via `--fuel` override (§3.6).
- **Will not import from MetroPlat, or from anything outside node builtins and sibling skills invoked as subprocesses.** Same discipline as `drafting-a-term.js` (`node:child_process`, `node:fs`, `node:path`, `node:url` only, lines 74–77) — per the standing requirement `realize-the-named-specs-not-the-software-that-first-realized-them`.
- **Will not judge more than one packet per invocation**, and will not actuate more than one model per invocation (only the header's single named `@model` runs; test two's second, larger tier is not shipped — §3.1).
- **Will not ask the model for anything arithmetic** (`total`, `verdict`) — those are computed, never requested (§3.3, §3.4).

## 7. Points a reviewer is most likely to fault

1. **The `total`/`verdict` invariant is enforced only by this script's composition step, not by `packet-verdict.schema.json` itself** — a record built by hand and fed straight to `read-a-schema.js` can be internally inconsistent and still validate (§2.1, §4). The review may ask whether this residual is acceptable for a pilot-scale instrument or whether it should gate implementation.
2. **`--fuel` capped at 3 is a deliberate divergence from the `drafting-a-term.js` precedent**, which has no such cap (§3.6). The review may push either direction: back-port the cap to the precedent, or drop it here for consistency.
3. **Model tier choice (nano only, not the 49b tier test two also validated) is an inference from the decision record's fuel-ceiling language, not a literal instruction about model size** (§3.1) — the review may want this reasoning made explicit in the decision record itself before it is treated as binding, rather than inferred here.
4. **The `total` band cutoffs (`>=8` strong, `4–7` adequate, `<=3` deficient) are not evidenced by test two**, which only ever produced all-2s or all-0s (§3.2 step 8c) — the middle band is this design's own invention for production traffic the pilot never tested, and the review may want it justified further or loosened to an unlabeled numeric-only verdict until real production data exists.
5. **`packet-label` falls back through `--label` → packet's own `id`/`name`/`slug` → `"untitled-packet"`**, meaning two different packets judged without `--label` and without any of those three fields collide on the same fallback label (§2.3) — the review may require `--label` to be mandatory instead.

*(This numbered list is left exactly as submitted for review — it is the record of what the reviewer actually assessed. The review's ruling on each item, and the corrections made in response, are below and reflected in §2.1, §2.3, and §3.4 above.)*

## Senior review (2026-07-16)

**Verdict: PASS-WITH-CORRECTIONS.**

Design authored at the depth I'd have needed to author it myself. The precedent-tracing is real, not decorative — I re-executed every line-range citation against `drafting-a-term.js` and `project-a-skill.js` and every one resolves to the function or statement the design says it does, including the two most load-bearing (`readTermSchema()`/`validateTerm()` at 158–183, and the exact `temperature: 0.2`/`max_tokens: 1200` values at 236–239 that §5's cost comparison depends on). The `@declaration` header parses cleanly against `project-a-skill.js`'s `recordFrom()` and validates against `skill.schema.json`'s `allOf` inquiry branch (`models` + `fuel` both present, nothing `additionalProperties` would reject). `@fuel 3 turns` means "at most 3 model actuations," identically to how `drafting-a-term.js` reads its own `@fuel 3 turns` header (loop bound `i <= FUEL`, one actuation per iteration) — no drift between the header's semantics and the two scripts' shared control-flow pattern. The repair loop feeds back `read-a-schema.js`'s literal error strings (`` `${at}: ...` `` pointers), not a paraphrase — confirmed against `read-a-schema.js`'s own `validate()` output shape.

One finding below is disqualifying as written and must be fixed before implementation; two more are required corrections the developer can apply without asking what was meant. The rest are non-blocking precision fixes.

### Findings

1. **[BLOCKING] The `criteria` subschema in §2.1 will not validate anything, ever, as literally written.** The `properties` block shown is:
   ```jsonc
   "properties": {
     "<each of the five keys above>": { ... }
   }
   ```
   That is prose shorthand, but §2.1 labels the block "File: `lib/emsenn/services/board-of-directors/services/executive-office/lib/schemas/packet-verdict.schema.json`" — this is the content to write, not an illustration. Read literally, `properties` declares exactly one key, the literal string `<each of the five keys above>`. Combined with `additionalProperties: false`, none of the five real keys (`self-containment`, etc.) match anything in `properties`, so `read-a-schema.js`'s `additionalProperties` handling (its own lines 289–296: `if (schema.additionalProperties === false) errs.push(...'is not allowed')`) will flag **every one** of the five real criteria keys as not allowed, on every attempt, regardless of how correct the model's judgment is. `required` still demands those same five keys be present, so the schema demands keys it simultaneously forbids — unsatisfiable. The skill as designed would exhaust all 3 fuel turns and refuse on every real invocation; this is the kind of fault a reviewer exists to catch before it becomes a codebase, not after.
   **Correction:** write five explicit entries under `properties` — `self-containment`, `machine-checkable-goal-conditions`, `lane-boundaries`, `resolvable-citations`, `output-contract` — each carrying the identical subschema (`type: object`, `required: [score, reason]`, `additionalProperties: false`, `properties: {score, reason}` as already specified). `patternProperties` is not an available substitute: it is JSON Schema vocabulary `read-a-schema.js` recognizes but does not implement (present in its `VOCABULARY` set, absent from `IMPLEMENTED`), so using it anywhere in the schema causes every validation against that schema to be refused outright, not skipped.

2. **[BLOCKING] The `packet-label` fallback collision (the author's own fault 5) is understated — it is silent data loss on disk, not just an identity ambiguity.** With `--verdict-dir` given and two packets each carrying none of `--label`/`id`/`name`/`slug`, both resolve to `"untitled-packet"`, both slug to the same path, and the second `writeFileSync` silently overwrites the first verdict — exit 0 both times, no warning, no error. A caller who judged packet A and then packet B into the same directory has lost A's verdict with nothing in the record to say so.
   **Correction:** pick one, state it in §2.3, and remove it from §7's "residual" framing since it's a data-loss bug rather than an open question: (a) refuse `--verdict-dir` when the resolved label is the `"untitled-packet"` fallback and no explicit `--label` was given (forcing the caller to name the packet before it can be written to disk), or (b) make the fallback path collision-proof — e.g. suffix `untitled-packet` with a short hash of the packet body when falling through to it. Either is a small, mechanical addition; (a) is simpler and matches this pool's general refusal-over-silent-guessing discipline.

3. **[BLOCKING, tied to the ruling on fault 4 below] The verdict band cutoffs must carry an on-record admission that they are unevidenced, not just a mention in §7 that a reviewer might raise it.** Test two produced only `total=10` and `total=0`; the `>=8`/`4–7`/`<=3` split is invented for traffic the pilot never ran. That's a legitimate design choice for a first cut, but as currently written the schema itself asserts the cutoffs with no marker distinguishing them from an evidenced threshold — a future reader of `packet-verdict.schema.json` (which is a public, checkable record, per this office's charter) has no way to know `8` and `4` are placeholders rather than derived numbers.
   **Correction:** add a `$comment` on the `verdict` property (or on `total`) stating plainly that the band cutoffs are provisional, unevidenced by the pilot (which only produced all-2s/all-0s results), and subject to revision once production packets accumulate. One sentence; `read-a-schema.js` passes `$comment` through as an implemented, inert annotation, so this costs nothing at validation time.

4. **[non-blocking] §3.4's claim that scores are "clamped to the schema's 0–10 range by construction since each score is itself checked to be 0/1/2 before summing" does not match the composing pseudocode shown, which sums first and only lets `read-a-schema.js` check ranges after.** Nothing in §3.4 clamps or pre-checks a score before `sum()` runs; the schema check against the *assembled* candidate is what actually catches an out-of-range or missing score, and it does so after `total` has already been computed from whatever values were there (possibly `NaN` if a score is missing or non-numeric). The system is still safe — the assembled candidate will fail schema validation and trigger a repair turn — but the design's own stated reasoning for *why* it's safe is wrong, and an implementer trusting that sentence could skip writing the schema-catches-it-afterward behavior it actually depends on.
   **Correction:** rewrite the parenthetical to say the range check happens post-hoc, via `read-a-schema.js` validating the assembled candidate, not by construction in the composing step. While correcting it, state explicitly what `band()` does when `total` is `NaN` (missing/non-numeric score) — falling through an `if/else if` chain to the final `else` ("deficient") is almost certainly the intended behavior, but it should be written down rather than left as an accident of comparison-operator semantics.

5. **[non-blocking] The `verdict` property declares `enum` with no `type`.** `score` pairs `type: integer` with its `enum`; `verdict` should do the same (`type: string` alongside its enum) for the same reason — harmless either way given how `read-a-schema.js` implements `enum` independently of `type`, but it's a one-line consistency fix with the sibling field in the same schema.

### Ruling on the five anticipated faults

1. **Total/verdict arithmetic unenforced by schema — sustained as a named residual**, not a blocker. JSON Schema genuinely has no keyword for "field X equals a function of fields Y", and `read-a-schema.js` implements a stated subset rather than a private extension — inventing a custom keyword here would repeat exactly the mistake `read-a-schema.js`'s own header describes fixing. Recommended, non-blocking hardening: have the composing step assert its own invariant (`total === sum(...)`, `verdict === band(total)`) immediately before emitting, and refuse rather than emit if that assertion ever fails — not because the current logic can violate it, but because a later edit to `band()` or the sum could, silently, and nothing else would catch it.
2. **Fuel cap of 3 as a deliberate divergence from the uncapped precedent — sustained.** Correctly derived from the decision record's explicit ceiling ("may not exceed fuel 3 ... this verdict does not license a larger cap"), and the design is honest that it's a divergence rather than presenting it as inherited. Whether to back-port the cap to `drafting-a-term.js` is correctly named as out of scope for this unit.
3. **Shipping only the nano model — sustained.** The inference (fuel-discipline language extends to tier choice) is reasonable and the design says so plainly rather than treating it as given; `--model` remaining overridable per-run means nothing is foreclosed. Agreed with the author that this reasoning belongs in the decision record itself before a second instrument treats it as binding, but that does not block this design.
4. **The three-band verdict inventing an unevidenced middle band — sustained *with* the correction above (finding 3).** Inventing a band for production traffic the pilot never saw is a defensible first cut, not a defect on its own — refusing to ship any verdict until every band is evidenced would stall the instrument the decision record just funded. What's not acceptable is shipping the cutoffs silently, indistinguishable from an evidenced number; mark them provisional in the schema itself and the design stands.
5. **Packet-label fallback collision — overruled as understated, not as wrong to raise.** The author correctly identified the mechanism; I'm requiring it be treated as the data-loss bug it is (finding 2) rather than left as a question for the review to optionally act on.

**The one correction most likely to change the implementation:** finding 1 — the `criteria` subschema's placeholder key. Every other finding is a refinement of a design that otherwise works; this one, shipped as written, produces a skill that refuses on every input and never emits a verdict at all.

**The ruling on fault 1's recommended hardening was applied.** The composing step now re-derives `sum(criteria)`/`band(...)` and asserts (via `Object.is`, so a legitimately shared `NaN` total does not trip a false positive) that the composed candidate's `total`/`verdict` still match, refusing outright rather than emitting if that assertion ever fails. It cannot fail today — the same functions compute both sides of the comparison in the same call — but it is now on the record as a self-check rather than an assumption, so a later edit to `sumScores()` or `band()` that quietly breaks the invariant is caught here instead of nowhere.

## Implementation record (2026-07-16)

Built exactly as corrected above, with no further deviation from the reviewed design:

- **Schema seated:** `lib/emsenn/services/board-of-directors/services/executive-office/lib/schemas/packet-verdict.schema.json` (`emsenn/schema/packet-verdict`), via `write-a-schema.js`, corrections from findings 1/3/5 applied (five explicit criteria properties, `$comment` marking the band cutoffs provisional/unevidenced, `verdict` carries `type: string`). Confirmed to accept a well-formed verdict and to refuse a sixth `criteria` key.
- **Skill authored:** `lib/emsenn/services/board-of-directors/services/executive-office/lib/management/skills/judging-a-context-packet.js`, corrections from findings 2/4 and the fault-1 hardening applied (`--verdict-dir` refused for an unlabeled fallback; `band()`'s post-hoc, `NaN`-falls-to-`deficient` behavior stated and asserted). One structural note beyond the review's own findings: the `@declaration` header had to be split into its own `/** ... */` block, separate from the surrounding design-rationale prose, because `project-a-skill.js`'s header reader treats any comment line starting with `@word` as a new declaration — several wrapped prose lines in the first draft happened to start with `@fuel`/`@model` mid-sentence and were misread as duplicate tag declarations. This is a parsing constraint of the shared tool, not a change to what the header declares.
- **Projected:** `.claude/skills/judging-a-context-packet/` (`SKILL.md` + `scripts/judging-a-context-packet.js`), via `project-a-skill.js`; the projected script reads back byte-identical to the source.
- **Structural goal command** (`lib/emsenn/services/board-of-directors/services/executive-office/data/tasks/seat-the-judging-a-context-packet-skill.json`'s own goal): exits 0.
- **Local refusal paths exercised with zero network spend:** empty stdin, non-JSON stdin, empty-object packet, `--fuel` non-integer, `--fuel > 3`, and the unlabeled-plus-`--verdict-dir` collision guard — all refuse with the designed message and exit 1, none of them touching the network.
- **One live actuation** (not a suite, per the allocation): judged the real seated `seat-the-judging-a-context-packet-skill` task+dispatch pair as the context packet. Result: attempt 1 produced no parseable JSON (consumed as a failed attempt, repair turn issued); attempt 2 validated against `packet-verdict` — `total: 0`, `verdict: "deficient"`, every one of the five `reason` fields literally `"..."`, the example placeholder from the system prompt copied verbatim rather than a real judgment. The pipeline behaved exactly as designed (fuel-bounded, schema-validated, repair-loop worked, exit 0), but the *content* reproduces the pilot's own named risk precisely: schema-valid output that is not semantically correct. This is reported as observed, not retried for a better-looking result — the allocation funds one seated instrument, not an evaluation campaign, and a second actuation to get a nicer number would be exactly the campaign the decision record declined to fund.
