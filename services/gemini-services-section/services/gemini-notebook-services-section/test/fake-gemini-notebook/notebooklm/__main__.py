"""State-file fake for source-reconciliation contract tests only."""

import json
import os
from pathlib import Path
import sys


def option(args, name, default=None):
    try:
        return args[args.index(name) + 1]
    except ValueError:
        return default


path = Path(os.environ["FAKE_GEMINI_NOTEBOOK_STATE"])
state = json.loads(path.read_text())
args = [arg for arg in sys.argv[1:] if arg != "--json"]

if args[:2] == ["auth", "check"]:
    print(json.dumps({"status": "ok", "checks": {}, "details": {}}))
elif args[:1] == ["create"]:
    state.setdefault("calls", []).append(args)
    state["sequence"] += 1
    notebook_id = f"notebook-new-{state['sequence']:06d}"
    path.write_text(json.dumps(state))
    print(json.dumps({"notebook": {"id": notebook_id, "title": args[1] if len(args) > 1 else None}}))
elif args[:2] == ["source", "list"]:
    print(json.dumps({"notebook_id": option(args, "--notebook"), "sources": state["sources"], "count": len(state["sources"])}))
elif args[:2] == ["source", "add"]:
    state["sequence"] += 1
    source_id = f"source-new-{state['sequence']:06d}"
    row = {"id": source_id, "title": option(args, "--title"), "status": "ready", "type": "file", "url": None}
    state["sources"].append(row)
    path.write_text(json.dumps(state))
    print(json.dumps({"source": {"id": source_id, "title": row["title"], "type": "file", "url": None}}))
elif args[:2] == ["source", "wait"]:
    source_id = args[2]
    if not any(row["id"] == source_id for row in state["sources"]):
        print(json.dumps({"error": True, "message": "missing source"}))
        raise SystemExit(1)
    print(json.dumps({"source_id": source_id, "status": "ready"}))
elif args[:1] == ["ask"]:
    state.setdefault("calls", []).append(args)
    path.write_text(json.dumps(state))
    if '"data":' in args[1]:
        answer = {
            "data": {"format": "markdown", "body": "Grounded structured result."},
            "summary": "A schema-bound source-grounded product.",
        }
    else:
        answer = {
            "files": [{
                "path": "src/generated.js",
                "language": "javascript",
                "content": "export const grounded = true;\n",
            }],
            "summary": "A source-grounded code proposal.",
        }
    print(json.dumps({
        "answer": json.dumps(answer),
        "references": [],
        "conversation_id": "conversation-fake-000001",
        "turn_number": 1,
        "is_follow_up": False,
    }))
elif args[:1] == ["delete"]:
    state.setdefault("calls", []).append(args)
    state.setdefault("deleted_notebooks", []).append(option(args, "--notebook"))
    path.write_text(json.dumps(state))
    print(json.dumps({"action": "delete", "notebook_id": option(args, "--notebook"), "success": True, "status": "deleted"}))
elif args[:2] == ["source", "delete"]:
    source_id = args[2]
    before = len(state["sources"])
    state["sources"] = [row for row in state["sources"] if row["id"] != source_id]
    if len(state["sources"]) == before:
        print(json.dumps({"error": True, "message": "missing source"}))
        raise SystemExit(1)
    path.write_text(json.dumps(state))
    print(json.dumps({"action": "delete", "source_id": source_id, "success": True, "status": "deleted"}))
elif args[:2] == ["generate", "audio"]:
    print(json.dumps({"status": "completed", "artifact_id": "audio-fake-000001"}))
elif args[:2] == ["download", "audio"]:
    Path(args[2]).write_bytes(b"ID3" + b"\x04\x00\x00" + b"deterministic fake mp3 bytes")
    print(json.dumps({"status": "downloaded", "path": args[2]}))
elif args[:2] == ["generate", "data-table"]:
    state.setdefault("calls", []).append(args)
    path.write_text(json.dumps(state))
    print(json.dumps({"status": "completed", "artifact_id": "data-table-fake-000001"}))
elif args[:2] == ["download", "data-table"]:
    state.setdefault("calls", []).append(args)
    path.write_text(json.dumps(state))
    Path(args[2]).write_text("capability,stage,value\ngemini-notebook,analyze,1\n")
    print(json.dumps({"status": "downloaded", "path": args[2], "artifact_id": option(args, "--artifact")}))
elif args[:2] == ["generate", "video"]:
    state.setdefault("calls", []).append(args)
    state["video_task"] = "video-fake-000001"
    path.write_text(json.dumps(state))
    print(json.dumps({"status": "completed", "artifact_id": "video-fake-000001"}))
elif args[:2] == ["artifact", "poll"]:
    state.setdefault("calls", []).append(args)
    path.write_text(json.dumps(state))
    print(json.dumps({"status": "completed", "artifact_id": args[2]}))
elif args[:2] == ["artifact", "list"]:
    state.setdefault("calls", []).append(args)
    path.write_text(json.dumps(state))
    task = state.get("video_task")
    print(json.dumps({"artifacts": [] if task is None else [{"id": task, "type_id": "video", "status": "completed", "created_at": "2096-07-17T12:00:00.000Z"}]}))
elif args[:2] == ["download", "video"]:
    state.setdefault("calls", []).append(args)
    path.write_text(json.dumps(state))
    Path(args[2]).write_bytes(b"\x00\x00\x00\x18ftypisom" + b"deterministic fake mp4 bytes")
    print(json.dumps({"status": "downloaded", "path": args[2], "artifact_id": option(args, "--artifact")}))
else:
    print(json.dumps({"error": True, "message": f"unsupported fake command: {args}"}))
    raise SystemExit(1)
