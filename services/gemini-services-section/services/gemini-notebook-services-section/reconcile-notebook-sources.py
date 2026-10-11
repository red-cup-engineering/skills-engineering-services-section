#!/usr/bin/env python3
"""Observe or reconcile one stable Gemini notebook's source set.

The operation is deliberately separate from artifact generation.  A caller
first observes the current source IDs, then accepts a replacement contract
bound to that exact precondition.  Replacement stages and verifies every new
source before deleting any prior source, and settles from a final source-list
observation rather than from mutation-command exit codes.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone


NODE_ID = "notebooklm-inference-team"
SOURCE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{5,}$")
MAX_SOURCES = 50
MAX_SOURCE_BYTES = 10 * 1024 * 1024
MAX_TOTAL_BYTES = 50 * 1024 * 1024


class ReconciliationFailure(RuntimeError):
    def __init__(self, message: str, stage: str):
        super().__init__(message)
        self.stage = stage


def canonical(value) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def digest(value) -> str:
    return "sha256:" + hashlib.sha256(canonical(value).encode()).hexdigest()


def raw_digest(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            hasher.update(block)
    return "sha256:" + hasher.hexdigest()


def instant(value: str | None = None) -> str:
    return value or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


class GeminiNotebook:
    def __init__(self):
        self.started = time.monotonic()
        self.calls = 0

    def elapsed(self) -> float:
        return round(time.monotonic() - self.started, 3)

    def run(self, *args: str) -> dict:
        self.calls += 1
        command = [sys.executable, "-m", "notebooklm", *args, "--json"]
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            env=os.environ.copy(),
        )
        if result.returncode != 0:
            diagnostic = result.stderr.strip() or result.stdout.strip()
            try:
                payload = json.loads(result.stdout)
                if isinstance(payload, dict) and payload.get("error"):
                    diagnostic = str(payload.get("message") or payload)
            except json.JSONDecodeError:
                pass
            raise ReconciliationFailure(
                f"Gemini Notebook command failed ({result.returncode}): {diagnostic[:500]}",
                "cli-failure",
            )
        try:
            payload = json.loads(result.stdout)
        except json.JSONDecodeError as error:
            raise ReconciliationFailure(
                f"Gemini Notebook returned non-JSON output: {result.stdout[:500]!r}",
                "cli-output",
            ) from error
        if not isinstance(payload, dict):
            raise ReconciliationFailure("Gemini Notebook returned a non-object JSON value", "cli-output")
        return payload


def normalized_sources(payload: dict) -> list[dict]:
    rows = payload.get("sources")
    if not isinstance(rows, list):
        raise ReconciliationFailure("source list has no sources array", "observe")
    normalized = []
    for row in rows:
        if not isinstance(row, dict) or not isinstance(row.get("id"), str):
            raise ReconciliationFailure("source list contains a row without an ID", "observe")
        normalized.append(
            {
                "id": row["id"],
                "title": row.get("title"),
                "status": row.get("status", "unknown"),
                "type": row.get("type"),
                "url": row.get("url"),
            }
        )
    return sorted(normalized, key=lambda row: row["id"])


def observe(client: GeminiNotebook, notebook_id: str) -> list[dict]:
    return normalized_sources(client.run("source", "list", "--notebook", notebook_id))


def source_ids(rows: list[dict]) -> list[str]:
    return sorted(row["id"] for row in rows)


def validate_plan(plan: object) -> list[str]:
    if not isinstance(plan, dict):
        return ["plan must be an object"]
    problems: list[str] = []
    mode = plan.get("executionMode")
    if mode not in {"dry-run", "observe-live", "reconcile-live"}:
        problems.append("executionMode must be dry-run, observe-live, or reconcile-live")
    if not isinstance(plan.get("notebookId"), str) or not plan["notebookId"].strip():
        problems.append("notebookId must be a non-empty string")
    expected = plan.get("expectedCurrentSourceIds")
    if mode == "reconcile-live":
        if not isinstance(expected, list) or any(not isinstance(item, str) or not SOURCE_ID.match(item) for item in expected):
            problems.append("reconcile-live requires expectedCurrentSourceIds containing full source IDs")
        elif len(set(expected)) != len(expected):
            problems.append("expectedCurrentSourceIds must not contain duplicates")
    desired = plan.get("desiredSources")
    if mode in {"dry-run", "reconcile-live"}:
        if not isinstance(desired, list) or not desired:
            problems.append("dry-run and reconcile-live require at least one desired source")
        else:
            if len(desired) > MAX_SOURCES:
                problems.append(f"desiredSources may contain at most {MAX_SOURCES} sources")
            identities = [canonical({"digest": source.get("digest"), "title": source.get("title")}) if isinstance(source, dict) else None for source in desired]
            if len(set(identities)) != len(identities):
                problems.append("desiredSources digest/title identities must be unique")
            total_bytes = 0
            for index, source in enumerate(desired):
                if not isinstance(source, dict):
                    problems.append(f"desiredSources[{index}] must be an object")
                    continue
                path_value = source.get("path")
                if not isinstance(path_value, str) or not Path(path_value).is_absolute():
                    problems.append(f"desiredSources[{index}].path must be absolute")
                    continue
                path = Path(path_value)
                if path.is_symlink() or not path.is_file():
                    problems.append(f"desiredSources[{index}].path must name a regular non-symlink file")
                elif path.stat().st_size > MAX_SOURCE_BYTES:
                    problems.append(f"desiredSources[{index}] exceeds the {MAX_SOURCE_BYTES}-byte ceiling")
                else:
                    total_bytes += path.stat().st_size
                expected_digest = source.get("digest")
                if not isinstance(expected_digest, str) or not re.fullmatch(r"sha256:[a-f0-9]{64}", expected_digest):
                    problems.append(f"desiredSources[{index}].digest must be a sha256 digest")
                elif path.is_file() and not path.is_symlink() and raw_digest(path) != expected_digest:
                    problems.append(f"desiredSources[{index}] digest does not match its file")
            if total_bytes > MAX_TOTAL_BYTES:
                problems.append(f"desiredSources exceed the {MAX_TOTAL_BYTES}-byte total ceiling")
    if mode == "observe-live" and plan.get("policy") != "observe-only":
        problems.append("observe-live requires policy observe-only")
    if mode in {"dry-run", "reconcile-live"} and plan.get("policy") not in {"replace-all-staged", "curated-cumulative-add"}:
        problems.append("dry-run and reconcile-live require policy replace-all-staged or curated-cumulative-add")
    return problems


def public_desired(source: dict, source_id: str | None = None) -> dict:
    value = {"digest": source["digest"], "title": source.get("title") or Path(source["path"]).name}
    if source_id:
        value["sourceId"] = source_id
    return value


def bound_title(source: dict) -> str:
    title = source.get("title") or Path(source["path"]).name
    return f"SHUOC {source['digest']} {title}"[:180]


def add_source(client: GeminiNotebook, notebook_id: str, source: dict, index: int, staging: Path) -> str:
    original = Path(source["path"])
    staged = staging / f"{index:03d}-{source['digest'][7:23]}.txt"
    staged.write_bytes(original.read_bytes())
    title = bound_title(source)
    added = client.run(
        "source", "add", str(staged), "--type", "file", "--mime-type", "text/plain",
        "--title", title, "--notebook", notebook_id,
    )
    row = added.get("source")
    source_id = row.get("id") if isinstance(row, dict) else None
    if not isinstance(source_id, str) or not SOURCE_ID.match(source_id):
        raise ReconciliationFailure("source add returned no stable source ID", "stage-add")
    client.run("source", "wait", source_id, "--notebook", notebook_id)
    return source_id


def delete_source(client: GeminiNotebook, notebook_id: str, source_id: str) -> None:
    result = client.run("source", "delete", source_id, "--notebook", notebook_id, "--yes")
    if result.get("success") is not True or result.get("status") != "deleted":
        raise ReconciliationFailure(f"delete of {source_id} was not acknowledged", "delete-old")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("plan")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--now")
    args = parser.parse_args()
    try:
        plan = json.loads(Path(args.plan).read_text())
    except (OSError, json.JSONDecodeError) as error:
        print(json.dumps({"ok": False, "error": f"invalid plan: {error}"}))
        return 2
    problems = validate_plan(plan)
    if problems:
        print(json.dumps({"ok": False, "error": "invalid plan", "problems": problems}))
        return 2
    mode = plan["executionMode"]
    if args.dry_run != (mode == "dry-run"):
        print(json.dumps({"ok": False, "error": "dry-run flag and executionMode disagree"}))
        return 2
    if mode == "dry-run":
        print(json.dumps({"ok": True, "outcome": "ready", "networkCalls": 0, "recordsWritten": 0}))
        return 0

    at = instant(args.now)
    client = GeminiNotebook()
    previous: list[dict] = []
    added: list[dict] = []
    reused: list[dict] = []
    preserved: list[str] = []
    deleted: list[str] = []
    final: list[dict] = []
    outcome = "refusal"
    grounds: str | None = None
    failure_stage: str | None = None
    try:
        previous = observe(client, plan["notebookId"])
        if mode == "observe-live":
            outcome = "observed"
            final = previous
            preserved = source_ids(previous)
        else:
            expected = sorted(plan["expectedCurrentSourceIds"])
            if source_ids(previous) != expected:
                raise ReconciliationFailure(
                    "observed source IDs do not match the accepted precondition",
                    "precondition",
                )
            cumulative = plan["policy"] == "curated-cumulative-add"
            preserved = expected.copy() if cumulative else []
            previous_by_title: dict[str, list[dict]] = {}
            for row in previous:
                previous_by_title.setdefault(str(row.get("title")), []).append(row)
            with tempfile.TemporaryDirectory(prefix="gemini-notebook-reconcile-") as directory:
                staging = Path(directory)
                try:
                    for index, source in enumerate(plan["desiredSources"], start=1):
                        if cumulative:
                            matches = previous_by_title.get(bound_title(source), [])
                            if len(matches) > 1:
                                raise ReconciliationFailure(
                                    "cumulative desired identity matches multiple incumbent sources",
                                    "cumulative-identity",
                                )
                            if len(matches) == 1:
                                if matches[0]["status"] != "ready":
                                    raise ReconciliationFailure(
                                        "cumulative desired identity is present but not ready",
                                        "cumulative-identity",
                                    )
                                reused.append(public_desired(source, matches[0]["id"]))
                                continue
                        added_id = add_source(client, plan["notebookId"], source, index, staging)
                        added.append(public_desired(source, added_id))
                except ReconciliationFailure:
                    # Best-effort compensation preserves the old source set when
                    # staging cannot complete.  Any failed compensation is made
                    # visible by the final observation and refusal receipt.
                    if not cumulative:
                        for row in reversed(added):
                            try:
                                delete_source(client, plan["notebookId"], row["sourceId"])
                            except ReconciliationFailure:
                                pass
                    raise
            staged = observe(client, plan["notebookId"])
            staged_by_id = {row["id"]: row for row in staged}
            if any(row["sourceId"] not in staged_by_id or staged_by_id[row["sourceId"]]["status"] != "ready" for row in added):
                raise ReconciliationFailure("not all staged sources are present and ready", "stage-verify")
            if not cumulative:
                for old_id in expected:
                    delete_source(client, plan["notebookId"], old_id)
                    deleted.append(old_id)
            final = observe(client, plan["notebookId"])
            required_final_ids = sorted(expected + [row["sourceId"] for row in added]) if cumulative else sorted(row["sourceId"] for row in added)
            if source_ids(final) != required_final_ids:
                raise ReconciliationFailure("final source set does not equal the policy-required source set", "final-verify")
            previous_by_id = {row["id"]: row for row in previous}
            unacceptable_non_ready = [
                row for row in final
                if row["status"] != "ready"
                and (
                    not cumulative
                    or row["id"] not in previous_by_id
                    or previous_by_id[row["id"]]["status"] == "ready"
                )
            ]
            if unacceptable_non_ready:
                raise ReconciliationFailure(
                    "final source set introduced or degraded a non-ready source",
                    "final-verify",
                )
            outcome = "reconciled"
    except ReconciliationFailure as error:
        grounds = str(error)
        failure_stage = error.stage
        try:
            final = observe(client, plan["notebookId"])
        except ReconciliationFailure:
            final = []

    receipt_body = {
        "type": "GeminiNotebookSourceReconciliationReceipt",
        "provider": f"urn:ame:{NODE_ID}",
        "notebookId": plan["notebookId"],
        "requestDigest": plan.get("requestDigest") or digest(plan),
        "mode": mode,
        "policy": plan["policy"],
        "outcome": outcome,
        "previousSources": previous,
        "previousSourceIds": source_ids(previous),
        "desiredSources": [public_desired(source) for source in plan.get("desiredSources", [])],
        "preservedSourceIds": preserved,
        "addedSources": added,
        "reusedDesiredSources": reused,
        "deletedSourceIds": deleted,
        "finalSources": final,
        "finalSourceIds": source_ids(final),
        "finalSourceSetDigest": digest(source_ids(final)),
        "grounds": grounds,
        "failureStage": failure_stage,
        "cost": {"denomination": "gemini-notebook-cli-call-and-wall-milliseconds", "calls": client.calls, "wallMilliseconds": round(client.elapsed() * 1000)},
        "settledAt": at,
    }
    if isinstance(plan.get("operationId"), str):
        receipt_body["operationId"] = plan["operationId"]
    receipt = {"id": f"urn:{digest(receipt_body)}", **receipt_body}
    print(json.dumps({"ok": True, "outcome": outcome, "receipt": receipt}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
