import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { deriveSetOfInferenceExpenseTransactions } from "../../scripts/fabric/derive-set-of-inference-expense-transactions.mjs";

const examples = [
  {
    "type": "JavascriptNodeOperationExample",
    "name": "derive-set-of-inference-expense-transactions example",
    "input": {
      "usageRecords": [
        {
          "recordId": "r1",
          "sessionId": "s1",
          "provider": "claude",
          "model": "claude-sonnet-5",
          "timestamp": "2026-09-04T10:00:00.000Z",
          "inputTokens": 1000000,
          "outputTokens": 500000,
          "cacheReadTokens": 0,
          "cacheCreationTokens": 0
        }
      ],
      "priceDirectives": [
        {
          "provider": "claude",
          "model": "claude-sonnet-5",
          "tokenClass": "input",
          "date": "2026-06-24",
          "price": "2.00"
        },
        {
          "provider": "claude",
          "model": "claude-sonnet-5",
          "tokenClass": "output",
          "date": "2026-06-24",
          "price": "10.00"
        }
      ]
    },
    "output": {
      "type": "InferenceExpenseTransactionSet",
      "version": 1,
      "transactionCount": 1,
      "transactions": [
        {
          "provider": "claude",
          "model": "claude-sonnet-5",
          "date": "2026-09-04",
          "recordCount": 1,
          "totalUsd": "7",
          "directive": "2026-09-04 * \"Inference and compute: claude claude-sonnet-5 (1 records)\"\n  provider: \"claude\"\n  model: \"claude-sonnet-5\"\n  record_count: \"1\"\n  witness_record_ids: \"r1\"\n  session_ids: \"s1\"\n  input_tokens: \"1000000\"\n  output_tokens: \"500000\"\n  cache_read_tokens: \"0\"\n  cache_creation_tokens: \"0\"\n  Expenses:Inference-and-Compute:Claude  7 USD\n  Liabilities:Accounts-Payable:Claude  -7 USD"
        }
      ],
      "totalUsd": "7",
      "accountsToOpen": [
        {
          "account": "Expenses:Inference-and-Compute:Claude",
          "date": "2026-09-04",
          "directive": "2026-09-04 open Expenses:Inference-and-Compute:Claude USD"
        },
        {
          "account": "Liabilities:Accounts-Payable:Claude",
          "date": "2026-09-04",
          "directive": "2026-09-04 open Liabilities:Accounts-Payable:Claude USD"
        }
      ],
      "refusals": []
    }
  }
];

for (const example of examples) {
  test(example.name, async () => {
    const importedOutput = await deriveSetOfInferenceExpenseTransactions(example.input);
    assert.deepEqual(importedOutput, example.output);
    const command = spawnSync(process.execPath, [fileURLToPath(new URL("../../scripts/fabric/derive-set-of-inference-expense-transactions.mjs", import.meta.url))], {
      input: JSON.stringify(example.input) + "\n",
      encoding: "utf8",
    });
    assert.equal(command.status, 0, command.stderr);
    const commandOutput = JSON.parse(command.stdout.trim());
    assert.deepEqual(commandOutput, example.output);
    assert.deepEqual(commandOutput, importedOutput);
  });
}
