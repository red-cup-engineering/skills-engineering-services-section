#!/usr/bin/env python3
"""
run-one-exchange.py — the gemini-notebook unit's exchange harness.

Realizes the move the unit's canonical RMN law
(content/contracts/gemini-notebook-service.rml) promises: a typed context packet in, and
EXACTLY ONE of a schema-validated artifact or a structured refusal out, within a
bounded fuel budget — never a hang, never an untyped failure, never silence.

DESIGN (stated before the code, per house practice)
-----------------------------------------------------------------------------
1. This harness shells out to the vendored `notebooklm` CLI (this unit's own
   .venv/bin/notebooklm) as subprocesses, rather than importing the async
   `notebooklm.*` client modules directly — the CLI's `--json` envelopes are
   notebooklm-py's own documented, versioned contract (see data/SKILL.md),
   while the underscore-prefixed internal modules are not, and the fragile,
   undocumented-API surface this service contains belongs behind that
   boundary, not re-imported into this harness's own failure modes.

2. It runs one strict linear pipeline — packet validation, (dry-run stops
   here) auth-presence check, create notebook,
   add every source (converting a local .json source to a plain-text sibling
   copy first, since notebooklm-py only pins an upload content-type locally
   for .md/.markdown and its own source comments warn an unpinned guess can
   fail server-side), wait on every source, generate one supported artifact
   type (mind-map is synchronous; report, infographic, audio, and video use
   generate --wait plus an exact-artifact download step), validate that
   artifact against its own per-type class — wrapped in one top-level
   try/except, so any exception at
   any step falls through to exactly one place: the refusal branch in main().
   The harness has exactly two live-mode exits — a validated artifact-outcome
   exchange record, or a validated refusal-outcome exchange record — because
   every record this script is about to seat is itself re-validated against
   emsenn/schema/exchange via read-a-schema.js before the file is written,
   and a record that fails that check is never left on disk.

3. --dry-run runs only packet validation, plus a
   presence-only auth check (`notebooklm auth check --json`, which
   notebooklm-py's own source states makes no network call — only `--test`
   does) and then exits before touching notebook/source/generate — so it
   proves the provider plumbing end to end without ever reaching Google.

Live execution is admitted by the provider-facing contract adapter, which
requires an explicit source-egress and external-network capability from the
consumer. This harness does not carry a second, historical board gate of its
own: authorization belongs to the current invocation, not to a pilot record.
"""

from __future__ import annotations

import json
import csv
import hashlib
import io
import os
import shutil
import subprocess
import sys
import time
import uuid
from pathlib import Path

UNIT_ROOT = Path(__file__).resolve().parent
EXCHANGES_DIR = Path(os.environ.get(
    "GEMINI_NOTEBOOK_EXCHANGES_DIR",
    str(UNIT_ROOT / "content" / "exchanges"),
)).expanduser().resolve()
_gemini_notebook_python = os.environ.get("GEMINI_NOTEBOOK_PYTHON")
_installed_python = Path.home() / ".notebooklm" / "venv" / "bin" / "python"
GEMINI_NOTEBOOK_PYTHON = Path(shutil.which(_gemini_notebook_python) or _gemini_notebook_python) if _gemini_notebook_python else (_installed_python if _installed_python.exists() else UNIT_ROOT / ".venv" / "bin" / "python3")
GEMINI_NOTEBOOK_COMMAND = [str(GEMINI_NOTEBOOK_PYTHON), "-m", "notebooklm"]

ARTIFACT_MENU = ["report", "mind-map", "infographic", "audio", "video", "code", "json", "data-table"]
# The per-type classes this service has actually seated. mind-map generates
# synchronously; the other types generate asynchronously and are awaited by
# this synchronous exchange harness before download. REALIZERS below
# dispatches on this set's membership.
SUPPORTED_ARTIFACT_TYPES = set(ARTIFACT_MENU)

MAX_DATA_TABLE_BYTES = 10 * 1024 * 1024
MAX_DATA_TABLE_ROWS = 100_000
MAX_DATA_TABLE_COLUMNS = 1_000


def find_up(start: Path, relative: str) -> Path | None:
    """Walk from `start` upward, testing `<d>/<relative>` at each `d` — the
    same nearest-wins resolution the enterprise's own JS skills use."""
    d = start.resolve()
    while True:
        candidate = d / relative
        if candidate.exists():
            return candidate
        if d.parent == d:
            return None
        d = d.parent


READ_A_SCHEMA = (
    Path(os.environ["EMSENN_READ_A_SCHEMA"]).resolve()
    if os.environ.get("EMSENN_READ_A_SCHEMA")
    else find_up(UNIT_ROOT, "lib/management/skills/read-a-schema.js")
    or find_up(UNIT_ROOT, "node_modules/@red-cup-engineering/json-schema-services-section/scripts/read-a-schema.mjs")
    or find_up(UNIT_ROOT, "lib/emsenn/lib/management/skills/read-a-schema.js")
    or find_up(
        UNIT_ROOT,
        "lib/emsenn/services/561-group/services/red-cup-engineering/services/software-services-section/services/data-services-section/services/file-services-section/services/data-services-section/services/flatfile-services-section/services/serialization-services-section/services/json-file-services-section/services/json-schema-services-section/scripts/read-a-schema.mjs",
    )
)
SCHEMA_POOL = (
    Path(os.environ["EMSENN_SCHEMA_POOL"]).resolve()
    if os.environ.get("EMSENN_SCHEMA_POOL")
    else UNIT_ROOT / "content" / "schemas"
)


class ExchangeAborted(Exception):
    """Raised internally to short-circuit the pipeline into build_refusal()."""

    def __init__(self, grounds: str, unmet: list[str]):
        super().__init__(grounds)
        self.grounds = grounds
        self.unmet = unmet


def die(message: str, code: int = 1) -> None:
    print(json.dumps({"ok": False, "error": message}, indent=2))
    sys.exit(code)


def validate_against_schema(schema_id: str, data: dict) -> tuple[bool, list]:
    """Runs read-a-schema.js — the one validator — against `data`. Never a
    private re-implementation: a copy here would drift from the pool it
    claims to check, exactly as read-a-schema.js's own header warns against."""
    if READ_A_SCHEMA is None:
        return False, ["read-a-schema.js could not be found above this unit"]
    proc = subprocess.run(
        ["node", str(READ_A_SCHEMA), schema_id, "--pool", str(SCHEMA_POOL)],
        input=json.dumps(data),
        capture_output=True,
        text=True,
    )
    try:
        verdict = json.loads(proc.stdout)
    except json.JSONDecodeError:
        return False, [f"read-a-schema.js returned unparseable output: {proc.stdout!r} {proc.stderr!r}"]
    return bool(verdict.get("ok")), verdict.get("errors", [])


