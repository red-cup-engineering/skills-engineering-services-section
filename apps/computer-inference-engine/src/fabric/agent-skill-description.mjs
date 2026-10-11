// admitAgentSkillDescription, folded local to this package.
//
// @red-cup-engineering/agent-skill-description-engineering-services-section
// was deleted (32efbf028f0). Its only house consumer is this package's own
// scripts/project-agent-skill-markdown.mjs, so the admission function becomes
// this package's own module rather than a restored one-file package.
// Recovered verbatim from git history; its own dependency (admitDescription)
// moved from computer-content-description-engineering-services-section to
// computer-content-services-section/description, so only that import line
// changed.
import { admitDescription } from "@red-cup-engineering/computer-content-engineering-services-section/description";

const CONDITION = /\b(?:against|based on|for|from|given|if|into|only|that|to|unless|using|when|whenever|where|whose|with|without)\b/iu;
const LINE_SEPARATOR = /[\n\r\u2028\u2029]/u;
const STOPWORDS = new Set(["about", "against", "agent", "and", "based", "for", "from", "given", "if", "into", "its", "one", "only", "skill", "that", "the", "this", "to", "unless", "use", "using", "when", "whenever", "where", "whose", "with", "without"]);
const IMPERATIVE_ACTIONS = new Set(["admit", "apply", "assay", "build", "check", "compose", "convert", "create", "dispatch", "execute", "find", "generate", "install", "load", "maintain", "make", "migrate", "observe", "operate", "project", "publish", "read", "reconcile", "record", "recover", "remove", "report", "resolve", "review", "select", "transform", "use", "validate", "write"]);

function stem(token) {
  if (token.endsWith("ies") && token.length > 4) return `${token.slice(0, -3)}y`;
  if (/(?:ches|shes|sses|xes|zes|oes)$/u.test(token)) return token.slice(0, -2);
  if (token.endsWith("s") && !token.endsWith("ss") && token.length > 3) return token.slice(0, -1);
  return token;
}

function meaningfulTokens(text) {
  return new Set(text.toLowerCase().match(/[a-z0-9]+/gu)?.map(stem).filter((token) => token.length > 2 && !STOPWORDS.has(token)) ?? []);
}

function leadingAction(text) {
  const word = text.match(/^[A-Za-z]+\b/u)?.[0];
  if (!word) return null;
  const lower = word.toLowerCase();
  if (!lower.endsWith("s") && !IMPERATIVE_ACTIONS.has(lower)) return null;
  return { word, token: stem(lower) };
}

/**
 * Admits one SKILL.md discovery description against its instructional body and relevant neighboring descriptions.
 * @param {string} value The proposed discovery description.
 * @param {object} context The skill body and optional neighboring skill descriptions.
 * @returns {object} An admitted Description@1 record whose text is trimmed.
 */
export function admitAgentSkillDescription(value, { body, neighborDescriptions = [] } = {}) {
  if (typeof value !== "string" || value.trim().length === 0 || LINE_SEPARATOR.test(value)) throw new TypeError("agent skill description must be nonempty single-line text");
  const text = value.trim();
  if (typeof body !== "string" || body.trim().length === 0) throw new TypeError("agent skill description requires the nonempty skill body it characterizes");
  if (!Array.isArray(neighborDescriptions) || neighborDescriptions.some((neighbor) => typeof neighbor !== "string" || neighbor.trim().length === 0)) throw new TypeError("neighborDescriptions must contain only nonempty strings");
  const action = leadingAction(text);
  if (!action) throw new TypeError("agent skill description must name recognizable work, effect, or artifact production");
  const descriptionTokens = meaningfulTokens(text);
  const condition = text.match(CONDITION)?.[0];
  const artifactBoundary = condition === undefined && descriptionTokens.size >= 3;
  if (!condition && !artifactBoundary) throw new TypeError("agent skill description must name recognizable trigger conditions or a bounded scope");

  const bodyTokens = meaningfulTokens(body);
  const groundingToken = [...descriptionTokens].find((token) => bodyTokens.has(token));
  if (!groundingToken) throw new TypeError("agent skill description must be faithful to the skill body");

  const normalized = text.toLocaleLowerCase("en-US");
  if (neighborDescriptions.some((neighbor) => neighbor.trim().toLocaleLowerCase("en-US") === normalized)) throw new TypeError("agent skill description must distinguish the skill from its neighbors");

  const contrasts = neighborDescriptions.length === 0
    ? ["other agent skills"]
    : neighborDescriptions.map((_, index) => `neighboring agent skill ${index + 1}`);
  return admitDescription({
    type: "Description",
    version: 1,
    subject: { kind: "agent-skill" },
    consumer: { kind: "agent-skill-discovery", decision: "recognize whether the skill applies to a request" },
    text,
    predicates: [
      { claim: action.word, grounds: [`skill-body-token:${groundingToken}`], separatesFrom: [] },
      condition
        ? { claim: `applies ${condition.toLowerCase()} the stated request conditions`, grounds: [`description-condition:${condition.toLowerCase()}`], separatesFrom: contrasts }
        : { claim: "applies to the stated work and artifact", grounds: [`description-artifact-boundary:${descriptionTokens.size}`], separatesFrom: contrasts },
    ],
    neighbors: contrasts.map((contrast) => ({ kind: "agent-skill", contrast })),
  });
}
