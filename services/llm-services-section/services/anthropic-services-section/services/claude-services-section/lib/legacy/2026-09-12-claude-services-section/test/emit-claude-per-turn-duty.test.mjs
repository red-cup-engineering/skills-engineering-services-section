import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  emitPerTurnDuty,
  renderContext,
  withTimeout,
} from "../scripts/emit-claude-per-turn-duty.mjs";
const actor = "actor:bZH6KBOlPVWbYpqp04izN_Xtwykn0XgsMBStm_FkPPw";
test("native context keeps recognized identity, invocation evidence, and the exact prompt", async () => {
  const root = mkdtempSync(join(tmpdir(), "claude-context-"));
  try {
    writeFileSync(
      join(root, "character.json"),
      JSON.stringify({ id: "claude" }),
    );
    writeFileSync(
      join(root, "seat.json"),
      JSON.stringify({
        id: "seat",
        holder: "claude",
        office: "executive",
        recognition: "t",
        induction: "t",
      }),
    );
    writeFileSync(
      join(root, "policy.json"),
      JSON.stringify({
        actor,
        rootOffice: "executive",
        rootSeating: { character: "character.json", incumbency: "seat.json" },
        shortReminder: "remember",
      }),
    );
    let prompt;
    const out = await emitPerTurnDuty({
      root,
      policyPath: join(root, "policy.json"),
      input: { hook_event_name: "UserPromptSubmit", prompt: "exact prompt" },
      callContext: async (p) => {
        prompt = p;
        return {
          metadata: { root },
          packages: [
            {
              package: "@x/tool",
              packagePath: "services/tool",
              bins: [{ bin: "tool", target: "./scripts/tool.mjs" }],
              exports: ["./tool"],
            },
          ],
        };
      },
    });
    assert.equal(prompt, "exact prompt");
    assert.match(out.hookSpecificOutput.additionalContext, /actor: actor:/);
    assert.match(
      out.hookSpecificOutput.additionalContext,
      /invoke tool: .*services\/tool\/scripts\/tool.mjs/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("refusal and timeout stay distinct and the deadline aborts", async () => {
  assert.equal(
    renderContext({
      kind: "coding-context.relevance.refusal",
      reason: "budget",
    }),
    "context: refused (budget)",
  );
  assert.equal(
    renderContext({
      kind: "coding-context.relevance.refusal",
      reason: "output-budget-too-small",
      maxBytes: 4000,
      requiredBytes: 5230,
      promptBytes: 4512,
    }),
    "context: refused (output-budget-too-small; needed 5230b, budget 4000b, prompt 4512b)",
  );
  let aborted = false;
  await assert.rejects(() =>
    withTimeout(
      (signal) =>
        new Promise((_, reject) =>
          signal.addEventListener("abort", () => {
            aborted = true;
            reject(signal.reason);
          }),
        ),
      5,
    ),
  );
  assert.equal(aborted, true);
});
test("context budget keeps whole Unicode invocation entries and reserves identity", async () => {
  const root = mkdtempSync(join(tmpdir(), "claude-context-"));
  try {
    writeFileSync(join(root, "character.json"), JSON.stringify({ id: "claude" }));
    writeFileSync(join(root, "seat.json"), JSON.stringify({ id: "seat", holder: "claude", office: "executive", recognition: "t", induction: "t" }));
    writeFileSync(join(root, "policy.json"), JSON.stringify({ actor, rootOffice: "executive", rootSeating: { character: "character.json", incumbency: "seat.json" }, shortReminder: "keep this reminder" }));
    const target = "scripts/工具-".repeat(70) + "run.mjs";
    const output = await emitPerTurnDuty({
      root,
      policyPath: join(root, "policy.json"),
      input: { hook_event_name: "UserPromptSubmit", prompt: "use the matching script" },
      callContext: async () => ({
        metadata: { root },
        scripts: [{ bin: "matching", packagePath: "services/tool", target: `./${target}` }],
        packages: Array.from({ length: 100 }, (_, index) => ({ package: `@x/${"説明".repeat(30)}-${index}`, packagePath: "services/ignored", exports: ["."] })),
      }),
    });
    const text = output.hookSpecificOutput.additionalContext;
    assert.ok(Buffer.byteLength(text, "utf8") <= 4000);
    assert.ok(text.includes(`invoke matching: ${root}/services/tool/${target}`));
    assert.ok(text.indexOf("invoke matching:") < text.indexOf("@x/"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
