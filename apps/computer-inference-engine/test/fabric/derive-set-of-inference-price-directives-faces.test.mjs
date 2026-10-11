import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { deriveSetOfInferencePriceDirectives } from "../../scripts/fabric/derive-set-of-inference-price-directives.mjs";

const examples = [
  {
    "type": "JavascriptNodeOperationExample",
    "name": "derive-set-of-inference-price-directives example",
    "input": {
      "prices": [
        {
          "provider": "anthropic",
          "model": "claude-haiku-4-5",
          "date": "2026-09-04",
          "sourceUrl": "https://docs.claude.com/en/docs/about-claude/pricing",
          "inputUsdPerMillionTokens": "1.00",
          "outputUsdPerMillionTokens": "5.00",
          "cacheReadUsdPerMillionTokens": "0.10",
          "cacheWriteUsdPerMillionTokens": "1.25"
        }
      ]
    },
    "output": {
      "type": "InferencePriceDirectiveSet",
      "version": 1,
      "directiveCount": 4,
      "directives": [
        {
          "commodity": "CLAUDE-HAIKU-4-5-IN",
          "tokenClass": "input",
          "provider": "anthropic",
          "model": "claude-haiku-4-5",
          "date": "2026-09-04",
          "price": "1.00",
          "directive": "2026-09-04 price CLAUDE-HAIKU-4-5-IN 1.00 USD\n  provider: \"anthropic\"\n  model: \"claude-haiku-4-5\"\n  token_class: \"input\"\n  source: \"https://docs.claude.com/en/docs/about-claude/pricing\""
        },
        {
          "commodity": "CLAUDE-HAIKU-4-5-OUT",
          "tokenClass": "output",
          "provider": "anthropic",
          "model": "claude-haiku-4-5",
          "date": "2026-09-04",
          "price": "5.00",
          "directive": "2026-09-04 price CLAUDE-HAIKU-4-5-OUT 5.00 USD\n  provider: \"anthropic\"\n  model: \"claude-haiku-4-5\"\n  token_class: \"output\"\n  source: \"https://docs.claude.com/en/docs/about-claude/pricing\""
        },
        {
          "commodity": "CLAUDE-HAIKU-4-5-CACHE-READ",
          "tokenClass": "cache-read",
          "provider": "anthropic",
          "model": "claude-haiku-4-5",
          "date": "2026-09-04",
          "price": "0.10",
          "directive": "2026-09-04 price CLAUDE-HAIKU-4-5-CACHE-READ 0.10 USD\n  provider: \"anthropic\"\n  model: \"claude-haiku-4-5\"\n  token_class: \"cache-read\"\n  source: \"https://docs.claude.com/en/docs/about-claude/pricing\""
        },
        {
          "commodity": "CLAUDE-HAIKU-4-5-CACHE-WRITE",
          "tokenClass": "cache-write",
          "provider": "anthropic",
          "model": "claude-haiku-4-5",
          "date": "2026-09-04",
          "price": "1.25",
          "directive": "2026-09-04 price CLAUDE-HAIKU-4-5-CACHE-WRITE 1.25 USD\n  provider: \"anthropic\"\n  model: \"claude-haiku-4-5\"\n  token_class: \"cache-write\"\n  source: \"https://docs.claude.com/en/docs/about-claude/pricing\""
        }
      ]
    }
  }
];

for (const example of examples) {
  test(example.name, async () => {
    const importedOutput = await deriveSetOfInferencePriceDirectives(example.input);
    assert.deepEqual(importedOutput, example.output);
    const command = spawnSync(process.execPath, [fileURLToPath(new URL("../../scripts/fabric/derive-set-of-inference-price-directives.mjs", import.meta.url))], {
      input: JSON.stringify(example.input) + "\n",
      encoding: "utf8",
    });
    assert.equal(command.status, 0, command.stderr);
    const commandOutput = JSON.parse(command.stdout.trim());
    assert.deepEqual(commandOutput, example.output);
    assert.deepEqual(commandOutput, importedOutput);
  });
}