# ── packet ──────────────────────────────────────────────────────────────

def _is_valid_source_entry(s) -> bool:
    """Mirrors emsenn/schema/exchange's packet.sources oneOf: a non-empty
    string, or an annotated {path, ...} object (the shape existing packets
    staged packets actually use, carrying what-it-is / resolved-from
    provenance the harness doesn't need but must not choke on)."""
    if isinstance(s, str):
        return bool(s.strip())
    if isinstance(s, dict):
        return isinstance(s.get("path"), str) and bool(s["path"].strip())
    return False


def source_locator(source) -> str:
    """The path/URL to actually hand to `notebooklm source add`, whichever
    of the two sources.items shapes this entry is."""
    return source if isinstance(source, str) else source["path"]


def load_and_validate_packet(packet_path: str) -> dict:
    path = Path(packet_path)
    if not path.is_file():
        die(f"no such packet file: {packet_path}", code=2)
    try:
        packet = json.loads(path.read_text())
    except json.JSONDecodeError as e:
        die(f"packet is not valid JSON: {e}", code=2)

    errors = []
    notebook_context = packet.get("notebook-context")
    sources = packet.get("sources")
    if not isinstance(sources, list) or not sources or not all(_is_valid_source_entry(s) for s in sources):
        errors.append(
            "packet.sources must be a non-empty array of non-empty strings "
            "and/or {path, ...} objects"
        )
    if notebook_context is not None:
        if not isinstance(notebook_context, dict):
            errors.append("packet['notebook-context'] must be an object")
        else:
            if not isinstance(notebook_context.get("notebookId"), str) or not notebook_context["notebookId"].strip():
                errors.append("packet['notebook-context'].notebookId is required")
            source_receipt_id = notebook_context.get("sourceReceiptId")
            if not isinstance(source_receipt_id, str) or not (
                source_receipt_id.startswith("urn:sha256:") or source_receipt_id.startswith("ni:///sha-256;")
            ):
                errors.append("packet['notebook-context'].sourceReceiptId is required")
            ids = notebook_context.get("finalSourceIds")
            if not isinstance(ids, list) or not ids or any(not isinstance(item, str) or not item for item in ids) or len(set(ids)) != len(ids):
                errors.append("packet['notebook-context'].finalSourceIds must be a non-empty unique string array")
            if not isinstance(notebook_context.get("finalSourceSetDigest"), str) or not notebook_context["finalSourceSetDigest"].startswith("sha256:"):
                errors.append("packet['notebook-context'].finalSourceSetDigest is required")
    prompt = packet.get("prompt")
    if not isinstance(prompt, str) or not prompt.strip():
        errors.append("packet.prompt must be a non-empty string")
    artifact_type = packet.get("artifact-type")
    if artifact_type not in ARTIFACT_MENU:
        errors.append(f"packet['artifact-type'] must be one of {ARTIFACT_MENU}")
    if artifact_type == "code" and notebook_context is not None:
        errors.append("code generation requires an ephemeral notebook and cannot carry notebook-context")
    if artifact_type in {"json", "data-table"} and notebook_context is not None:
        errors.append(f"{artifact_type} generation requires an ephemeral notebook and cannot carry notebook-context")
    result_schema = packet.get("result-schema")
    if artifact_type == "json":
        if not isinstance(result_schema, str) or not result_schema.startswith("emsenn/schema/"):
            errors.append("packet['result-schema'] must name one seated emsenn/schema/* class for json")
    elif result_schema is not None:
        errors.append("packet['result-schema'] is only valid for json")
    video_options = packet.get("video-options")
    if artifact_type == "video":
        if not isinstance(video_options, dict):
            errors.append("packet['video-options'] must be an object for video")
        else:
            video_format = video_options.get("format")
            video_style = video_options.get("style")
            video_language = video_options.get("language")
            allowed_styles = {"auto", "classic", "whiteboard", "kawaii", "anime", "watercolor", "retro-print", "heritage", "paper-craft"}
            if video_format not in {"cinematic", "explainer"}:
                errors.append("packet['video-options'].format must be cinematic or explainer")
            if video_format == "cinematic" and video_style is not None:
                errors.append("cinematic packet['video-options'].style must be null")
            if video_format == "cinematic" and video_language != "en":
                errors.append("cinematic packet['video-options'].language must be en")
            if video_format == "explainer" and video_style not in allowed_styles:
                errors.append("explainer packet['video-options'].style is unsupported")
            if not isinstance(video_language, str) or not video_language.strip():
                errors.append("packet['video-options'].language must be non-empty")
    elif video_options is not None:
        errors.append("packet['video-options'] is only valid for video")

    if errors:
        die("packet failed validation: " + "; ".join(errors), code=2)
    return packet


def normalize_packet_for_record(packet: dict) -> dict:
    """emsenn/schema/exchange's packet sub-object is additionalProperties:
    false with exactly {sources, prompt, artifact-type} — the staged
    packet file on disk is allowed its own extra request metadata (id,
    prompted-by, purpose, output-contract, lane, authorization,
    credentials, ...) as the human-facing record of what was asked, but
    only these three fields are the exchange contract's own precondition
    and only these three get embedded in the seated record."""
    normalized = {
        "sources": packet["sources"],
        "prompt": packet["prompt"],
        "artifact-type": packet["artifact-type"],
    }
    if packet["artifact-type"] == "json":
        normalized["result-schema"] = packet["result-schema"]
    if packet["artifact-type"] == "video":
        normalized["video-options"] = packet["video-options"]
    return normalized


# ── auth presence (never a network call in dry-run) ────────────────────

def check_auth_presence() -> dict:
    """`notebooklm auth check --json`, WITHOUT --test. notebooklm-py's own
    CLI source (cli/session_cmd.py) states --test is what makes the network
    request; the bare form only reads local storage_state.json / the
    NOTEBOOKLM_AUTH_JSON env var and reports whether it parses — so this is
    presence, never validity, and never touches Google."""
    if not GEMINI_NOTEBOOK_PYTHON.exists():
        return {"ok": False, "reason": f"gemini-notebook Python environment not found at {GEMINI_NOTEBOOK_PYTHON}"}
    proc = subprocess.run(
        [*GEMINI_NOTEBOOK_COMMAND, "auth", "check", "--json"],
        capture_output=True, text=True,
    )
    try:
        result = json.loads(proc.stdout)
    except json.JSONDecodeError:
        return {"ok": False, "reason": f"unparseable auth check output: {proc.stdout!r} {proc.stderr!r}"}
    result["has-env-auth"] = bool(os.environ.get("NOTEBOOKLM_AUTH_JSON"))
    return result


