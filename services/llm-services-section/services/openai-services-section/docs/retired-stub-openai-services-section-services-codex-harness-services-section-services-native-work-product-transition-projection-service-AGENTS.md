# Native Work Product Transition Projection Actor

This Actor owns one deterministic projection. It accepts native inference text
and returns one proposed transition or an explicit refusal.

It MUST NOT call inference, execute a transition, inspect a repository, admit
the transition, claim acceptance, or require an LLM to emit perfect JSON. It
MUST preserve useful prose work products carried by the declared finish
markers. JSON is accepted only as one optional carrier.
