// src/swarm.mjs -- the single import seam to the SWARM substrate.
//
// SWARM is the workspace package `@561-group/swarm`. The harness reaches its public ESM API
// through that single dependency; every other harness module imports SWARM verbs from here, so
// this module is the ONLY place the SWARM package name appears.
//
// The harness owns no substrate math. It only decodes Claude IO, captures it, projects
// memory into context, and exposes a tool surface. Everything durable goes through these
// re-exported SWARM functions.

export {
  // routing + identity
  message,
  loadAgent,
  resolveSwarmRoot,
  // cognition (read/project)
  recall,
  derivePlan,
  renderCognitiveContext,
  // durable writes (governed)
  recordMessage,
  memoryRootOf,
  learnFromMessage,
  dream,
  // descent + player
  descendUtterance,
  traceSummary,
  writePlayerTuple,
  // work / status / coordination / cost reads
  listWorkObjects,
  listWorkStatuses,
  summarizeWorkStatuses,
  analyzeCoordinationPatterns,
  costGraphSummary,
  ledgerFoldSummary,
} from "@561-group/swarm";