def auth_present(auth: dict) -> bool:
    """The CLI's own success contract for `auth check --json` — verified
    against the vendored source, not assumed: cli/session_cmd.py's
    `_render_auth_check_result` emits `{"status": "ok" if all_passed else
    "error", "checks": {...}, "details": {...}}` on the JSON path. There is
    no `ok` key anywhere on that path — only this harness's OWN synthetic
    error dicts (CLI-not-found / unparseable-output, the early
    returns in check_auth_presence above) set `"ok": False`. A caller that
    tests `auth.get("ok")` therefore reads None — falsy — on every real
    success, and silently false-refuses unconditionally. This is the one
    place that test is made, so the mismatch cannot be reintroduced by a
    second ad hoc check elsewhere in this file."""
    # `has-env-auth` is only threaded onto `auth`'s SUCCESS path inside
    # check_auth_presence (after the JSON parse); its early-return error
    # branches — CLI-not-found or unparseable output — never set it.
    # Checking the environment directly here, rather than trusting that key
    # was carried through every branch, means a genuinely-set
    # NOTEBOOKLM_AUTH_JSON can't be masked by an unrelated hiccup in the
    # `auth check` subprocess itself.
    return auth.get("status") == "ok" or bool(os.environ.get("NOTEBOOKLM_AUTH_JSON"))


# ── live pipeline pieces ────────────────────────────────────────────────

class Budget:
    """Tracks observed provider invocations without making elapsed time a
    failure condition. Work remains pending until the provider responds or an
    explicit cancellation/transport failure is observed."""

    def __init__(self):
        self.calls = 0
        self.start = time.monotonic()

    def spend_call(self) -> None:
        self.calls += 1

    def elapsed(self) -> float:
        return time.monotonic() - self.start


def _run_gemini_notebook(budget: Budget, args: list[str], *, json_flag: bool) -> subprocess.CompletedProcess:
    """The one place a subprocess actually gets spawned against the vendored
    CLI. A provider operation is allowed to remain pending until it returns or
    is explicitly cancelled outside this harness."""
    budget.spend_call()
    full_args = [*GEMINI_NOTEBOOK_COMMAND, *args, "--json"] if json_flag else [*GEMINI_NOTEBOOK_COMMAND, *args]
    return subprocess.run(full_args, capture_output=True, text=True)


def _cli_failure_detail(proc: subprocess.CompletedProcess) -> str:
    """notebooklm-py's own error convention (verified against the vendored
    source, cli/error_handler.py:_output_error) writes its structured
    `{"error": true, "code", "message"}` envelope to STDOUT under --json —
    not stderr — then exits non-zero. Prefer that structured message when
    present; fall back to stderr (a Click usage error, a stack trace, or
    anything that never reached the JSON envelope) otherwise."""
    try:
        payload = json.loads(proc.stdout)
        if isinstance(payload, dict) and payload.get("error"):
            return f"{payload.get('code', '?')}: {payload.get('message', proc.stdout)}"
    except json.JSONDecodeError:
        pass
    return proc.stderr.strip() or proc.stdout.strip()


def run_cli(budget: Budget, *args: str) -> dict:
    """One notebooklm CLI call, JSON-in/JSON-out, charged against the budget."""
    proc = _run_gemini_notebook(budget, list(args), json_flag=True)
    if proc.returncode != 0:
        raise ExchangeAborted(
            f"gemini-notebook {' '.join(args)} failed (exit {proc.returncode}): "
            f"{_cli_failure_detail(proc)[:500]}",
            [f"cli-failure: {args[0] if args else '?'}"],
        )
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError:
        raise ExchangeAborted(
            f"gemini-notebook {' '.join(args)} returned unparseable JSON: {proc.stdout[:500]!r}",
            [f"cli-unparseable-output: {args[0] if args else '?'}"],
        )


def run_cli_to_file(budget: Budget, *args: str, expect_file: Path) -> str:
    """A CLI call whose real product is a file it writes (download
    commands), not a JSON envelope this harness wants to trust the shape of
    sight-unseen. Success is verified by the file actually landing, non-empty
    — the file, not stdout, is the source of truth."""
    proc = _run_gemini_notebook(budget, list(args), json_flag=True)
    if proc.returncode != 0 or not expect_file.is_file() or not expect_file.read_text().strip():
        raise ExchangeAborted(
            f"gemini-notebook {' '.join(args)} did not produce a readable, non-empty "
            f"{expect_file.name} (exit {proc.returncode}): {_cli_failure_detail(proc)[:500]}",
            [f"cli-download-failure: {args[0] if args else '?'}"],
        )
    return expect_file.read_text()


def looks_like_url(source: str) -> bool:
    return source.startswith("http://") or source.startswith("https://")


def prepare_source_for_upload(source, upload_dir: Path) -> tuple[str, str | None]:
    """Gemini Notebook's own upload path (notebooklm._source.upload) pins a
    content-type locally only for .md/.markdown; the vendored client's own
    comment there warns that an unpinned/guessed content-type can make
    server-side processing 'fail with status=ERROR'. The only locally pinned
    text carriers are Markdown. Any other local repository format—source
    code, TOML, JSON, JSONL, RML, or a generated record—is uploaded through
    a plain-text sibling copy rather than gambling on Gemini Notebook's MIME
    inference. This makes repository-selected evidence admissible without
    teaching each new extension a special case.
    `source` may be either sources.items shape (bare string or {path, ...});
    the packet's own `sources` field is never rewritten — only what gets
    handed to `source add` changes. Returns (path-or-url-to-upload,
    conversion-note-or-None)."""
    locator = source_locator(source)
    if looks_like_url(locator):
        return locator, None
    path = Path(locator)
    if path.suffix.lower() in {".md", ".markdown"}:
        return locator, None
    upload_dir.mkdir(parents=True, exist_ok=True)
    copy_path = upload_dir / (path.name + ".txt")
    try:
        copy_path.write_text(path.read_text())
    except UnicodeDecodeError as error:
        raise ExchangeAborted(
            f"repository source {path} is not UTF-8 text and has no admitted Gemini Notebook carrier: {error}",
            ["source-is-not-utf8-text"],
        )
    return str(copy_path), f"{path} -> {copy_path} ({path.suffix or 'extensionless file'} uploaded as plain text through Gemini Notebook's pinned text carrier)"


