# Context-packet inference

The inference engine owns the complete context-packet flow:

- `packet.mjs` forms an immutable packet whose segments are independently content-addressed; `packet-carriers.mjs` exposes its request, result, and refusal schemas plus EAVT projection.
- `judgment.mjs` sends a packet through the shared provider runtime, repairs only malformed model replies, and computes the verdict locally.
- `trade.mjs` reconciles independently verified release and admission receipts into one exact tally.

Use the package exports for composition, or `judge-context-packet` for the stdin/JSON boundary. There is no service router or provider-specific context-judging executable.
