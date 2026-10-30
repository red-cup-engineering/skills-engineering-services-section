#!/usr/bin/env node
import { admitNextHistoricalDemand } from "../src/historical-demands.mjs";

const result = admitNextHistoricalDemand();
process.stdout.write(JSON.stringify({
  disposition: result.disposition,
  historicalDemand: result.demand?.id ?? null,
  cycle: result.admitted?.cycle?.id ?? null,
  sourceReceipt: result.record?.sourceReceipt ?? null,
}, null, 2) + "\n");