def realize_mind_map(budget: Budget, notebook_id: str) -> dict:
    """mind-map generates synchronously: one call returns the tree directly."""
    generated = run_cli(budget, "generate", "mind-map", "--notebook", notebook_id)
    mind_map = generated.get("mind_map")
    if not isinstance(mind_map, dict):
        raise ExchangeAborted(
            "gemini-notebook generate mind-map returned no mind_map payload",
            ["empty-generation-result"],
        )
    ok, errors = validate_against_schema("emsenn/schema/gemini-notebook-mind-map-artifact", mind_map)
    if not ok:
        raise ExchangeAborted(
            "the generated mind map does not validate against "
            "emsenn/schema/gemini-notebook-mind-map-artifact: " + "; ".join(errors),
            ["artifact-failed-its-own-class-validation"],
        )
    return {"payload": mind_map, "schema": "emsenn/schema/gemini-notebook-mind-map-artifact",
            "companion_text": None}


def realize_report(budget: Budget, notebook_id: str, packet: dict, exchange_id: str) -> dict:
    """report is asynchronous: generate --wait polls to completion, then a
    separate download step is the only documented way to retrieve the
    markdown body (notebooklm-py's own generate-outcome JSON carries
    task_id/status/url, never the report text itself — see
    notebooklm.cli.generate_cmd._output_generation_outcome). --format custom
    with the packet's own prompt as the positional DESCRIPTION, per
    data/SKILL.md's own note that --append is ignored under --format custom."""
    run_cli(
        budget, "generate", "report", packet["prompt"],
        "--format", "custom", "--notebook", notebook_id, "--wait",
    )
    md_path = EXCHANGES_DIR / f"{exchange_id}.report.md"
    EXCHANGES_DIR.mkdir(parents=True, exist_ok=True)
    body = run_cli_to_file(
        budget, "download", "report", str(md_path), "--notebook", notebook_id,
        expect_file=md_path,
    )
    payload = {"format": "markdown", "body": body}
    ok, errors = validate_against_schema("emsenn/schema/gemini-notebook-report-artifact", payload)
    if not ok:
        raise ExchangeAborted(
            "the generated report does not validate against "
            "emsenn/schema/gemini-notebook-report-artifact: " + "; ".join(errors),
            ["artifact-failed-its-own-class-validation"],
        )
    return {"payload": payload, "schema": "emsenn/schema/gemini-notebook-report-artifact",
            "companion_text": str(md_path)}


def _parse_code_answer(answer: str) -> dict:
    """Admit exactly one JSON object, tolerating only Gemini Notebook's common
    single fenced-JSON presentation. Prose around the carrier is a refusal,
    never guessed into code."""
    candidate = answer.strip()
    if candidate.startswith("```json") and candidate.endswith("```"):
        candidate = candidate[len("```json"):-len("```")].strip()
    try:
        value = json.loads(candidate)
    except json.JSONDecodeError as error:
        raise ExchangeAborted(
            f"Gemini Notebook code response was not one JSON object: {error}",
            ["code-response-is-not-json"],
        )
    if not isinstance(value, dict):
        raise ExchangeAborted(
            "Gemini Notebook code response was JSON but not an object",
            ["code-response-is-not-a-json-object"],
        )
    return value


def realize_code(budget: Budget, notebook_id: str, packet: dict,
                 exchange_id: str) -> dict:
    """Ask the newly created, source-grounded notebook for code carried in
    JSON. The provider retains the proposal; it never writes a receiving
    repository and never claims that authored code passed assay."""
    carrier_contract = """

Return ONLY one JSON object, with no prose outside it and no Markdown fence:
{"files":[{"path":"receiver-relative/path","language":"language-name","content":"complete file bytes"}],"summary":"short explanation"}
Every path must be relative, must not contain '..' traversal segments, and every
file must contain complete proposed content. Do not claim the code was tested,
approved, installed, released, or activated.
""".strip()
    generated = run_cli(
        budget, "ask", f"{packet['prompt'].rstrip()}\n\n{carrier_contract}",
        "--notebook", notebook_id,
    )
    answer = generated.get("answer")
    if not isinstance(answer, str) or not answer.strip():
        raise ExchangeAborted(
            "gemini-notebook ask returned no code answer",
            ["empty-code-generation-result"],
        )
    authored = _parse_code_answer(answer)
    payload = {
        "format": "json-code-bundle",
        "files": authored.get("files"),
        "summary": authored.get("summary"),
        "assayRequired": True,
    }
    paths = [
        row.get("path") for row in payload["files"]
        if isinstance(row, dict) and isinstance(row.get("path"), str)
    ] if isinstance(payload["files"], list) else []
    if len(paths) != len(set(paths)):
        raise ExchangeAborted(
            "Gemini Notebook code response proposed the same receiver path more than once",
            ["code-response-has-duplicate-paths"],
        )
    ok, errors = validate_against_schema(
        "emsenn/schema/gemini-notebook-code-artifact", payload
    )
    if not ok:
        raise ExchangeAborted(
            "the generated code proposal does not validate against "
            "emsenn/schema/gemini-notebook-code-artifact: " + "; ".join(errors),
            ["artifact-failed-its-own-class-validation"],
        )
    return {
        "payload": payload,
        "schema": "emsenn/schema/gemini-notebook-code-artifact",
        "companion_text": None,
    }


