# Gemini Inference Team

This sovereign settlement executes one operation: the typed RMN inference law
identified by `ni:///sha-256;h2VIEZwYH__6vRnSgSWYRrFh1AHFcIBFboED8rlsGgo`.
Its standard ERC-4337 boundary account is the chain-qualified account in
`content/evm/accounts/eip155-31337.json`; the executor reads that binding rather
than retaining an address-shaped copy.

The operation arrives as an A2A 1.0 Message through the independently hireable
A2A Services Section. Its canonical `application/rmn+cbor` part is a product of
one task-scale effect cell and four Marks: instruction, input, provider model,
and execution mode. This team contracts the RMN Semantic Conformance service
to validate and decode the bundle; it does not carry an RMN implementation.

On completion or refusal, the team:

1. admits the provider result or refusal as an evidence Mark;
2. forms exactly one FOUR cover from bottom to positive or negative evidence;
3. obtains the completion bundle and WIT from the RMN provider;
4. returns the canonical bundle and result through A2A; and
5. appends the act to its local RWIL N-Quads.

Live provider access uses Google's official `@google/genai` SDK. Credentials are
injected into the contracted executor process and are never returned or written.
The superseded packet, child-contract, noncanonical-identity, and exchange-writer
implementations have no operational path.
