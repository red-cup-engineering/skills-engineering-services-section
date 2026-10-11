# Receiving WIT transitions into the inference journal

## Owning contract and scientific scope

This change strengthens the existing Computer Inference client and executor. It does not introduce a new economic unit, protocol edition, account, service, ledger, deployment, or settlement policy.

The operative service contract is `org.emsenn.obsmetrology.wit-transition-assay.v2`. Its source realization is [`services/wit-transition-assay/src/assay.mjs`](https://github.com/lenticule-science/obsmetrological-services-section/blob/df4cb27ed1395d06380007e9e92990cefc9d8625/services/wit-transition-assay/src/assay.mjs), Git blob `2a7710d70fb78cfa6fec7e2014aec7a8927e2c1c`. Computer Inference's `fabric/effect-assay.mjs` already carries that provider contract and hires it through the existing A2A service. Preserve the original source and authorship; these receiving checks are downstream additions.

For this contract, a WIT is one cover in the FOUR knowledge order on two independent Boolean evidence coordinates. For `b=(p,n)` and `a=(p',n')`, a cover means coordinatewise `b <= a` and exactly one `false -> true` transition. The legal cases are `(0,0)->(1,0)`, `(0,0)->(0,1)`, `(1,0)->(1,1)`, and `(0,1)->(1,1)`. The last two retain both sides of a contradiction. An unchanged state, downward step or `(0,0)->(1,1)` jump is not one cover. The receiver uses Data's existing `witnessBit` rather than a parallel truth table.

This is a bounded service meaning. It is not a proof that all historically named WIT measures coincide. In particular, current Obsmetrologia's [`scripts/WitLedger.lean`](https://github.com/emsenn/obsmetrologia/blob/62201d9d50d66fb5f23ebd901c06db745c433605/scripts/WitLedger.lean) measures identification-instrument applications, with own and carried dependency cost. The [`FreeEnergyLyapunov`](https://github.com/emsenn/obsmetrologia/blob/62201d9d50d66fb5f23ebd901c06db745c433605/Obsmetrologia/Dynamics/Flow/FreeEnergyLyapunov.lean) stage ledger is a natural-number measure on finite support under knowledge ascent. Its identity `flux = commits + mints + 2*jumps` is not a cash conversion, physical energy measurement or an x402 settlement. No bridge between these denominations is assumed here.

## Request, result and evidence domains

The commissioned request contains the two semantic effect-cell records and an evidence identity. Both cells have an explicit two-Boolean outcome and a semantic evidenceRoot. As in the original provider, caller, law, operation, parent, postcondition, precondition, provider and refusal stay fixed when present. Their present/absent form is preserved. The completion evidenceRoot must equal the commissioned evidence identity. Measures may change, and the outcome changes by exactly one knowledge cover. The whole cell is therefore deliberately not required to remain equal.

A receipt names its provider, request, proposal, completion, evidence, witness and resulting outcome. Its witness names that same proposal/completion/evidence, the before and after FOUR values, and the articulated coordinate. Admission checks:

1. The exact v2 receipt and witness field sets and their semantic content identities
2. The receipt/witness coordinate agreement and the mathematical cover
3. The returned outcome and articulated coordinate
4. At the client receiving boundary, correspondence with the exact commissioned request, including cell identities and before/after values

The request-aware check does not issue another receipt. It checks the independently returned provider assertion against the contract. It cannot establish whether the evidence's real-world referent is true, prove provider account control merely from a CAIP-10 string, or establish organizational independence merely from a distinct URL. Those remain actual hiring, identity and observation obligations. A signed Agent Card and a self-consistent receipt are not substitutes for them.

Extra fields are refused instead of being silently normalized into a new identity or copied into custody. The admitted value is detached and deeply frozen. The retained v2 receipt contains coordinates, the provider account and Boolean witness values, not the inference prompt, output text, credentials, payment payload or full effect cells. Unknown provider-added payloads do not enter the journal through this receipt.

## Actual receiving path

`executeTypedInferenceEffect` now carries the received receipt through its existing witness-journal batch. The same document retains the completed inference coordinates and full typed WIT receipt. Existing journal indexing makes it recoverable by `urn:sen:wit-receipt` and `urn:sen:wit-provider`. The returned message metadata names both the receipt and the journal document. Provider annotations remain available but cannot override these core received fields.

The consuming loopback assay performs synthetic inference, calls the real signed A2A WIT server, writes through the real witness-journal HTTP provider, reads the document back, queries it by receipt, and admits the same receipt as a typed SEAVT value. It covers completion and refusal. The SEAVT round trip preserves the receipt object and its semantic coordinates, not just a numeric amount labeled WIT. No external federation, wallet, model provider or live ledger is contacted.

## Standards and remaining obligations

The exercised standard carrier is the existing SEN-over-A2A client/server profile. This is not a claim of whole A2A 1.0 conformance. The official [A2A 1.0 specification](https://a2a-protocol.org/v1.0.0/specification/) defines JSON Part fields, binding methods and version negotiation independently from application witness semantics. Current source uses an internal `content.$case` representation at some public boundaries; proper wire conversion belongs to the existing A2A owner and is a separate correction. Successful same-implementation loopback cannot prove interoperability.

ActivityPub, CloudEvents and x402 are distinct protocol obligations. A transported statement does not become an accepted economic result merely by receiving an ActivityStreams `Accept`, a CloudEvent id, or an A2A completed task. A facilitator payment report also does not establish customer acceptance or a WIT. This slice does not add conversion or settlement between them.

## Qualification

The focused receiving and executor tests exercise every legal cover, changed measured resources, false self-consistently re-addressed receipts, malformed witness fields, attempted payload injection, mutation after admission, journal readback and retained contradiction/flux. The prior decoder accepted nine adversarial receipt cases. Use Node with `--experimental-test-module-mocks` for the existing executor mock tests. Full repository CI, deployment and independent live-provider receiving remain separate checks.
