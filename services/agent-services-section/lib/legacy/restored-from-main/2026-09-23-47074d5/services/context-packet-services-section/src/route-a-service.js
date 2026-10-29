#!/usr/bin/env node
import { spawnSync } from "node:child_process"; import { dirname, join } from "node:path"; import { fileURLToPath } from "node:url";
const service=process.argv[2], prefix="working-services-section/context-packet-services-section/", routes=new Map([
  [`${prefix}judging-a-context-packet`,"judging-a-context-packet/src/judging-a-context-packet.js"],
]);
if(process.env.EMSENN_SECTION_CONTRACT!=="working-services-section-contracts-context-packet-services"||!routes.has(service)){process.stderr.write("refused: context-packet services require an exact working-services contract route\n");process.exit(1)}
const cell=service.slice(prefix.length),r=spawnSync(process.execPath,[join(dirname(fileURLToPath(import.meta.url)),"../services",routes.get(service)),...process.argv.slice(3)],{stdio:"inherit",env:{...process.env,EMSENN_SUBSECTION_CONTRACT:`context-packet-services-section-contracts-${cell}`}});process.exit(r.status??1);
