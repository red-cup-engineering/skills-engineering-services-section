"""Dependency-independent tests for the Gemini Notebook Python membrane."""

import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


SOURCE_ROOT = Path(__file__).resolve().parent.parent
READ_A_SCHEMA = SOURCE_ROOT / "node_modules" / "@red-cup-engineering" / "json-schema-services-section" / "scripts" / "read-a-schema.mjs"
FAKE_PACKAGE = SOURCE_ROOT / "test" / "fake-gemini-notebook"


def sha256(path: Path) -> str:
    return "sha256:" + hashlib.sha256(path.read_bytes()).hexdigest()


class RunOneExchangeTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="gemini-notebook-membrane-")
        self.root = Path(self.temporary.name) / "notebooklm-inference-team"
        shutil.copytree(
            SOURCE_ROOT,
            self.root,
            ignore=shutil.ignore_patterns(".venv", ".git", "node_modules", "data", "test", "__pycache__"),
        )
        provider_bin = self.root / ".venv" / "bin"
        provider_bin.mkdir(parents=True)
        (provider_bin / "python3").symlink_to(Path(sys.executable).resolve())
        (self.root / "node_modules").symlink_to(SOURCE_ROOT / "node_modules", target_is_directory=True)
        self.source = Path(self.temporary.name) / "source.md"
        self.source.write_text("Gemini Notebook is an Analyze-over-K market provider.\n")

    def tearDown(self):
        self.temporary.cleanup()

    def invoke(self, artifact_type: str, **extra):
        packet = {
            "sources": [{"path": str(self.source), "digest": sha256(self.source)}],
            "prompt": "Produce one grounded machine-readable product.",
            "artifact-type": artifact_type,
            **extra,
        }
        packet_path = Path(self.temporary.name) / f"{artifact_type}.packet.json"
        packet_path.write_text(json.dumps(packet))
        state_path = Path(self.temporary.name) / f"{artifact_type}.state.json"
        state_path.write_text(json.dumps({"sequence": 0, "sources": [], "calls": []}))
        customer_exchanges = Path(self.temporary.name) / "customer" / "supplier-exchanges" / "gemini-notebook"
        environment = {
            **os.environ,
            "PYTHONPATH": f"{FAKE_PACKAGE}{os.pathsep}{os.environ.get('PYTHONPATH', '')}",
            "FAKE_GEMINI_NOTEBOOK_STATE": str(state_path),
            "NOTEBOOKLM_AUTH_JSON": "{}",
            "EMSENN_READ_A_SCHEMA": str(READ_A_SCHEMA),
            "EMSENN_SCHEMA_POOL": str(SOURCE_ROOT / "content" / "schemas"),
            "GEMINI_NOTEBOOK_EXCHANGES_DIR": str(customer_exchanges),
        }
        result = subprocess.run(
            [sys.executable, str(self.root / "run-one-exchange.py"), str(packet_path)],
            cwd=self.root, env=environment, capture_output=True, text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)
        exchange = json.loads(result.stdout)
        self.assertTrue(Path(exchange["seated"]).is_relative_to(customer_exchanges))
        return exchange, json.loads(state_path.read_text())

    def test_schema_bound_json_is_seated_before_exact_notebook_cleanup(self):
        result, state = self.invoke(
            "json", **{"result-schema": "emsenn/schema/gemini-notebook-report-artifact"}
        )
        self.assertEqual(result["outcome"], "artifact", result)
        payload = json.loads(Path(result["record"]["artifact"]["path"]).read_text())
        self.assertEqual(payload["format"], "json")
        self.assertEqual(payload["resultSchema"], "emsenn/schema/gemini-notebook-report-artifact")
        self.assertEqual(result["ephemeral_cleanup"]["disposition"], "deleted")
        self.assertTrue(result["ephemeral_cleanup"]["artifactOrRefusalSeated"])
        self.assertIn("notebook-new-000001", state["deleted_notebooks"])

    def test_native_data_table_is_exact_rectangular_csv_then_cleaned(self):
        result, state = self.invoke("data-table")
        self.assertEqual(result["outcome"], "artifact", result)
        csv_path = Path(result["record"]["artifact"]["path"])
        self.assertEqual(csv_path.read_text(), "capability,stage,value\ngemini-notebook,analyze,1\n")
        metadata = json.loads(csv_path.with_suffix(".json").read_text())
        self.assertEqual(metadata["header"], ["capability", "stage", "value"])
        self.assertEqual(metadata["rowCount"], 1)
        self.assertEqual(metadata["formulaLikeCellCount"], 0)
        self.assertEqual(result["ephemeral_cleanup"]["disposition"], "deleted")
        self.assertIn("notebook-new-000001", state["deleted_notebooks"])


if __name__ == "__main__":
    unittest.main()
