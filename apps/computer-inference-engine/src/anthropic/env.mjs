/**
 * Node process environment boundary reads. Ported from
 * MetroPlat's `src/integrations/process/services/environment.mts` — this
 * team owns its Anthropic boundary directly and has no umbrella-client
 * dependency, so it carries its own copy of this tiny effect boundary
 * rather than reaching back into an app for it.
 */

/** Read the host process environment object. */
export function processEnvironment() {
  return process.env;
}

/** Read one named variable from the host process environment. */
export function processEnvValue(name, env = process.env) {
  return env[name];
}

/** Read one named process environment variable as a number, with the service fallback supplied by the caller. */
export function processEnvNumber(name, fallback, env = process.env) {
  return Number(processEnvValue(name, env) ?? fallback);
}
