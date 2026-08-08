#!/usr/bin/env node
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

/**
 * Seated per decision record rejudge-the-distribution-pilot (option 3, continue
 * narrowly at a stated next scale) and requirement
 * route-work-by-measured-complexity-across-inference-tiers, cell
 * skill:judging-a-context-packet-is-a-fueled-inquiry. It formalizes the pilot's
 * scratch test two — a nano-tier and a larger-tier model each judged a real
 * context packet and a deliberately deficient control against five criteria
 * under a tight inline reply contract, both tiers first-attempt-valid, both
 * discriminating the real packet from the control — as a real, re-runnable
 * instrument, ported at the nano tier only (see "Why the nano tier" below).
 *
 * ## The reply contract is the load-bearing design decision
 *
 * drafting-a-term.js dumps its entire target JSON Schema into the system
 * prompt and asks the model to produce a document that validates against all
 * of it — the shape the pilot's test one showed fails on the first attempt
 * 5/6 of the time. Test two instead gave an exact inline example shape and
 * succeeded 4/4 across both tiers; the note's own reading of the two tests
 * together is that first-attempt validity tracked the tightness of the reply
 * contract, not the model's size. This script narrows the contract further
 * than test two did: the model is asked for ONLY the five scored criteria —
 * nothing computed (packet-label, total, verdict) is ever requested from it,
 * because those three fields are arithmetic or lookup, not judgment, and
 * asking a model to also get arithmetic right spends reply-contract
 * tightness on a part of the task that does not need a model at all. The
 * script composes the full candidate record from the model's narrow reply
 * plus its own computed fields, and only the ASSEMBLED candidate is checked
 * against emsenn/schema/packet-verdict — the schema's range checks on score
 * and total therefore run post-hoc, over the assembled candidate, not by any
 * pre-check in the composing step itself.
 *
 * total is the sum of the five criteria scores; verdict bands total into
 * strong (>= 8) / adequate (4-7) / deficient (<= 3). A missing or
 * non-numeric score yields a NaN total: NaN fails both `>=` comparisons in
 * that order, so band() falls through to "deficient" — a deliberate,
 * written-down default, not an accident of comparison-operator semantics.
 * The band cutoffs themselves are PROVISIONAL: test two only ever produced
 * total = 10 (the real packet, all five scores 2) or total = 0 (the
 * deficient control, all five scores 0) — the middle band and the exact
 * cutoffs are this design's own invention for production traffic the pilot
 * never ran, marked as such in packet-verdict.schema.json's own $comment on
 * `verdict` so a future reader of the schema does not mistake them for an
 * evidenced threshold.
 *
 * total/verdict consistency with criteria is enforced by THIS script's
 * composing step, never by the schema — JSON Schema has no keyword for
 * "field X equals a function of fields Y", and read-a-schema.js implements a
 * stated subset of 2020-12 rather than a private extension, so no custom
 * keyword is invented here to close that gap. A hand-built record that
 * bypasses this script and is validated directly by read-a-schema.js could
 * carry a total/verdict inconsistent with its criteria and still validate —
 * a named residual, not a silently assumed-closed gap.
 *
 * ## Why the nano tier
 *
 * Test two found discrimination held at BOTH the nano tier
 * (nvidia/nemotron-3-nano-30b-a3b) and the larger
 * nvidia/llama-3.3-nemotron-super-49b-v1.5. The IRB's rejudge-the-
 * distribution-pilot decision caps this tranche's fuel at 3 — "the same
 * bound the proven precedent (drafting-a-term.js) used; this verdict does
 * not license a larger cap on the strength of the pilot's success alone" —
 * and that same discipline, read consistently, extends to model tier: since
 * the cheaper tier already tested equally well, shipping the larger tier
 * would spend more than the evidence justifies. --model remains overridable
 * per run, so nothing forecloses running the larger tier later.
 *
 * ## Why fuel 3, not fewer
 *
 * Test two needed zero repairs at either tier — but it ran exactly two
 * hand-picked packets (one strong, one deliberately deficient control).
 * That is evidence the inline reply contract works, not evidence that one
 * turn suffices across a live packet population, which will vary more than
 * a two-point test set. Fuel 3 is the IRB's own hard ceiling for this
 * tranche; taking headroom up to that ceiling, rather than presuming test
 * two's zero-repair result generalizes and shipping fuel 1, is the
 * conservative reading of "may not exceed fuel 3."
 *
 * ## --fuel is capped at 3, unlike drafting-a-term.js's uncapped override
 *
 * drafting-a-term.js's --fuel accepts any positive integer with no upper
 * bound, so an operator could already override it past whatever the header
 * declares. This script refuses a --fuel above 3, because the IRB's
 * allocation names THIS skill's fuel cap as the ceiling on a specific
 * tranche's recurring endpoint spend — an unbounded CLI override would let
 * a caller quietly spend past a board-set allocation. This is a deliberate
 * divergence from the copied precedent, not an oversight.
 *
 * ## An unlabeled verdict is refused from disk, never silently overwritten
 *
 * A context packet carries no guaranteed id (no context-packet class exists
 * yet to constrain its shape — unfunded by this decision record). Without
 * --label, and without an id/name/slug on the packet itself, the label
 * falls back to the literal string "untitled-packet". Two different
 * packets judged that way into the same --verdict-dir would otherwise slug
 * to the identical filename and the second write would silently clobber the
 * first verdict with no warning. This script refuses --verdict-dir outright
 * when the resolved label is that bare fallback and no explicit --label was
 * given, rather than writing and risking the collision.
 *
 * ## Run it
 *
 * ```sh
 * set -a; . ./.env; set +a   # loads API_KEY_INFERENCE_NVIDIA — never hardcode it
 * echo '{"goal":"...","lane":"...","citations":["..."]}' \
 *   | node .../judging-a-context-packet.js --label my-packet
 *
 * node .../judging-a-context-packet.js --verdict-dir /tmp/verdicts --label my-packet < packet.json
 * node .../judging-a-context-packet.js --model nvidia/nemotron-3-nano-30b-a3b --fuel 3 < packet.json
 * ```
 *
 * Input is JSON on stdin: the context packet itself, unwrapped — any
 * non-empty JSON value (object, array, string, number, boolean). `--label`
 * names the packet for the verdict's packet-label field and for
 * --verdict-dir's filename; without it, the packet's own `id`, `name`, or
 * `slug` string field is used if present, else the literal
 * "untitled-packet" (refused for --verdict-dir; see above). Output is JSON:
 * `{ok: true, verdict, "first-attempt-valid", "fuel", model, attempts}` on
 * success, `{ok: false, refusal: true, "fuel", model, attempts}` on
 * exhaustion — exit 0 and 1 respectively.
 *
 * `--from` (default: the caller's working directory) is where read-a-schema.js
 * is asked to resolve emsenn/schema/packet-verdict from. `--verdict-dir <dir>`
 * additionally writes the valid verdict to `<dir>/<slug(packet-label)>.json`;
 * without it the verdict is stdout only. `--model` and `--fuel` override the
 * header's declared defaults for a single run — the header's own @model and
 * @fuel are what the schema and the pilot's allocation actually bind, and
 * --fuel above 3 is refused outright (see above).
 *
 * ## When NOT to use
 *
 * - Not to decide what becomes of a packet. A verdict is a score; routing,
 *   seating, or dispatching on the strength of one is this program's
 *   unfunded model-trust-ordering candidate, not this instrument.
 * - Not against the endpoint register or the context-packet class. Neither
 *   is funded by rejudge-the-distribution-pilot's option 3; this script
 *   reads and writes nothing under either name.
 * - Not for a packet whose own shape needs validating. No context-packet
 *   class exists yet — this judges quality against five criteria, it does
 *   not check the packet's structure against any schema.
 * - Not without the fuel cap loaded. Running the actuator unbounded, or
 *   past the IRB's stated ceiling of 3, is not "still inside the
 *   allocation" — read the decision record before raising it.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const NODE_ROOT = dirname(HERE);
const FROM = argValue("--from") ?? process.cwd();
const VERDICT_DIR = argValue("--verdict-dir");
const LABEL_FLAG = argValue("--label");
const MODEL = argValue("--model") ?? "nvidia/nemotron-3-nano-30b-a3b";
const FUEL = Number(argValue("--fuel") ?? 3);
const ENDPOINT = "https://integrate.api.nvidia.com/v1/chat/completions";
const CRITERIA_KEYS = [
  "self-containment",
  "machine-checkable-goal-conditions",
  "lane-boundaries",
  "resolvable-citations",
  "output-contract",
];
const FALLBACK_LABEL = "untitled-packet";

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

function out(value, code = 0) {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
  process.exit(code);
}

const die = (message) => out({ ok: false, error: message }, 1);

if (process.argv.includes("--help")) {
  process.stdout.write(
    [
      "Usage:",
      "  set -a; . ./.env; set +a",
      '  echo \'{"...packet...":"..."}\' | node judging-a-context-packet.js --label my-packet',
      "  node judging-a-context-packet.js --verdict-dir /tmp/verdicts --label my-packet < packet.json",
      "  node judging-a-context-packet.js --model <id> --fuel <n>   < packet.json",
      "  node judging-a-context-packet.js --help",
    ].join("\n") + "\n",
  );
  process.exit(0);
}

if (!Number.isInteger(FUEL) || FUEL < 1) die(`⊥ fuel must be a positive integer, got '${argValue("--fuel")}'`);
// The IRB's rejudge-the-distribution-pilot allocation caps THIS skill's
// recurring endpoint spend at fuel 3. Unlike drafting-a-term.js's --fuel
// (which accepts any positive integer), an override above the board-set
// ceiling is refused rather than honored.
if (FUEL > 3) die(`⊥ fuel may not exceed 3 — the IRB's rejudge-the-distribution-pilot ceiling on this skill's tranche, got '${FUEL}'`);

const READ_SCHEMA = fileURLToPath(import.meta.resolve("@red-cup-engineering/json-schema-services-section/read-a-schema"));
const SCHEMA_POOL = join(NODE_ROOT, "lib/schemas");

function readVerdictSchema() {
  const r = spawnSync(process.execPath, [READ_SCHEMA, "packet-verdict", "--pool", SCHEMA_POOL, "--show"], { encoding: "utf8" });
  let verdict = null;
  try {
    verdict = JSON.parse(r.stdout);
  } catch {
    die(`⊥ reading-a-schema returned nothing parseable for --show: ${(r.stderr || r.stdout || "").trim()}`);
  }
  if (!verdict?.ok) die(`⊥ emsenn/schema/packet-verdict did not read: ${verdict?.error ?? "unknown"}`);
  return verdict.schema;
}

// The one validator, called and never copied.
function validateVerdict(record) {
  const r = spawnSync(process.execPath, [READ_SCHEMA, "packet-verdict", "--pool", SCHEMA_POOL], {
    input: JSON.stringify(record),
    encoding: "utf8",
  });
  let verdict = null;
  try {
    verdict = JSON.parse(r.stdout);
  } catch {
    return [`reading-a-schema returned nothing parseable: ${(r.stderr || r.stdout || "").trim()}`];
  }
  return verdict.ok ? [] : (verdict.errors ?? [verdict.error]);
}

// ── the packet ─────────────────────────────────────────────────────────────
// Unlike drafting-a-term.js, which wraps its input in a request object, this
// skill's stdin IS the context packet, unwrapped: no context-packet class
// exists yet to constrain its shape, so this script imposes none beyond
// "parses as JSON and is not empty."
const input = readFileSync(0, "utf8").trim();
if (!input) die("no context packet on stdin — this judges a packet, not a request about one");
let packet;
try {
  packet = JSON.parse(input);
} catch (e) {
  die(`stdin is not JSON: ${e.message}`);
}
function isEmpty(value) {
  if (value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false; // numbers, booleans: never empty
}
if (isEmpty(packet)) die("the context packet on stdin is empty — nothing to judge");

// ── packet identity ────────────────────────────────────────────────────────
function derivedLabel() {
  if (packet && typeof packet === "object" && !Array.isArray(packet)) {
    for (const key of ["id", "name", "slug"]) {
      if (typeof packet[key] === "string" && packet[key].trim() !== "") return packet[key];
    }
  }
  return null;
}
const explicitLabel = LABEL_FLAG ?? derivedLabel();
const LABEL = explicitLabel ?? FALLBACK_LABEL;

// An unlabeled verdict is refused from disk, never silently overwritten: two
// packets that both fall through to "untitled-packet" would otherwise slug to
// the same filename and the second write would clobber the first with no
// warning at all.
if (VERDICT_DIR && LABEL === FALLBACK_LABEL && explicitLabel === null) {
  die(
    "⊥ refusing to write an unlabeled verdict to --verdict-dir: pass --label, " +
      "or give the packet its own id/name/slug, so two unlabeled packets do not " +
      "collide on the same filename. Omit --verdict-dir to judge without writing to disk.",
  );
}

function slug(label) {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

// ── the key ────────────────────────────────────────────────────────────────
// NEVER hardcoded, printed, or written anywhere. It lives in the environment;
// the caller loads it from .env before invoking this script.
const API_KEY = process.env.API_KEY_INFERENCE_NVIDIA;
if (!API_KEY) {
  die("⊥ API_KEY_INFERENCE_NVIDIA is not set — refusing rather than judging unauthenticated. Load it first: set -a; . ./.env; set +a");
}

const verdictSchema = readVerdictSchema();
void verdictSchema; // read to confirm the class resolves before spending fuel; validation itself is delegated to read-a-schema.js per attempt

function systemPrompt() {
  return [
    "You judge a context packet — a bundle of instructions and information",
    "handed to a smaller model or a script to act on — against five fixed",
    "criteria. Score each criterion 0, 1, or 2:",
    "  2 = fully met",
    "  1 = partially met",
    "  0 = not met",
    "State one concise reason for each score, one sentence, under 200 characters.",
    "",
    "Criteria:",
    "1. self-containment — everything needed to act is present in the packet",
    "   itself; no assumed shared context.",
    "2. machine-checkable-goal-conditions — the packet's goal can be checked",
    "   by a machine command, not by prose judgment.",
    "3. lane-boundaries — the packet states what is, and is not, in scope.",
    "4. resolvable-citations — every reference the packet makes points",
    "   somewhere that actually resolves.",
    "5. output-contract — the packet states exactly what shape its own",
    "   output must take.",
    "",
    "Return ONLY a single JSON object, no markdown fences, no commentary,",
    "in EXACTLY this shape:",
    "{",
    '  "criteria": {',
    '    "self-containment": {"score": 0, "reason": "..."},',
    '    "machine-checkable-goal-conditions": {"score": 0, "reason": "..."},',
    '    "lane-boundaries": {"score": 0, "reason": "..."},',
    '    "resolvable-citations": {"score": 0, "reason": "..."},',
    '    "output-contract": {"score": 0, "reason": "..."}',
    "  }",
    "}",
    "Nothing else — no total, no overall verdict, no restatement of the",
    "packet. Every score is exactly the integer 0, 1, or 2.",
  ].join("\n");
}

function userPrompt(pkt) {
  return ["Context packet to judge:", JSON.stringify(pkt, null, 2)].join("\n");
}

function repairPrompt(errors) {
  return [
    "That reply failed validation:",
    ...errors.map((e) => `- ${e}`),
    'Return ONLY the corrected {"criteria": {...}} object, fixing every error listed.',
    "Still no markdown fences, no commentary, no total, no overall verdict.",
  ].join("\n");
}

async function actuate(messages) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    // Lower temperature than drafting-a-term.js's 0.2: this is a scoring
    // judgment, not creative drafting, and repeat-run consistency matters
    // more here. max_tokens 400, not 1200: the whole reply contract is five
    // short {score, reason<=240 chars} pairs and nothing else.
    body: JSON.stringify({ model: MODEL, messages, temperature: 0.1, max_tokens: 400 }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`nvidia endpoint ${res.status}: ${text.slice(0, 500)}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

function extractJson(text) {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/u.exec(text);
  const body = fenced ? fenced[1] : text;
  const first = body.indexOf("{");
  const last = body.lastIndexOf("}");
  if (first === -1 || last === -1 || last < first) return { error: "no JSON object found in the model's output" };
  try {
    return { value: JSON.parse(body.slice(first, last + 1)) };
  } catch (e) {
    return { error: `model output is not parseable JSON: ${e.message}` };
  }
}

// total is the sum of the five scores; a missing or non-numeric score makes
// this NaN. band(NaN) falls through to "deficient" (both >= comparisons on
// NaN are false), which is deliberate: an incomplete reply should never band
// as anything but the worst verdict, and this is where that is decided.
function sumScores(criteria) {
  if (!criteria || typeof criteria !== "object") return NaN;
  let total = 0;
  for (const key of CRITERIA_KEYS) {
    const score = criteria[key]?.score;
    total += typeof score === "number" ? score : NaN;
  }
  return total;
}

function band(total) {
  if (total >= 8) return "strong";
  if (total >= 4) return "adequate";
  return "deficient"; // includes NaN: a missing/non-numeric score never bands as passing
}

async function run() {
  const messages = [
    { role: "system", content: systemPrompt() },
    { role: "user", content: userPrompt(packet) },
  ];

  const attempts = [];
  let verdict = null;

  for (let i = 1; i <= FUEL; i++) {
    let raw;
    try {
      raw = await actuate(messages);
    } catch (e) {
      attempts.push({ attempt: i, valid: false, errors: [`actuation failed: ${e.message}`] });
      break; // fuel is not spent chasing a dead endpoint
    }

    const parsed = extractJson(raw);
    if (parsed.error) {
      attempts.push({ attempt: i, raw, valid: false, errors: [parsed.error] });
      messages.push({ role: "assistant", content: raw });
      messages.push({ role: "user", content: repairPrompt([parsed.error]) });
      continue;
    }

    // The model owns ONLY criteria. Every other field is computed here, never
    // requested from the model and never trusted from its reply even if it
    // supplied one — this is the tight reply contract's whole point.
    const total = sumScores(parsed.value?.criteria);
    const candidate = {
      "packet-label": LABEL,
      criteria: parsed.value?.criteria,
      total,
      verdict: band(total),
    };

    // Recommended non-blocking hardening from the senior review's ruling on
    // fault 1 (total/verdict arithmetic unenforced by the schema): assert the
    // composing step's own invariant right here, rather than assuming it
    // holds. It cannot fail today — total and verdict above are computed by
    // the same calls this re-runs — but a later edit to sumScores()/band()
    // could break it silently, and nothing else in this pipeline would ever
    // catch that. Object.is is used, not ===, because NaN !== NaN in JS and a
    // missing-score candidate legitimately carries a NaN total both times.
    const recomputedTotal = sumScores(candidate.criteria);
    if (!Object.is(candidate.total, recomputedTotal) || candidate.verdict !== band(recomputedTotal)) {
      die(
        `⊥ internal invariant broken: composed total/verdict does not match band(sum(criteria)) for candidate ${JSON.stringify(candidate)} — refusing to emit an inconsistent verdict rather than trusting it`,
      );
    }

    const errors = validateVerdict(candidate);
    attempts.push({ attempt: i, raw, candidate, valid: errors.length === 0, errors });
    if (errors.length === 0) {
      verdict = candidate;
      break;
    }
    messages.push({ role: "assistant", content: raw });
    messages.push({ role: "user", content: repairPrompt(errors) });
  }

  const firstAttemptValid = attempts[0]?.valid === true;
  const fuelSpent = attempts.length;
  const report = attempts.map((a) => ({ attempt: a.attempt, valid: a.valid, errors: a.errors ?? [] }));

  if (verdict) {
    let path;
    if (VERDICT_DIR) {
      const dir = resolve(VERDICT_DIR);
      mkdirSync(dir, { recursive: true });
      path = join(dir, `${slug(LABEL)}.json`);
      writeFileSync(path, JSON.stringify(verdict, null, 2) + "\n");
    }
    out({
      ok: true,
      verdict,
      ...(path ? { path } : {}),
      model: MODEL,
      fuel: { cap: FUEL, spent: fuelSpent },
      "first-attempt-valid": firstAttemptValid,
      "post-repair-valid": true,
      attempts: report,
    });
  }

  out(
    {
      ok: false,
      refusal: true,
      "packet-label": LABEL,
      model: MODEL,
      fuel: { cap: FUEL, spent: fuelSpent },
      "first-attempt-valid": firstAttemptValid,
      "post-repair-valid": false,
      attempts: report,
    },
    1,
  );
}

await run();
