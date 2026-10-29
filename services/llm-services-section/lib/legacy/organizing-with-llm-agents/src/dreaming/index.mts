/**
 * @emsenn/organizing-with-llm-agents/dreaming — aperiodic dreaming through an LLM enactor.
 *
 * Knowing owns the four forms of dreaming (one per closure regime); the three
 * inward regimes are deterministic and network-free. This package fills knowing's
 * fourth — APERIODIC (κ≥ω₁) — regime: the emergence boundary where genuinely new
 * generators enter from OUTSIDE the settled fibers, which can only happen by
 * reaching past the closure. The LLM is that outside. Aperiodic knowing IS dreaming.
 */

import { mark, token, type ChargeCarrier, type Mark, type PredicationTerm } from "@emsenn/relating";
import {
  dreamResult,
  observation,
  type DreamOptions,
  type DreamResult,
  type Task,
} from "@emsenn/knowing/dreaming";

export type DreamResponder = (task: Task) => Promise<ChargeCarrier> | ChargeCarrier;

export async function aperiodicDream(
  task: Task,
  responder: DreamResponder,
  options: DreamOptions = {},
): Promise<DreamResult> {
  const charge = await responder(task);
  const obs = observation({
    observer: options.observer ?? dreamTerm(["observer", "aperiodic"]),
    task,
    charge,
    at: options.at ?? dreamMark(["aperiodic"]),
    note: dreamMark(["aperiodic-dream"]),
  });
  return dreamResult("aperiodic", [obs]);
}

type DreamMarkPart =
  | "organizing-with-llm-agents"
  | "dream"
  | "observer"
  | "aperiodic"
  | "aperiodic-dream";

function dreamTerm(parts: readonly DreamMarkPart[]): PredicationTerm {
  return token(dreamMark(parts));
}

function dreamMark(parts: readonly DreamMarkPart[]): Mark {
  return mark(Object.freeze(["organizing-with-llm-agents", "dream", ...parts] as const));
}