def realize_json(budget: Budget, notebook_id: str, packet: dict,
                 exchange_id: str) -> dict:
    """Buy one schema-bound JSON product from the grounded notebook.

    Gemini Notebook is trusted here only for carrier formation. The provider still
    parses exactly one JSON object and independently validates its `data`
    member against the consumer-bound, already-seated Union schema.
    """
    result_schema = packet["result-schema"]
    carrier_contract = f"""

Return ONLY one JSON object, with no prose outside it and no Markdown fence:
{{"data":<one JSON value conforming to {result_schema}>,"summary":"short source-grounded explanation"}}
Do not claim the data was accepted, verified, installed,
released, or activated. The receiving actor will validate it independently.
""".strip()
    generated = run_cli(
        budget, "ask", f"{packet['prompt'].rstrip()}\n\n{carrier_contract}",
        "--notebook", notebook_id,
    )
    answer = generated.get("answer")
    if not isinstance(answer, str) or not answer.strip():
        raise ExchangeAborted(
            "gemini-notebook ask returned no JSON answer",
            ["empty-json-generation-result"],
        )
    authored = _parse_code_answer(answer)
    if "data" not in authored:
        raise ExchangeAborted(
            "Gemini Notebook JSON response omitted its data member",
            ["json-response-lacks-data"],
        )
    if not isinstance(authored.get("summary"), str) or not authored["summary"].strip():
        raise ExchangeAborted(
            "Gemini Notebook JSON response omitted its non-empty summary",
            ["json-response-lacks-summary"],
        )
    ok, errors = validate_against_schema(result_schema, authored["data"])
    if not ok:
        raise ExchangeAborted(
            f"the generated JSON does not validate against {result_schema}: "
            + "; ".join(str(error) for error in errors),
            ["json-data-failed-consumer-bound-schema-validation"],
        )
    payload = {
        "format": "json",
        "resultSchema": result_schema,
        "data": authored["data"],
        "summary": authored["summary"],
        "assayRequired": True,
    }
    ok, errors = validate_against_schema(
        "emsenn/schema/gemini-notebook-json-artifact", payload
    )
    if not ok:
        raise ExchangeAborted(
            "the generated JSON carrier does not validate against "
            "emsenn/schema/gemini-notebook-json-artifact: " + "; ".join(str(error) for error in errors),
            ["artifact-failed-its-own-class-validation"],
        )
    return {
        "payload": payload,
        "schema": "emsenn/schema/gemini-notebook-json-artifact",
        "companion_text": None,
    }


def realize_data_table(budget: Budget, notebook_id: str, packet: dict,
                       exchange_id: str) -> dict:
    """Generate Gemini Notebook's native data-table artifact and retain exact CSV.

    The opaque provider may use Python internally; this boundary makes no
    claim about or attempt to execute that hidden program. It validates only
    the CSV product that actually crosses the membrane.
    """
    generated = run_cli(
        budget, "generate", "data-table", packet["prompt"],
        "--notebook", notebook_id, "--wait",
    )
    artifact = generated.get("artifact") if isinstance(generated.get("artifact"), dict) else {}
    artifact_id = (
        generated.get("artifact_id") or generated.get("artifactId")
        or generated.get("task_id") or generated.get("taskId")
        or generated.get("id") or artifact.get("id")
    )
    csv_path = EXCHANGES_DIR / f"{exchange_id}.data-table.csv"
    EXCHANGES_DIR.mkdir(parents=True, exist_ok=True)
    args = ["download", "data-table", str(csv_path), "--notebook", notebook_id]
    if isinstance(artifact_id, str) and artifact_id:
        args.extend(["--artifact", artifact_id])
    proc = _run_gemini_notebook(budget, args, json_flag=True)
    if proc.returncode != 0 or not csv_path.is_file():
        raise ExchangeAborted(
            "gemini-notebook download data-table did not produce a CSV: "
            f"{_cli_failure_detail(proc)[:500]}",
            ["cli-download-failure: data-table"],
        )
    data = csv_path.read_bytes()
    if not data or len(data) > MAX_DATA_TABLE_BYTES:
        raise ExchangeAborted(
            "Gemini Notebook data table was empty or exceeded the 10 MiB carrier bound",
            ["data-table-size-out-of-bounds"],
        )
    try:
        text = data.decode("utf-8-sig")
        rows = list(csv.reader(io.StringIO(text, newline=""), strict=True))
    except (UnicodeDecodeError, csv.Error) as error:
        raise ExchangeAborted(
            f"Gemini Notebook data table was not strict UTF-8 CSV: {error}",
            ["data-table-is-not-strict-utf8-csv"],
        )
    if not rows or not rows[0] or len(rows) > MAX_DATA_TABLE_ROWS + 1:
        raise ExchangeAborted(
            "Gemini Notebook data table lacked a header or exceeded the row bound",
            ["data-table-row-count-out-of-bounds"],
        )
    header = rows[0]
    if len(header) > MAX_DATA_TABLE_COLUMNS or any(not cell.strip() for cell in header) or len(set(header)) != len(header):
        raise ExchangeAborted(
            "Gemini Notebook data table header was empty, duplicated, or exceeded the column bound",
            ["data-table-header-invalid"],
        )
    if any(len(row) != len(header) for row in rows[1:]):
        raise ExchangeAborted(
            "Gemini Notebook data table contained a row whose width differed from its header",
            ["data-table-row-width-mismatch"],
        )
    formula_like = sum(
        1 for row in rows[1:] for cell in row
        if cell.lstrip().startswith(("=", "+", "-", "@"))
    )
    payload = {
        "format": "csv",
        "mediaType": "text/csv",
        "byteLength": len(data),
        "sha256": f"sha256:{hashlib.sha256(data).hexdigest()}",
        "rowCount": len(rows) - 1,
        "columnCount": len(header),
        "header": header,
        "formulaLikeCellCount": formula_like,
        "assayRequired": True,
        "providerArtifactId": artifact_id if isinstance(artifact_id, str) and artifact_id else None,
    }
    ok, errors = validate_against_schema(
        "emsenn/schema/gemini-notebook-data-table-artifact", payload
    )
    if not ok:
        raise ExchangeAborted(
            "the generated CSV metadata does not validate against "
            "emsenn/schema/gemini-notebook-data-table-artifact: " + "; ".join(str(error) for error in errors),
            ["artifact-failed-its-own-class-validation"],
        )
    metadata_path = EXCHANGES_DIR / f"{exchange_id}.data-table.json"
    metadata_path.write_text(json.dumps(payload, indent=2) + "\n")
    return {
        "payload": payload,
        "schema": "emsenn/schema/gemini-notebook-data-table-artifact",
        "artifact_path": str(csv_path),
        "companion_text": str(metadata_path),
    }


