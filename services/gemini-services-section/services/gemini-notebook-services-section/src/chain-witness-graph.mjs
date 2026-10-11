
import { canonicalJson as canonical } from "@red-cup-engineering/json-services-section/canonical-json";
import { semanticId } from "@red-cup-engineering/computer-content-engineering-services-section/semiotic-content-address";

/** The content-addressed digest one witness envelope's canonical JSON form carries on chain. Split out of chain-witness.mjs (561-group ruling: a hull module may not reach a kernel module by a relative import) so this pure hash stays reachable without chain-witness.mjs's RPC/env-reading writer machinery; chain-witness.mjs re-exports this same name. */
export function chainWitnessGraph(value) {
  return semanticId(value);
}
