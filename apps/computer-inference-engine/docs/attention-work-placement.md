# Measured attention work placement

## Existing owners and purpose

The Attention Allocation Readout operation family now exposes
`attention-work-placement`. Its implementation is exported by Computer
Inference's `./dispatch/work-placement`, beside `decideWorkPlacement`.
It calls the existing metrologic `allocateAttention`; it does not introduce
a second scheduler or an exchange-rate service.

This is an **effect-free, conditional readout** for independently placeable
work. It does not procure inference, accept an offer, reserve shared capacity,
invoke providers, write accounting books, or discharge a work commitment.
The existing current resource admission and execution authority remain
necessary before any selected item is attempted.

## Input and evidence

The request has `budget`, ordered `candidates`, and optional `evaluatedAt`.

- `budget`: `{ amount, unit, evidence }`, with a nonnegative safe integer
  amount, one explicitly named count unit, and its evidence identity
- Each candidate contains an existing `TypedWorkDemand` as `demand`,
  existing `NormalizedWorkOffer[]` as `offers`, and optional existing
  `WorkPlacementObservation[]` as `observations`
- `attention.cost`: `{ amount, unit, evidence }`; the exact unit must equal
  the budget unit. The amount is a nonnegative safe integer. Total candidate
  cost must remain within safe integer arithmetic
- `attention.held`: `{ atoms, evidence }`; each atom names one held
  obstruction unit. Benefit is exactly the cardinality of this finite list

These are attributed **caller-supplied measurements**, not independently
verified measurement receipts. The evidence identities are retained for a
consumer to assay. The function neither fetches evidence nor proves its
truth. The caller must supply a current, independently placeable frontier;
this boundary does not infer dependency closure or a joint capacity schedule.

Demand identities and obstruction identities cannot repeat. Every candidate
must use disjoint held atoms, even if its provider placement is unavailable.
In particular, overlapping board-enablement counts cannot be passed as
additive knapsack benefit. Unequal obstruction valuations, prerequisite
bundles, overlapping benefit, and denomination conversion require a distinct
qualified model; do not disguise them as this cardinality carrier.

## Exact feasibility before attention

Every demand passes through the existing `decideWorkPlacement` unchanged:
capabilities, effects, authority, implementation constraints, finite capacity,
current availability, exact consideration/resource ceilings, reuse policy,
customer-ordered Pareto groups and receiver observations keep their existing
meaning.

A refused placement is retained in `deferred`. An incomparable Pareto
frontier remains `choice-required` and is also deferred. A large declared
benefit never overrides either result. Selected provider offers retain their
original currency/resource dimensions and exact amounts. None is divided
into, converted to, or summed as attention units.

Existing receiver observations update provider acceptance estimates and
consideration-per-acceptance ranking through the same law. Replayed receipts
remain one observation; contradictory versions remain contested. These
observations do not manufacture new obstruction benefit or establish that
the selected work has removed an obstruction.

## Selection and outcome

The eligible candidates enter `allocateAttention` in their original order.
That order is semantically significant: the exact solver enumerates tail
subsets first and replaces the winner only for a strict benefit increase.
Equivalent optima can therefore select differently when input order changes.
The allocator's `readNext` order is a separate benefit-density reading order.

The existing exact/approximate boundary is preserved: at most 20 positive
cost/benefit candidates uses exhaustive search; above that uses the existing
density-greedy approximation with `exact: false` and `choiceBits: null`.
Zero-cost positive-benefit candidates are handled by the existing free-work
rule. `choiceBits` denotes selection ambiguity, never an erasure price.

The result retains:

- `candidateOrder`, the exact allocator `allocation`, and its `planned`
  demand identities, measurement evidence and complete provider decisions
- `deferred` decisions and eligible `unfunded` work
- `unselected` counts separately for eligible and unavailable work
- `observedRemoval: null`, `sharedResourcesReserved: false`,
  `customerMutation: false`, and `assetSettlementClaimed: false`

An unselected count of zero only means the supplied model selected every
admitted atom. It does not mean zero remaining actual contradiction.
Actual receiving and a new measurement must establish removal.

## Joint, account-safe inference capacity (without another scheduler)