def realize_infographic(budget: Budget, notebook_id: str, packet: dict,
                        exchange_id: str) -> dict:
    """Generate Gemini Notebook's native infographic and retain the PNG itself as
    the contracted artifact. The JSON sidecar is evidence about the bytes,
    not a substitute for the Leader-facing visual."""
    run_cli(
        budget, "generate", "infographic", packet["prompt"],
        "--orientation", "portrait", "--detail", "detailed",
        "--style", "scientific", "--notebook", notebook_id, "--wait",
    )
    png_path = EXCHANGES_DIR / f"{exchange_id}.infographic.png"
    EXCHANGES_DIR.mkdir(parents=True, exist_ok=True)
    proc = _run_gemini_notebook(
        budget,
        ["download", "infographic", str(png_path), "--notebook", notebook_id],
        json_flag=True,
    )
    if proc.returncode != 0 or not png_path.is_file():
        raise ExchangeAborted(
            "gemini-notebook download infographic did not produce a PNG: "
            f"{_cli_failure_detail(proc)[:500]}",
            ["cli-download-failure: infographic"],
        )
    data = png_path.read_bytes()
    if not data.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ExchangeAborted(
            "Gemini Notebook infographic download did not carry a PNG signature",
            ["artifact-failed-its-own-class-validation"],
        )
    payload = {
        "format": "png",
        "mediaType": "image/png",
        "byteLength": len(data),
        "sha256": f"sha256:{hashlib.sha256(data).hexdigest()}",
    }
    ok, errors = validate_against_schema(
        "emsenn/schema/gemini-notebook-infographic-artifact", payload
    )
    if not ok:
        raise ExchangeAborted(
            "the generated infographic does not validate against "
            "emsenn/schema/gemini-notebook-infographic-artifact: " + "; ".join(errors),
            ["artifact-failed-its-own-class-validation"],
        )
    metadata_path = EXCHANGES_DIR / f"{exchange_id}.infographic.json"
    metadata_path.write_text(json.dumps(payload, indent=2) + "\n")
    return {
        "payload": payload,
        "schema": "emsenn/schema/gemini-notebook-infographic-artifact",
        "artifact_path": str(png_path),
        "companion_text": None,
    }


def realize_audio(budget: Budget, notebook_id: str, packet: dict,
                  exchange_id: str) -> dict:
    """Generate and retain Gemini Notebook's audio overview as an MP3 artifact.

    The service validates the downloaded carrier itself. A successful
    generation-status envelope is evidence that Google accepted the job; it
    is not evidence that a usable audio file exists.
    """
    run_cli(
        budget, "generate", "audio", packet["prompt"],
        "--format", "brief", "--length", "short",
        "--notebook", notebook_id, "--wait",
    )
    audio_path = EXCHANGES_DIR / f"{exchange_id}.audio.mp3"
    EXCHANGES_DIR.mkdir(parents=True, exist_ok=True)
    proc = _run_gemini_notebook(
        budget,
        ["download", "audio", str(audio_path), "--notebook", notebook_id],
        json_flag=True,
    )
    if proc.returncode != 0 or not audio_path.is_file():
        raise ExchangeAborted(
            "gemini-notebook download audio did not produce an MP3: "
            f"{_cli_failure_detail(proc)[:500]}",
            ["cli-download-failure: audio"],
        )
    data = audio_path.read_bytes()
    has_id3 = data.startswith(b"ID3")
    has_mpeg_frame = len(data) >= 2 and data[0] == 0xFF and (data[1] & 0xE0) == 0xE0
    if len(data) < 16 or not (has_id3 or has_mpeg_frame):
        raise ExchangeAborted(
            "Gemini Notebook audio download did not carry an MP3 signature",
            ["artifact-failed-its-own-class-validation"],
        )
    payload = {
        "format": "mp3",
        "mediaType": "audio/mpeg",
        "byteLength": len(data),
        "sha256": f"sha256:{hashlib.sha256(data).hexdigest()}",
    }
    ok, errors = validate_against_schema(
        "emsenn/schema/gemini-notebook-audio-artifact", payload
    )
    if not ok:
        raise ExchangeAborted(
            "the generated audio does not validate against "
            "emsenn/schema/gemini-notebook-audio-artifact: " + "; ".join(errors),
            ["artifact-failed-its-own-class-validation"],
        )
    metadata_path = EXCHANGES_DIR / f"{exchange_id}.audio.json"
    metadata_path.write_text(json.dumps(payload, indent=2) + "\n")
    return {
        "payload": payload,
        "schema": "emsenn/schema/gemini-notebook-audio-artifact",
        "artifact_path": str(audio_path),
        "companion_text": None,
    }


def realize_video(budget: Budget, notebook_id: str, packet: dict,
                  exchange_id: str) -> dict:
    """Generate and retain one exact Gemini Notebook Video Overview MP4.

    The returned provider artifact identity is passed to download explicitly;
    this operation never means "download whichever video is latest" on a
    persistent notebook that may serve more than one customer.
    """
    options = packet["video-options"]
    args = [
        "generate", "video", packet["prompt"],
        "--format", options["format"],
        "--language", options["language"],
        "--notebook", notebook_id,
        "--wait",
    ]
    if options["format"] == "explainer":
        args.extend(["--style", options["style"]])
    generated = run_cli(budget, *args)
    artifact = generated.get("artifact") if isinstance(generated.get("artifact"), dict) else {}
    artifact_id = (
        generated.get("artifact_id") or generated.get("artifactId")
        or generated.get("task_id") or generated.get("taskId")
        or generated.get("id") or artifact.get("id")
    )
    if not isinstance(artifact_id, str) or not artifact_id:
        raise ExchangeAborted(
            "gemini-notebook generate video returned no exact artifact identity",
            ["video-generation-result-lacks-artifact-identity"],
        )
    video_path = EXCHANGES_DIR / f"{exchange_id}.video.mp4"
    EXCHANGES_DIR.mkdir(parents=True, exist_ok=True)
    proc = _run_gemini_notebook(
        budget,
        ["download", "video", str(video_path), "--notebook", notebook_id,
         "--artifact", artifact_id],
        json_flag=True,
    )
    if proc.returncode != 0 or not video_path.is_file():
        raise ExchangeAborted(
            "gemini-notebook download video did not produce an MP4: "
            f"{_cli_failure_detail(proc)[:500]}",
            ["cli-download-failure: video"],
        )
    data = video_path.read_bytes()
    if len(data) < 12 or data[4:8] != b"ftyp":
        raise ExchangeAborted(
            "Gemini Notebook video download did not carry an ISO-BMFF ftyp signature",
            ["artifact-failed-its-own-class-validation"],
        )
    payload = {
        "format": "mp4",
        "mediaType": "video/mp4",
        "byteLength": len(data),
        "sha256": f"sha256:{hashlib.sha256(data).hexdigest()}",
        "videoFormat": options["format"],
        "videoStyle": options["style"],
        "language": options["language"],
        "providerArtifactId": artifact_id,
    }
    ok, errors = validate_against_schema(
        "emsenn/schema/gemini-notebook-video-artifact", payload
    )
    if not ok:
        raise ExchangeAborted(
            "the generated video does not validate against "
            "emsenn/schema/gemini-notebook-video-artifact: " + "; ".join(errors),
            ["artifact-failed-its-own-class-validation"],
        )
    metadata_path = EXCHANGES_DIR / f"{exchange_id}.video.json"
    metadata_path.write_text(json.dumps(payload, indent=2) + "\n")
    return {
        "payload": payload,
        "schema": "emsenn/schema/gemini-notebook-video-artifact",
        "artifact_path": str(video_path),
        "companion_text": str(metadata_path),
    }


