#!/usr/bin/env node
import { inventoryInstalledCodexHarness } from "../scripts/inventory-codex-harness.mjs";
import { summarizeHarnessLifecycleUsage } from "../scripts/summarize-harness-lifecycle.mjs";
import { acknowledgeCoordination, completeCoordination, projectOpsHarnessAttentionEvents, recordCoordinationCommission, recordProviderCommission, recordSkillSelection, refuseCoordination } from "../src/harness-lifecycle.mjs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { argument } from "@red-cup-engineering/javascript-node-services-section/argv";

// Binds the one shared recording implementation to CODEX_HARNESS_ACTOR; see ../src/harness-lifecycle.mjs.
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

try {
  const [command, ...args] = process.argv.slice(2);
  const inputs = argument("--input-refs", args)?.split(",").filter(Boolean);
  const result = command === "record-skill" ? recordSkillSelection({ root: PACKAGE_ROOT, turnId: argument("--turn", args), skill: argument("--skill", args) })
    : command === "record-agent" ? recordProviderCommission({ root: PACKAGE_ROOT, turnId: argument("--turn", args), agent: argument("--agent", args), task: argument("--task", args) })
      : command === "commission" ? recordCoordinationCommission({ root: PACKAGE_ROOT, turnId: argument("--turn", args), receiverActor: argument("--receiver", args), capability: argument("--capability", args), channel: argument("--channel", args), workClass: argument("--work-class", args), allocationBasisPoints: Number(argument("--allocation-bps", args)), inputRefs: inputs, route: argument("--route", args), receiverCondition: argument("--receiver-condition", args) })
        : command === "acknowledge" ? acknowledgeCoordination({ root: PACKAGE_ROOT, turnId: argument("--turn", args), coordination: argument("--coordination", args) })
          : command === "complete" ? completeCoordination({ root: PACKAGE_ROOT, turnId: argument("--turn", args), coordination: argument("--coordination", args), resultRefs: inputs })
            : command === "refuse" ? refuseCoordination({ root: PACKAGE_ROOT, turnId: argument("--turn", args), coordination: argument("--coordination", args), refusal: argument("--refusal", args) })
      : command === "summary" ? summarizeHarnessLifecycleUsage()
        : command === "inventory" ? inventoryInstalledCodexHarness()
          : command === "project-ops-adapter" ? projectOpsHarnessAttentionEvents({ root: PACKAGE_ROOT })
            : undefined;
  if (result === undefined) throw new Error("usage: harness-lifecycle-cli.mjs commission --turn ID --receiver ACTOR --capability NAME --channel NAME --work-class CLASS --allocation-bps N --input-refs REF[,REF] --route ROUTE --receiver-condition TEXT | acknowledge --turn ID --coordination NI | complete --turn ID --coordination NI --input-refs REF[,REF] | refuse --turn ID --coordination NI --refusal TEXT | record-skill --turn ID --skill NAME | record-agent --turn ID --agent NAME --task TEXT | summary | inventory | project-ops-adapter");
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`harness-lifecycle: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
