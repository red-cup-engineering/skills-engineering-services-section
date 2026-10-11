#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { EMPTY_WITNESS_ROOT, identifyJsonSemanticContent } from "@red-cup-engineering/computer-content-engineering-services-section/semantic-content-identity";

const value = JSON.parse(readFileSync(0, "utf8"));
const objectKind = `gemini-notebook.${value?.type ?? "exchange-material"}`;
process.stdout.write(`${identifyJsonSemanticContent({ objectKind, value, witnessRoot: EMPTY_WITNESS_ROOT }).token}\n`);
