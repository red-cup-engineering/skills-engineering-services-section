# Gemini Inference Team

This sovereign settlement executes one operation: the typed RMN inference law
identified by `ni:///sha-256;h2VIEZwYH__6vRnSgSWYRrFh1AHFcIBFboED8rlsGgo`.
Its standard ERC-4337 boundary account is the chain-qualified account in
`content/evm/accounts/`; the executor reads the explicitly selected chain
binding rather than retaining an address-shaped copy. The chain binding is a
deployment parameter; no chain is selected by a package default.

The A2A runner requires `PORT`, `HOST`, and `BASE_URL`. `BASE_URL` is the public
ephemeral-runner URL (or an explicitly configured public gateway URL) and is
used to materialize every Agent Card interface. A runner without those values
refuses to start, because a loopback URL is not a public service contract.

The operation arrives as an A2A 1.0 Message through the independently hireable
A2A Services Section. Its `application/rmn+cbor` part is a product of
one task-scale effect cell and four Marks: instruction, input, provider model,
and execution mode. This team contracts the RMN Semantic Conformance service
to validate and decode the bundle; it does not carry an RMN implementation.

On completion or refusal, the team:

1. admits the provider result or refusal as an evidence Mark;
2. forms exactly one FOUR cover from bottom to positive or negative evidence;
3. obtains the completion bundle and WIT from the RMN provider;
4. returns the bundle and result through A2A; and
5. appends the act to its local WitnessJournal N-Quads.

Live provider access uses Google's official `@google/genai` SDK. Credentials are
injected into the contracted executor process and are never returned or written.
An ordinary JSON carrier selects Gemini's JSON response MIME type while leaving
schema acceptance with the customer. The stronger `json_schema` mode projects
the customer's compatible schema into the provider request only when the
customer explicitly purchases provider-side enforcement.
The superseded packet, child-contract, noncanonical-identity, and exchange-writer
implementations have no operational path.

The public Cloud Run service currently has a narrower transition boundary than
the Cold Red Gate release. Its digest-pinned hotfix image is built by
`content/deployment/cloud-run/cloudbuild.yaml`: the recipe refuses an
unexpected historical source shape and changes only ordinary JSON-carrier
admission. This is a rollback-capable bridge, not proof of package
cutover or permission to copy credentials into the image.

## Cold Red Gate lineage and deployment boundary

The active Cold Red Gate unit observed on 2026-08-29 still runs the historical
non-Git `@emsenn/gemini-inference-team` package from the former aggregate
logical-inference tree. Five of its six source and test files are byte-identical
to the dated `2026-07-20-logical-inference-service-section-rmn-runtime` capture
under this inference system's `lib/legacy/` tree. That establishes preservation
of the deployed source lineage; it does not make that historical deployment the
current package.

This package is the successor. It replaces the file-linked aggregate
dependencies and external RMN/RWIL systemd requirements with exact released
contracts, one local A2A runner, and explicit hired-provider endpoints. The
Cold Red Gate template is
`content/deployment/systemd-user/cold-red-gate/gemini-inference-a2a.service`.
It selects a release symlink, a separate writable state directory, and a
credential file outside the release. The template is repository evidence only:
Cold Red Gate has not been cut over to it, and capability delivery remains
unverified until a deployed health and typed-inference assay succeeds.
