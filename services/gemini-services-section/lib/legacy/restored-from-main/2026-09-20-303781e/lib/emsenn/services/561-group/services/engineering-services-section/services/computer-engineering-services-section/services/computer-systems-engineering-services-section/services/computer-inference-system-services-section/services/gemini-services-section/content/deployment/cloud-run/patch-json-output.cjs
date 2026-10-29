#!/usr/bin/env node

const { readFileSync, writeFileSync } = require("node:fs");

const target = process.env.GEMINI_EXECUTOR_PATH
  ?? "/app/lib/emsenn/services/561-group/services/red-cup-engineering/services/logical-inference-service-section/services/gemini-inference-team/src/execute-rmn-inference.mjs";

const replacements = [
  [
    '  const jsonSchema = outputContract.format === "json" && outputContract.mode === "json_schema";',
    '  const json = outputContract.format === "json";\n  const jsonSchema = json && outputContract.mode === "json_schema";',
  ],
  [
    "  if (!projected && !jsonSchema && !naturalText) {",
    "  if (!projected && !json && !naturalText) {",
  ],
  [
    '      ...(jsonSchema ? {\n        responseMimeType: "application/json",\n        responseJsonSchema: geminiJsonSchema(outputContract.schema),',
    '      ...(json ? { responseMimeType: "application/json" } : {}),\n      ...(jsonSchema ? {\n        responseJsonSchema: geminiJsonSchema(outputContract.schema),',
  ],
];

let source = readFileSync(target, "utf8");
for (const [before, after] of replacements) {
  if (source.split(before).length !== 2) {
    throw new Error(`expected exactly one deployed-source match for: ${before}`);
  }
  source = source.replace(before, after);
}
writeFileSync(target, source);
