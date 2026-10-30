import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EMPTY_WITNESS_ROOT, identifyJsonSemanticContent } from "@red-cup-engineering/semantic-content-identify-service";
import { ACTOR } from "./enterprise.mjs";
import { canonicalJson as canonical } from "@red-cup-engineering/canonical-json-service";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PROFILE = "org.bare-cedar-fog.codex-architectural-locus-seed.v1";
const EXPECTED = new Set(["semiovoxel-composition", "unionification-criticality", "thermodynamic-metabolism", "foam-registry-diagnostics"]);
const FACES = new Set(["activitypub", "evm", "a2a", "ocap", "x402"]);

function identity(value) { return identifyJsonSemanticContent({ objectKind: "bare-cedar-fog-codex.architectural-locus", value, witnessRoot: EMPTY_WITNESS_ROOT }).token; }

export function observeArchitecturalLoci({ root = resolve(ROOT, "agents/loci") } = {}) {
  const files = readdirSync(root).filter((name) => name.endsWith(".json")).sort();
  const loci = files.map((name) => JSON.parse(readFileSync(resolve(root, name), "utf8")));
  if (loci.length !== EXPECTED.size || new Set(loci.map(({ locus }) => locus)).size !== loci.length || loci.some(({ locus }) => !EXPECTED.has(locus))) throw new Error("architectural locus registry must contain exactly the four bootloader sections");
  for (const locus of loci) {
    if (locus.profile !== PROFILE || locus.owner !== ACTOR || locus.status !== "seed-not-advertised") throw new Error(`${locus.locus} cannot advertise an unowned or undeployed actor`);
    if (!/^urn:ame:codex-[a-z-]+-locus$/u.test(locus.actor) || locus.actor === ACTOR) throw new Error(`${locus.locus} must remain distinct from the stable Codex identity`);
    if (!/^ni:\/\/\/sha-256;[A-Za-z0-9_-]{43}$/u.test(locus.source)) throw new Error(`${locus.locus} must retain its exact semantic source identity`);
    if (!Array.isArray(locus.executableBindings) || locus.executableBindings.length === 0) throw new Error(`${locus.locus} must name executable growth faces`);
    if (!Array.isArray(locus.missingFaces) || locus.missingFaces.some((face) => !FACES.has(face))) throw new Error(`${locus.locus} has an invalid face defect`);
  }
  const body = Object.freeze({ profile: "org.bare-cedar-fog.codex-architectural-locus-registry.v1", owner: ACTOR, loci: Object.freeze(loci.map((locus) => Object.freeze({ id: identity(locus), ...locus }))) });
  return Object.freeze({ id: identity(body), ...body });
}
