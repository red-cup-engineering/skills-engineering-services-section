import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkHarness } from "../scripts/project-claude-agent-harness.mjs";
import { checkPermissions } from "../scripts/project-claude-permissions.mjs";
import { checkLifecycleHooks } from "../scripts/project-claude-lifecycle-hooks.mjs";

test("machine wrappers import the canonical projection service through their declared dependency", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "claude-projection-dependency-"));
  try {
    // A scratch repoRoot with none of the policy's seating records is
    // rejected by the canonical service's own verifySeatings (a colleague
    // seating that cannot resolve) before it ever reaches checkExactRoster's
    // manifest check -- both messages originate in the canonical service,
    // and either proves this wrapper truly delegates to it rather than a
    // stub.
    await assert.rejects(
      () => checkHarness({ repoRoot: scratch, target: scratch }),
      /office '.*' has no incumbency record seated|missing from the manifest/,
    );
    await assert.rejects(
      () => checkPermissions({ repoRoot: scratch, target: scratch }),
      /never been projected/,
    );
    await assert.rejects(
      () => checkLifecycleHooks({ repoRoot: scratch, target: scratch }),
      /safe repo-relative|absent from the target/,
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