REALIZERS = {
    "mind-map": realize_mind_map,
    "report": realize_report,
    "infographic": realize_infographic,
    "audio": realize_audio,
    "video": realize_video,
    "code": realize_code,
    "json": realize_json,
    "data-table": realize_data_table,
}


def content_id(body: dict) -> str:
    result = subprocess.run(
        ["node", str(UNIT_ROOT / "src" / "identify-json-content.mjs")],
        input=json.dumps(body, separators=(",", ":")),
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout.strip()


def content_key(token: str) -> str:
    return token.removeprefix("ni:///sha-256;")


def record_cleanup_intent(exchange_id: str, notebook_id: str) -> dict:
    body = {
        "type": "GeminiNotebookEphemeralNotebookCleanupIntent",
        "exchangeId": exchange_id,
        "notebookId": notebook_id,
        "policy": "delete-after-local-artifact-or-refusal-is-seated",
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    record = {"id": content_id(body), **body}
    directory = UNIT_ROOT / "data" / "ephemeral-notebook-cleanup-intents"
    directory.mkdir(parents=True, exist_ok=True)
    (directory / f"{content_key(record['id'])}.json").write_text(
        json.dumps(record, indent=2) + "\n"
    )
    return record


def cleanup_ephemeral_notebook(exchange_id: str, lifecycle: dict,
                               seated_path: Path | None,
                               upload_dir: Path) -> dict | None:
    """Delete only the exact notebook this exchange created.

    The intent is written immediately after creation, so a process crash is a
    recoverable leak rather than invisible clutter. Final cleanup happens only
    after the local artifact/refusal record is durably seated.
    """
    notebook_id = lifecycle.get("notebook_id")
    shutil.rmtree(upload_dir, ignore_errors=True)
    if not lifecycle.get("ephemeral") or not isinstance(notebook_id, str):
        return None
    attempted_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    proc = subprocess.run(
        [*GEMINI_NOTEBOOK_COMMAND, "delete", "--notebook", notebook_id, "--yes", "--json"],
        capture_output=True, text=True,
    )
    deleted = proc.returncode == 0
    diagnostic = None if deleted else _cli_failure_detail(proc)[:500]
    body = {
        "type": "GeminiNotebookEphemeralNotebookCleanupReceipt",
        "exchangeId": exchange_id,
        "notebookId": notebook_id,
        "cleanupIntent": (lifecycle.get("cleanup_intent") or {}).get("id"),
        "artifactOrRefusalSeated": seated_path is not None,
        "seatedPath": str(seated_path) if seated_path is not None else None,
        "localUploadCopiesDeleted": not upload_dir.exists(),
        "disposition": "deleted" if deleted else "cleanup-refused",
        "leakedNotebook": not deleted,
        "diagnostic": diagnostic,
        "attemptedAt": attempted_at,
    }
    record = {"id": content_id(body), **body}
    directory = UNIT_ROOT / "data" / "ephemeral-notebook-cleanup-receipts"
    directory.mkdir(parents=True, exist_ok=True)
    (directory / f"{content_key(record['id'])}.json").write_text(
        json.dumps(record, indent=2) + "\n"
    )
    return record


def realize_exchange(packet: dict, budget: Budget, exchange_id: str,
                      upload_dir: Path, lifecycle: dict) -> dict:
    """The move: create -> add sources -> wait -> generate -> validate.
    Raises ExchangeAborted on any failure; the caller turns that into a
    refusal record. Never called in --dry-run."""
    artifact_type = packet["artifact-type"]
    if artifact_type not in SUPPORTED_ARTIFACT_TYPES:
        raise ExchangeAborted(
            f"artifact-type '{artifact_type}' has no seated per-type class yet — "
            f"this service currently backs {sorted(SUPPORTED_ARTIFACT_TYPES)} only",
            ["artifact-type-not-yet-backed-by-a-seated-class"],
        )

    auth = check_auth_presence()
    if not auth_present(auth):
        raise ExchangeAborted(
            "no Google auth material present (no storage_state.json, no "
            "NOTEBOOKLM_AUTH_JSON) — the provider cannot exercise a Google "
            "session unless its custodian makes one available",
            ["google-auth-material-absent"],
        )

    conversions = []
    notebook_context = packet.get("notebook-context")
    if notebook_context:
        notebook_id = notebook_context["notebookId"]
        observed = run_cli(budget, "source", "list", "--notebook", notebook_id)
        rows = observed.get("sources")
        if not isinstance(rows, list) or any(not isinstance(row, dict) or not isinstance(row.get("id"), str) for row in rows):
            raise ExchangeAborted(
                "stable notebook source observation did not return source rows with IDs",
                ["stable-notebook-source-observation-invalid"],
            )
        observed_ids = sorted(row["id"] for row in rows)
        expected_ids = sorted(notebook_context["finalSourceIds"])
        observed_digest = "sha256:" + hashlib.sha256(
            json.dumps(observed_ids, separators=(",", ":")).encode()
        ).hexdigest()
        if observed_ids != expected_ids or observed_digest != notebook_context["finalSourceSetDigest"]:
            raise ExchangeAborted(
                "stable notebook source IDs no longer match the successful reconciliation receipt",
                ["stable-notebook-source-set-changed-after-reconciliation"],
            )
        if any(row.get("status") != "ready" for row in rows):
            raise ExchangeAborted(
                "stable notebook contains a source that is not ready",
                ["stable-notebook-source-not-ready"],
            )
    else:
        title = f"gemini-notebook-service-exchange {packet['prompt'][:60]}"
        created = run_cli(budget, "create", title)
        notebook_id = created["notebook"]["id"]
        lifecycle["ephemeral"] = True
        lifecycle["notebook_id"] = notebook_id
        lifecycle["cleanup_intent"] = record_cleanup_intent(exchange_id, notebook_id)
        for source in packet["sources"]:
            upload_path, note = prepare_source_for_upload(source, upload_dir)
            if note:
                conversions.append(note)
            added = run_cli(budget, "source", "add", upload_path, "--notebook", notebook_id)
            source_id = added["source"]["id"]
            run_cli(budget, "source", "wait", source_id, "--notebook", notebook_id)

    result = REALIZERS[artifact_type](budget, notebook_id, packet, exchange_id) if artifact_type in {"report", "infographic", "audio", "video", "code", "json", "data-table"} \
        else REALIZERS[artifact_type](budget, notebook_id)
    result["notebook_id"] = notebook_id
    result["source_receipt_id"] = notebook_context.get("sourceReceiptId") if notebook_context else None
    result["source_conversions"] = conversions
    return result


# ── record assembly ─────────────────────────────────────────────────────

def cost_block(budget: Budget) -> dict:
    return {
        "fuel-consumed": budget.calls,
        "wall-time-seconds": round(budget.elapsed(), 3),
        "denomination": "gemini-notebook-cli-invocations",
    }


def build_exchange_record(exchange_id: str, packet: dict, budget: Budget,
                           outcome: str, *, artifact: dict | None = None,
                           refusal: dict | None = None) -> dict:
    record = {
        "id": exchange_id,
        "packet": packet,
        "outcome": outcome,
        "cost": cost_block(budget),
    }
    if outcome == "artifact":
        record["artifact"] = artifact
    else:
        record["refusal"] = refusal
    return record


def seat_or_abort(record: dict) -> Path:
    """The one gate every record passes before it touches disk: re-validate
    against emsenn/schema/exchange via read-a-schema.js. A record that fails
    is never seated — printed to stderr and the process exits non-zero,
    which is the one acceptable 'no record' state, and it is loud about it."""
    ok, errors = validate_against_schema("emsenn/schema/exchange", record)
    if not ok:
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": "the exchange record this harness built does not validate "
                    "against emsenn/schema/exchange — refusing to seat it",
                    "schema-errors": errors,
                    "record": record,
                },
                indent=2,
            ),
            file=sys.stderr,
        )
        sys.exit(1)
    EXCHANGES_DIR.mkdir(parents=True, exist_ok=True)
    path = EXCHANGES_DIR / f"{record['id']}.json"
    path.write_text(json.dumps(record, indent=2) + "\n")
    return path