The same **Red Cup** inference decision is now consumed by
\`decideQualifiedCapacityFlow\`, exposed through the **existing** JSONL
\`scripts/dispatch/decide-work-placement.mjs\` command. Pass one JSON object
with \`type: "QualifiedCapacityFlowRequest"\`, a source-identified
\`evaluatedAt\`, original \`candidates: [{demand,offers,observations}]\`,
and a current \`capacityPools\` array.

Each pool is an exact provider/account/window observation:
\`{providerIdentity, accountIdentity, windowIdentity, evidenceRef,
observedAt, validUntil, availableSlots}\`. An available slot means one
simultaneous **qualified job opportunity**, *not* CPU seconds, tokens, USD,
Flow subscription credits or actual account purchasing authority.

The original single-work policy first determines feasible offers. Only
**single or demonstrably equivalent top-tier offers**, with accepted
implementation, source rights, data custody and current account windows,
enter the graph. Incomparable choices and lower-ranked providers are held,
not secretly dispatched. Different offers for one account/window converge
on ONE capacity bottleneck; their nominal \`availableCapacity\` cannot be
summed into new compute.

The shared \`@red-cup-engineering/metrologic/obstruction/capacity-flow\`
computes exact maximum throughput with the existing directed-incidence
conservation interpretation and a min-cut witness. Consider the practical
case where an exclusive job needs GPU, a flexible original script-writing
job can use GPU *or* a lawful free CPU provider, and each has one slot:
independent, first-choice GPU selection places one; joint routing
places both by moving the flexible workload to CPU. This is more useful
capacity **only when those qualified provider slots actually exist**.

\`additionalPlaceableViaJointRouting\` is a difference between two
**counterfactual read-only algorithms on supplied evidence**, never a
count of new server instances or completed jobs. The result retains
every demand/source, offer, provider, account/window and evidence
identity, an exact math witness, and specific held reasons.

A returned \`assignment\` **MUST** still enter the original shared
\`createWorkResourceReservations\` CAS account/window store with fresh
per-dimension resources, original authority and a qualified executing
office before dispatch. It is never an already-paid reservation. Unknown
or stale account evidence, a contradictory offer, cross-client rights,
and an external market listing without an actual customer request do
not become permission or a market-gap signal. Completed work needs an
independent receiving journal. The math's gauge invariance is relabeling
invariance of the capacity graph, *not* permission manipulation by the
FOUR/Klein symmetry group.

### Runnable entrypoint

Use the original inference command, passing one \`QualifiedCapacityFlowRequest\`
JSON object per line on stdin. For example, a producing office can send
two original \`TypedWorkDemand\` packets, their already-qualified
\`NormalizedWorkOffer\` options, and two currently observed account windows.
It receives \`assignments\`, \`unrouted\`, \`poolUse\`, \`minCut\` inside
\`mathematicalWitness\`, and \`accountReservationState: "not-reserved"\`.
No new provider, scheduler, money or command-line distribution is installed
by this readout. Integration regression:
\`node --test test/dispatch/capacity-flow-placement.test.mjs\` in the actual
joined workspace; it invokes the existing JSONL CLI too. The pure
Metrologic law has its separate mathematical tests.

## Scientific scope

The applied Economics `AttentionAllocation.lean` uses natural-number cost
and benefit under a finite budget; `AllocationSolver.lean` supplies the
handed exact selection law. Those mathematical results require the supplied
benefits to have their intended additive interpretation. This consumer
admits one narrow finite-cardinality realization, rather than treating any
organizational benefit number as that theorem's premise.

Original applied owner:
[Lenticule Economics at 16db971](https://github.com/lenticule-science/science-services-section/tree/16db97163067b5a47f66efa54ab97f6ab4ec50fd/services/social-science-services-section/services/economics-and-business-science-services-section/services/economics-science-services-section/lib/obsmetrologia-economics).

This slice does not assert a WIT/ACK conversion, a currency cocone, a
Hoare/J26 exchange tessellation, or a dervish experiment outcome. Each needs
its own interpreted evidence and receiving condition.

## Bounded qualification

Run the inference `test/dispatch/attention-work-placement.test.mjs` and
`test/dispatch/discovered-work-placement.test.mjs`, plus the Attention
Readout package's `node --test test/*.test.mjs`, with their declared provider
closure. The tests cover both provider operation exports, feasibility,
customer-denomination choice, receiver feedback/replay/conflict, expiry,
disjointness, evidence presence, safe counts, free work, handed ties,
approximation, 40 small allocator comparison cases, and actual SEAVT
read-back of allocation performance receipts.

The allocation contract imports ActivityStreams vocabulary directly from
the existing triplet-data owner. It no longer relies on ActivityPub's removed
historical vocabulary re-export. Its custody test reads persisted records
through the semantic-journal owner rather than asserting a historical
filename. Neither local test proves live federation or installed receiving.

