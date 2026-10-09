#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { projectOfficeContext } from "../src/projector.mjs";

if (process.argv.length !== 3) throw new Error("usage: project-office-context <project-office.json>");
const file = resolve(process.argv[2]);
const config = JSON.parse(readFileSync(file, "utf8"));
if (config.type !== "SourceOfficeContextProjection" || config.authority !== "source-context-only") throw new Error("expected source-only office context binding");
const result = projectOfficeContext({ agencyRoot: resolve(dirname(file), config.agencyRoot), office: config.office, target: resolve(dirname(file), "office-context.md") });
console.log(JSON.stringify({ office: result.office, duties: result.duties, skills: result.skills, target: result.target }));
