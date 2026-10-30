import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { semanticByteIdentity, semanticIdentity } from "./semiotic-circuit.mjs";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_PATH = join(PACKAGE_ROOT, "agents/harness/codex-harness-parity-baseline.json");

function isRepoRootDirectory(dir) {
  return existsSync(join(dir, ".git")) && existsSync(join(dir, "lib/emsenn"));
}

export function repositoryRootFromPackage(packageRoot = PACKAGE_ROOT) {
  let current = resolve(packageRoot);
  while (true) {
    if (isRepoRootDirectory(current) && existsSync(join(current, "lib/emsenn"))) return current;
    const parent = dirname(current);
    if (parent === current) throw new Error("cannot resolve repository root containing .git and lib/emsenn");
    current = parent;
  }
}

export function loadHarnessParityBaseline(path = BASELINE_PATH) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function filesBelow(root) {
  const files = [];
  if (!existsSync(root)) return files;
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  visit(root);
  return files.sort();
}

export function sourceTreeDigest(sourceRoot, repositoryRoot = repositoryRootFromPackage()) {
  const absoluteRoot = resolve(repositoryRoot, sourceRoot);
  const entries = filesBelow(absoluteRoot).map((path) => ({
    path: relative(repositoryRoot, path),
    content: semanticByteIdentity(readFileSync(path), "bare-cedar-fog-codex.harness-source-file").id,
  }));
  return semanticIdentity({ root: sourceRoot, entries }, "bare-cedar-fog-codex.harness-source-tree").id;
}

function covered(path, rule) {
  return rule.path === path || (typeof rule.prefix === "string" && path.startsWith(rule.prefix));
}

function capabilityEvidencePosition(capability, policy) {
  const missingEvidence = policy.requiredEvidence.filter((key) => typeof capability.evidence?.[key] !== "string" || capability.evidence[key].trim() === "");
  const accepted = capability.actuator.implementationState === policy.requiredCapabilityState && missingEvidence.length === 0;
  return Object.freeze({ id: capability.id, state: capability.actuator.implementationState, missingEvidence, accepted });
}

function sourceSetDeprecationPosition(source, baseline, repositoryRoot) {
  const absoluteRoot = resolve(repositoryRoot, source.root);
  const files = filesBelow(absoluteRoot).map((path) => relative(repositoryRoot, path));
  // Keep the typed preservation relation even after a historical tree has
  // been removed; absence is an obstruction, not loss of capability scope.
  const rules = baseline.backupCoverageRules.filter((rule) => {
    const target = rule.path ?? rule.prefix;
    return typeof target === "string" && (target === source.root || target.startsWith(`${source.root}/`));
  });
  const mappedCapabilities = [...new Set(rules.flatMap((rule) => rule.capabilities ?? []))].sort();
  const capabilityById = new Map(baseline.capabilities.map((capability) => [capability.id, capability]));
  const capabilityPositions = mappedCapabilities.map((id) => capabilityEvidencePosition(capabilityById.get(id), baseline.deprecationPolicy));
  const observedTreeIdentity = sourceTreeDigest(source.root, repositoryRoot);
  const uncoveredFiles = files.filter((path) => !baseline.backupCoverageRules.some((rule) => covered(path, rule)));
  const eligible = observedTreeIdentity === source.treeIdentity && uncoveredFiles.length === 0 && capabilityPositions.every(({ accepted }) => accepted);
  return Object.freeze({
    root: source.root,
    baselineTreeIdentity: source.treeIdentity,
    observedTreeIdentity,
    mappedCapabilities,
    blockingCapabilities: capabilityPositions.filter(({ accepted }) => !accepted).map(({ accepted: _accepted, ...position }) => position),
    uncoveredFiles,
    eligible,
    disposition: eligible ? "eligible-for-leader-authorized-deprecation" : "preserve-source-evidence",
    removalAuthority: baseline.deprecationPolicy.authority,
    removalAuthorized: false,
  });
}

export function evaluateHarnessParity(baseline = loadHarnessParityBaseline(), { repositoryRoot = repositoryRootFromPackage() } = {}) {
  const capabilityIds = new Set(baseline.capabilities.map(({ id }) => id));
  const duplicateCapabilities = baseline.capabilities.map(({ id }) => id).filter((id, index, ids) => ids.indexOf(id) !== index);
  const duplicateActors = baseline.capabilities.map(({ actuator }) => actuator?.actor).filter((actor, index, actors) => actors.indexOf(actor) !== index);
  const invalidActuators = baseline.capabilities.filter(({ actuator }) => !actuator?.actor || !actuator?.operation || !actuator?.inputType || !actuator?.outputType || !actuator?.offer).map(({ id }) => id);
  const invalidRules = baseline.backupCoverageRules.filter((rule) => rule.capabilities?.some((id) => !capabilityIds.has(id)) || (!rule.capabilities && !rule.exclusion));
  const sourceDrift = baseline.sourceSets.flatMap((source) => {
    const observed = sourceTreeDigest(source.root, repositoryRoot);
    return observed === source.treeIdentity ? [] : [{ root: source.root, expected: source.treeIdentity, observed }];
  });
  const uncoveredSources = baseline.sourceSets.flatMap(({ root }) => filesBelow(resolve(repositoryRoot, root)).map((path) => relative(repositoryRoot, path))).filter((path) => !baseline.backupCoverageRules.some((rule) => covered(path, rule)));
  const closureEvidencePolicy = { requiredCapabilityState: baseline.closurePolicy.requiredImplementationState, requiredEvidence: baseline.closurePolicy.requiredEvidence };
  const unclosableCapabilities = baseline.capabilities.map((capability) => capabilityEvidencePosition(capability, closureEvidencePolicy)).filter(({ accepted }) => !accepted).map(({ accepted: _accepted, ...position }) => position);
  const sourceSetDeprecation = baseline.sourceSets.map((source) => sourceSetDeprecationPosition(source, baseline, repositoryRoot));
  return Object.freeze({
    type: "CodexHarnessParityPosition",
    baselineDemand: baseline.demand,
    capabilityCount: baseline.capabilities.length,
    sourceSetCount: baseline.sourceSets.length,
    duplicateCapabilities,
    duplicateActors,
    invalidActuators,
    invalidRules,
    sourceDrift,
    uncoveredSources,
    unclosableCapabilities,
    sourceSetDeprecation,
    deprecationEligibleSourceSets: sourceSetDeprecation.filter(({ eligible }) => eligible).map(({ root }) => root),
    deprecationPolicy: baseline.deprecationPolicy,
    disposition: duplicateCapabilities.length || duplicateActors.length || invalidActuators.length || invalidRules.length || sourceDrift.length || uncoveredSources.length || unclosableCapabilities.length ? "demand-open" : "eligible-for-customer-closure-review"
  });
}

export function assertHarnessParityClosable(baseline = loadHarnessParityBaseline(), options) {
  const position = evaluateHarnessParity(baseline, options);
  if (position.disposition !== "eligible-for-customer-closure-review") {
    throw new Error(`Codex harness parity demand is not closable: ${JSON.stringify(position)}`);
  }
  return position;
}
