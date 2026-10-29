import { readFileSync } from "node:fs";
import { compileRmlLaw } from "@emsenn/rmn-semantic-conformance/law";

export const LAW = compileRmlLaw(readFileSync(new URL("../content/contracts/claude-code-inference-service.rml", import.meta.url), "utf8"));
export const CONTRACT = LAW.id;