def write_artifact_payload(exchange_id: str, artifact_type: str, payload: dict) -> str:
    """Writes the JSON payload that gets validated against the artifact's own
    type class and pointed at by the exchange record's artifact.path. For
    report, realize_report has ALSO already written a companion plain .md
    file (readable without unwrapping JSON) at content/exchanges/<id>.report.md
    — this is the validated record of it, not a duplicate of that human copy."""
    suffix = {"mind-map": "mind-map", "report": "report", "code": "code", "json": "json"}[artifact_type]
    path = EXCHANGES_DIR / f"{exchange_id}.{suffix}.json"
    EXCHANGES_DIR.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n")
    return str(path)


# ── main ─────────────────────────────────────────────────────────────────

def main() -> None:
    args = sys.argv[1:]
    dry_run = "--dry-run" in args
    positional = [a for a in args if a != "--dry-run"]
    if not positional:
        die("usage: run-one-exchange.py <packet.json> [--dry-run]", code=2)
    packet_path = positional[0]

    packet = load_and_validate_packet(packet_path)

    if dry_run:
        auth = check_auth_presence()
        print(json.dumps({
            "ok": True,
            "dry-run": True,
            "packet-valid": True,
            "auth-presence": auth,
            "seated": None,
            "note": "no exchange record written; no network call made",
        }, indent=2))
        return

    budget = Budget()
    exchange_id = f"exchange-{time.strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:6]}"
    upload_dir = Path(packet_path).resolve().parent / "upload-copies" / exchange_id
    artifact_type = packet["artifact-type"]
    record_packet = normalize_packet_for_record(packet)
    lifecycle = {"ephemeral": False, "notebook_id": None, "cleanup_intent": None}

    try:
        result = realize_exchange(packet, budget, exchange_id, upload_dir, lifecycle)
    except ExchangeAborted as e:
        record = build_exchange_record(
            exchange_id, record_packet, budget, "refusal",
            refusal={"grounds": e.grounds, "unmet": e.unmet},
        )
        seated = seat_or_abort(record)
        cleanup = cleanup_ephemeral_notebook(exchange_id, lifecycle, seated, upload_dir)
        print(json.dumps({"ok": True, "seated": str(seated), "outcome": "refusal", "record": record, "ephemeral_cleanup": cleanup}, indent=2))
        return
    except Exception as e:  # noqa: BLE001 — total correctness: nothing escapes unrecorded
        record = build_exchange_record(
            exchange_id, record_packet, budget, "refusal",
            refusal={
                "grounds": f"unexpected exception: {type(e).__name__}: {e}",
                "unmet": ["unhandled-exception"],
            },
        )
        seated = seat_or_abort(record)
        cleanup = cleanup_ephemeral_notebook(exchange_id, lifecycle, seated, upload_dir)
        print(json.dumps({"ok": True, "seated": str(seated), "outcome": "refusal", "record": record, "ephemeral_cleanup": cleanup}, indent=2))
        return

    artifact_path = result.get("artifact_path") or write_artifact_payload(
        exchange_id, artifact_type, result["payload"]
    )
    record = build_exchange_record(
        exchange_id, record_packet, budget, "artifact",
        artifact={
            "type": artifact_type,
            "path": artifact_path,
            **({"payload": result["payload"]} if artifact_type == "video" else {}),
        },
    )
    seated = seat_or_abort(record)
    cleanup = cleanup_ephemeral_notebook(exchange_id, lifecycle, seated, upload_dir)
    print(json.dumps({
        "ok": True,
        "seated": str(seated),
        "outcome": "artifact",
        "record": record,
        "notebook_id": result.get("notebook_id"),
        "companion_text_path": result.get("companion_text"),
        "source_conversions": result.get("source_conversions", []),
        "source_receipt_id": result.get("source_receipt_id"),
        "ephemeral_cleanup": cleanup,
    }, indent=2))


if __name__ == "__main__":
    main()
