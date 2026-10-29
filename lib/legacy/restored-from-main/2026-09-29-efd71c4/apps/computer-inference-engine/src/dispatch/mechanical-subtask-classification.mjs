/** Distinct from classifyInferenceDemand's "mechanical" (= no inference needed): this admits LLM-needed but judgment-free subtasks for free-tier routing. */

/** @type {readonly string[]} */
export const MECHANICAL_TASK_TYPES = Object.freeze(["classification", "extraction", "summarization", "boilerplate-transform"]);

/**
 * Heuristic gate, not an authoritative judgment classifier: a substring
 * match is evidence a request wants a decision or taste call rather than a
 * closed mechanical transform, worth refusing before it burns a free
 * provider call -- it does not replace human or frontier-model review.
 * @type {RegExp}
 */
export const JUDGMENT_SMELL_PATTERN = /\b(decide|decision|judg(e)?ment|recommend(ation)?|architecture|strateg(y|ic)|opinion|should we|evaluate whether|which is better|design decision|trade-?off|pick the best|choose between|is this (a good|the right))\b/iu;

/**
 * @typedef {object} MechanicalSubtaskClassification
 * @property {boolean} admitted
 * @property {string} [reason] - present only when admitted is false.
 */

/**
 * Classifies one candidate mechanical subtask, refusing anything outside
 * the closed taskType allowlist or whose instructions smell like judgment.
 * Pure and synchronous: makes no inference call and reads no environment.
 * @param {{taskType: unknown, instructions: unknown}} input
 * @returns {MechanicalSubtaskClassification}
 */
export function classifyMechanicalSubtask(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return Object.freeze({ admitted: false, reason: "one { taskType, instructions } object is required" });
  }
  const { taskType, instructions } = input;
  if (typeof taskType !== "string" || !MECHANICAL_TASK_TYPES.includes(taskType)) {
    return Object.freeze({ admitted: false, reason: `taskType must be one of ${MECHANICAL_TASK_TYPES.join(", ")}; route judgment or open-ended repository work through classify_inference_demand/dispatch_inference or a frontier subagent instead` });
  }
  if (typeof instructions !== "string" || instructions.trim() === "") {
    return Object.freeze({ admitted: false, reason: "instructions must be nonempty text" });
  }
  const smell = instructions.match(JUDGMENT_SMELL_PATTERN);
  if (smell) {
    return Object.freeze({ admitted: false, reason: `instructions contain a judgment-smell term ("${smell[0]}"); this bridge routes closed mechanical transforms only, never a decision, recommendation, or taste call` });
  }
  return Object.freeze({ admitted: true });
}
