#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createA2aServerProcess } from "@red-cup-engineering/a2a-services-section/a2a-server";
import { executeA2aMessage } from "../src/a2a-executor.mjs";
const ROOT = resolve(import.meta.dirname, "..");
const agentCard = JSON.parse(readFileSync(resolve(ROOT, "content/agent-cards/improvement-game-design-supplier.json"), "utf8"));
createA2aServerProcess({ port: Number(process.env.PORT ?? "8805"), host: process.env.HOST ?? "127.0.0.1", baseUrl: process.env.BASE_URL, agentCard, handlers: { "message/send": (message) => executeA2aMessage(message) } });
