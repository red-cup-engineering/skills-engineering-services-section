// Generalizes bare-cedar-fog-codex-actuation-office's shape (seven MAPE-K
// duties: maintain situational knowledge, diagnose, design, decompose,
// actuate, observe, account) so a provider does not hand-author an 80-line
// duplicate of the same seven duties under a different id. The duty and
// skill ids are held IDENTICAL across providers on purpose — a durable
// reaction discovering "actuating-union-change" should find the same shape
// regardless of which provider's actuation office bears it. What differs per
// provider is the identity (actor urn, node id, jurisdiction) and which
// skills currently exist to discharge each duty — recorded honestly in
// `unrealized` rather than assumed complete.

const DUTIES = [
  { id: "maintaining-codex-situational-knowledge", label: "maintaining-codex-situational-knowledge", skills: ["monitor-leader-move", "monitor-repository-evidence", "monitor-provider-market"] },
  { id: "diagnosing-the-union-system", label: "diagnosing-the-union-system", skills: ["analyze-pinned-union-corpus", "analyze-schema-bound-corpus", "analyze-reingested-structured-corpus", "analyze-contradictions-and-obstructions"] },
  { id: "designing-union-change", label: "designing-union-change", skills: ["plan-software-architecture-specification", "plan-high-level-design"] },
  { id: "decomposing-union-change", label: "decomposing-union-change", skills: ["plan-low-level-design", "plan-bounded-work-lots"] },
  { id: "actuating-union-change", label: "actuating-union-change", skills: ["plan-integrate-actuation", "execute-repository-mutation"] },
  { id: "observing-response-and-learning", label: "observing-response-and-learning", skills: ["monitor-evidence-replay", "monitor-receiver-outcome"] },
  { id: "accounting-for-capability-trade", label: "accounting-for-capability-trade", skills: ["monitor-supplier-exchange", "monitor-acceptance-pressure"] },
];

const THEORY_BASIS = [
  "Huidu Guanli MAPE-K separation of monitor, analyze, plan, execute, and retained knowledge",
  "IBM autonomic-computing MAPE-K",
  "predicated governance non-transfer of accountability under delegation",
  "Rendanheyi micro-enterprise zero-distance customer accountability and market-facing service substitution",
  "the perfect-coherent-liar requirement for exact attributable and re-executable evidence regardless of producer identity",
];

function requireString(value, field) {
  if (typeof value !== "string" || !value) throw new Error(`renderActuationOffice: '${field}' is required`);
  return value;
}

// Rewrites the exact wording of bare-cedar-fog-codex-actuation-office's own
// normative-structure, substituting only what is genuinely provider-specific
// (the provider label, the actor urn, and the surface it names). Everything
// else — the seven-duty sequence, the accountability rule — is the shape
// being generalized, so it is held word-for-word.
function normativeStructure({ providerLabel, actorUrn, surfaceLabel }) {
  return (
    `The Bare Cedar Fog ${providerLabel} Actuation Office turns one admitted Leader move into evidence-bound MAPE-over-K ` +
    `purchases and one authority-bounded ${providerLabel} actuation, without treating a session, office, supplier, or ` +
    `advisory model as the ${providerLabel} enterprise identity. Its incumbent is the stable ${actorUrn} customer ` +
    `enterprise -- ${surfaceLabel} -- for which sessions are transient faces, never the identity itself; prior session ` +
    `transcripts and handoffs are working knowledge to be consulted, not discarded at session boundaries. The office runs ` +
    `a full monitor-analyze-plan-execute-knowledge cycle over seven duties in strict sequence: it maintains situational ` +
    `knowledge of the Leader, the repository, and the provider market; diagnoses the Union system against the pinned and ` +
    `re-ingested corpus; designs a candidate architecture and high-level design; decomposes that design into bounded, ` +
    `provider-priced work lots; actuates the integrated plan into one authority-bounded filesystem mutation; observes the ` +
    `mutation through a completed fresh-process assay bound to the exact candidate digest and the Leader's typed endpoint ` +
    `outcome; and accounts for what each purchase yielded against what it cost. Every skill this office holds realizes ` +
    `exactly one MAPE-K stage over explicit, content-addressed knowledge; provider purchase is buying a capability, never ` +
    `delegating authority; and the office can be made to answer for what it did, never for what an inference model or a ` +
    `purchased provider merely said.`
  );
}

