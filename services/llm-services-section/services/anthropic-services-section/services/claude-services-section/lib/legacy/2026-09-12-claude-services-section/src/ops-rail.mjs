// ops-rail — the one work rail, bound for this harness. The client itself is
// the gateway package's harness-neutral rail-client; this file only adds the
// filesystem override tests use and the credential file this laptop keeps.
import { homedir } from "node:os";
import { createOpsRail, loadOpsClientEnvironment } from "@red-cup-engineering/ops-561-group-mcp-gateway-service/rail-client";
import { assertStructuredWorkIntent } from "@red-cup-engineering/agent-work-computer-system-engineering-services-section/structured-work-intent";
import { resolveFilepath } from "@red-cup-engineering/resolve-filepath-service";

export { createOpsRail, loadOpsClientEnvironment, readToolResult } from "@red-cup-engineering/ops-561-group-mcp-gateway-service/rail-client";
export const DEFAULT_OPS_CLIENT_ENV_PATH = resolveFilepath([homedir(), ".config", "561-group", "ops-mcp-client.env"]);

/**
 * The work verbs every laptop script needs, bound to one rail. With a
 * `dataRoot` the verbs run in-process against metroplat's filesystem binding
 * (tests and offline development); otherwise they call production through
 * the ops gateway. The admit functions keep metroplat's own
 * `(binding, payload, options)` shape so callers and tests inject either kind.
 * @param {object} [options]
 * @param {string} [options.dataRoot] - a filesystem data root; when given, no rail is opened.
 * @param {string} [options.envPath]
 * @param {ReturnType<typeof createOpsRail>} [options.rail] - an already-built rail (tests).
 * @returns {{kind: "filesystem"|"ops", binding: object|null, rail: object|null, admitFn: Function, admitAllocationFn: Function, admitDischargeFn: Function, readDispatch: (input?: object) => Promise<object>, call: (tool: string, input?: object) => Promise<unknown>, close: () => Promise<void>}}
 * @throws {Error} when neither a data root nor a machine credential is available.
 */
export function resolveWorkRail({ dataRoot, envPath, rail } = {}) {
  if (typeof dataRoot === "string" && dataRoot !== "") {
    return Object.freeze({
      kind: "filesystem",
      binding: null,
      rail: null,
      admitFn: (_binding, intent) => {
        assertStructuredWorkIntent(intent);
        throw new Error("agent-work structured intent requires the configured ops receiver; no local persistence adapter is admitted");
      },
      admitAllocationFn: () => { throw new Error("agent-work allocation requires the configured ops receiver"); },
      admitDischargeFn: () => { throw new Error("agent-work discharge requires the configured ops receiver"); },
      readDispatch: async () => { throw new Error("ops rail: the filesystem binding has no dispatch readout; use the ops rail"); },
      call: async (tool) => { throw new Error(`ops rail: the filesystem binding cannot call ${tool}; use the ops rail`); },
      close: async () => {},
    });
  }
  const resolvedRail = rail ?? (() => {
    const credential = loadOpsClientEnvironment({ envPath: envPath ?? DEFAULT_OPS_CLIENT_ENV_PATH });
    if (credential === null) {
      throw new Error(`ops rail: no machine credential at ${envPath ?? DEFAULT_OPS_CLIENT_ENV_PATH} and no --data-root; the rail is ops.561.group`);
    }
    return createOpsRail(credential);
  })();
  return Object.freeze({
    kind: "ops",
    binding: null,
    rail: resolvedRail,
    admitFn: (_binding, intent) => {
      assertStructuredWorkIntent(intent);
      return resolvedRail.call("structured-work-intent-admit", intent);
    },
    admitAllocationFn: (_binding, allocation) => resolvedRail.call("agency-work-allocation-admit", allocation),
    admitDischargeFn: (_binding, discharge) => resolvedRail.call("work-discharge-admit", discharge),
    readDispatch: (input = {}) => resolvedRail.call("agent-work-dispatch", input),
    call: (tool, input) => resolvedRail.call(tool, input),
    close: () => resolvedRail.close(),
  });
}
