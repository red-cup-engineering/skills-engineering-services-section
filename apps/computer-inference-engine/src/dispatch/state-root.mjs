/**
 * Where the inference work lot keeps what it writes (its semantic-record and market-witness journals,
 * its work-lot data): never inside the package, which a release installs read-only and replaces at
 * every release. The deployment names it (INFERENCE_WORK_LOT_STATE_ROOT); else it sits beside the
 * node's web data directory, as the pricing root does, so a node job carrying only the node's
 * configuration writes where the node does; else it is the engine's settlement in the house's state
 * directory, `settlements/computer-inference-engine`, whose `data/logs` the package's own `data/logs` links to.
 */
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export function inferenceStateRootOf(environment = process.env) {
  const named = environment.INFERENCE_WORK_LOT_STATE_ROOT;
  if (typeof named === "string" && named.trim() !== "") return resolve(named);
  const web = environment.METROPLAT_WEB_DATA_DIR;
  if (typeof web === "string" && web.trim() !== "") return resolve(dirname(web), "inference-work-lot");
  return join(environment.XDG_STATE_HOME || join(homedir(), ".local", "state"), "561-group", "settlements", "computer-inference-engine");
}

/** The work-lot data directory under the state root, unless the deployment names it (INFERENCE_WORK_LOT_DATA_ROOT). */
export const inferenceDataRootOf = (environment = process.env) => resolve(environment.INFERENCE_WORK_LOT_DATA_ROOT ?? join(inferenceStateRootOf(environment), "data"));