// The complete provider-neutral skill catalog this shape names, unfiltered —
// what a provider with every stage discharged would hold. A caller builds
// its own `existingSkills` set as a subset of this to declare what actually
// seats for it yet.
export function allDutySkills() {
  return DUTIES.flatMap((duty) => duty.skills);
}

// Every duty this shape names, with its discharging skills — same ids as
// Codex's, so the pattern is recognizable across providers. `existingSkills`
// (a Set of skill ids that actually seat somewhere for this provider yet)
// determines what is realized vs honestly recorded as unrealized; defaults
// to none, since a fresh provider starts with no skills written for it.
export function renderDuties({ nodeId, existingSkills = new Set() } = {}) {
  requireString(nodeId, "nodeId");
  return DUTIES.map((duty) => ({
    id: duty.id,
    name: duty.label.replaceAll("-", " "),
    authority: "emsenn",
    work: duty.id,
    claim: "emsenn",
    skills: duty.skills.filter((skill) => existingSkills.has(skill)),
    delegation: false,
  }));
}

export function renderActuationOffice({
  providerLabel,
  actorUrn,
  surfaceLabel,
  nodeId,
  jurisdiction,
  partOf,
  authorityScope,
  existingSkills = new Set(),
  recordedBy = "claude/general-purpose-agent",
  recordedOn,
} = {}) {
  requireString(providerLabel, "providerLabel");
  requireString(actorUrn, "actorUrn");
  requireString(surfaceLabel, "surfaceLabel");
  requireString(nodeId, "nodeId");
  requireString(jurisdiction, "jurisdiction");
  requireString(partOf, "partOf");
  if (!Array.isArray(authorityScope) || authorityScope.length === 0) {
    throw new Error("renderActuationOffice: 'authorityScope' requires at least one path");
  }
  requireString(recordedOn, "recordedOn");

  const duties = renderDuties({ nodeId, existingSkills });
  const unrealizedSkillGaps = duties
    .filter((duty) => duty.skills.length === 0)
    .map((duty) => `${duty.id} names no skill that seats yet for this provider — the duty is recorded, discharge is not`);

  return {
    id: `bare-cedar-fog-${nodeId}-actuation-office`,
    name: `Bare Cedar Fog ${providerLabel} Actuation Office`,
    kind: "office",
    "normative-structure": normativeStructure({ providerLabel, actorUrn, surfaceLabel }),
    "deontic-profile": Object.fromEntries(DUTIES.map((duty) => [duty.id, "duty"])),
    "bears-duty": DUTIES.map((duty) => `emsenn/duty/${duty.id}`),
    "provides-skill": [],
    "authority-scope": authorityScope,
    jurisdiction,
    "part-of": partOf,
    "theory-basis": THEORY_BASIS,
    unrealized: [
      ...unrealizedSkillGaps,
      "the direct-incubation stages (monitor-leader-move, plan-integrate-actuation, execute-repository-mutation, monitor-supplier-exchange, monitor-acceptance-pressure) still require complete exact inputs, outputs, attribution, and replay material before their results can discharge the corresponding duty, regardless of which actor performs them",
      "multiple compatible provider offers surfacing at the diagnose or plan stages are returned for Leader or accepted-policy selection because no cross-denomination selection policy is accepted yet",
    ],
    "x-provenance": {
      "recorded-by": recordedBy,
      "recorded-on": recordedOn,
      "derived-from": "generalized from bare-cedar-fog-codex-actuation-office via agent-harness-services-section/services/mape-k-actuation-office-service",
    },
    duties,
  };
}
