// This is the provider's own standing completion ceiling.  The market may
// request less, but no untrusted packet or Groq default may widen the offer
// the provider advertised to customers.
export const MAXIMUM_OUTPUT_TOKENS = 900;

export function boundedGroqRequest(packet) {
  const requested = packet["max-tokens"];
  const maximum = Number.isInteger(requested) && requested > 0
    ? Math.min(requested, MAXIMUM_OUTPUT_TOKENS)
    : MAXIMUM_OUTPUT_TOKENS;
  return Object.freeze({
    model: packet.model,
    messages: packet.messages,
    ...(packet.params || {}),
    max_tokens: maximum,
  });
}
