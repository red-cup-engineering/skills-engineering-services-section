#!/usr/bin/env node
import { decideWorkPlacement } from "../../src/dispatch/decide-work-placement.mjs";
import {decideQualifiedCapacityFlow} from "../../src/dispatch/work-placement/capacity-flow-placement.mjs";

if (import.meta.main) {
  if (process.argv.includes("--help")) {
    process.stdout.write("decideWorkPlacement — One TypedWorkDemand, or QualifiedCapacityFlowRequest with multiple demands and source-observed account-window slots. Each line produces a lawful read-only provider placement; external effects require separate authority and native account reservations.\n");
  } else {
    process.stdin.setEncoding("utf8");
    let input = "";
    for await (const chunk of process.stdin) input += chunk;
    for (const line of input.split("\n")) if (line.trim()) {
      const request=JSON.parse(line);
      const result=request?.type==="QualifiedCapacityFlowRequest"?
        decideQualifiedCapacityFlow(request):decideWorkPlacement(request);
      process.stdout.write(JSON.stringify(result)+"\n");
    }
  }
}
