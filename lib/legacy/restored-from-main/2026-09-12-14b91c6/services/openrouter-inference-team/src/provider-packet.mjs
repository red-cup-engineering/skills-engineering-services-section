export function providerPacket({ instruction, input, model }) {
  let demand;
  try { demand = JSON.parse(input); }
  catch { throw new Error("typed inference input must be one JSON value"); }
  const maximumOutputTokens = demand?.executionBounds?.maximumOutputTokens;
  if (!Number.isInteger(maximumOutputTokens) || maximumOutputTokens < 1) {
    throw new Error("OpenRouter maximumOutputTokens must be a positive integer supplied by the consuming work lot");
  }
  return {
    model,
    messages: [{ role: "system", content: instruction }, { role: "user", content: input }],
    "max-tokens": maximumOutputTokens,
  };
}
