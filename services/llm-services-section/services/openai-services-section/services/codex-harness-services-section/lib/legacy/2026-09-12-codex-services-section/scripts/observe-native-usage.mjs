#!/usr/bin/env node
import { observeNativeUsage } from "../src/native-usage.mjs";

const value = (name) => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
const sessionId=value('--session')??process.env.CODEX_THREAD_ID??process.env.CODEX_SESSION_ID;
if(!sessionId&&!process.argv.includes('--all'))throw new Error('Pass --session ID, or explicitly request --all. An unscoped transcript scan is not the default.');
const gauges=observeNativeUsage({sessionsRoot:value('--sessions-root'),sessionId,turnId:value('--turn'),includeWeekly:process.argv.includes('--weekly')});
const latest=gauges.latestTurn;
const output=process.argv.includes('--full')||process.argv.includes('--all')?gauges:{type:gauges.type,observedAt:gauges.observedAt,sessionId,turn:latest?.turn??null,state:latest?.state??null,usage:latest?.usage??null,toolAccounting:latest?.toolAccounting??null,wallTime:latest?.wallTime??null,estimatedSubscriptionAllocation:latest?.estimatedSubscriptionAllocation??null,monetaryPricePerToken:gauges.monetaryPricePerToken,weekly:gauges.weekly};
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
