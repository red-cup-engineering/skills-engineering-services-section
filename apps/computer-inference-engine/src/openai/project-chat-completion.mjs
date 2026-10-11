function nonemptyText(value) {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function toolCallCarrier(call) {
  const name = nonemptyText(call?.function?.name);
  const args = typeof call?.function?.arguments === "string"
    ? call.function.arguments.trim()
    : "";
  if (!name) return null;
  return `<tool_call>${name}${args ? ` ${args}` : ""}</tool_call>`;
}

/**
 * Preserve the useful carriers of one OpenAI-compatible assistant message.
 *
 * Providers legitimately return null content for tool-calling turns and may
 * carry reasoning separately. This projection does not decide which material
 * satisfies a customer's contract; the customer's deterministic assay does.
 */
export function projectChatCompletion(parsed) {
  const choice = parsed?.choices?.[0];
  const message = choice?.message;
  if (!message || typeof message !== "object") {
    return { text: "", carriers: [], choice: null };
  }

  const carriers = [];
  const add = (kind, text) => {
    const value = nonemptyText(text);
    if (value && !carriers.some((carrier) => carrier.text === value)) {
      carriers.push({ kind, text: value });
    }
  };

  // Both spellings are witnessed across OpenAI-compatible providers.
  add("reasoning", message.reasoning_content);
  add("reasoning", message.reasoning);
  add("content", message.content);

  for (const call of message.tool_calls ?? []) {
    add("tool-call", toolCallCarrier(call));
  }
  add("tool-call", toolCallCarrier(
    message.function_call
      ? { function: message.function_call }
      : null,
  ));

  return {
    text: carriers.map(({ text }) => text).join("\n"),
    carriers: carriers.map(({ kind }) => kind),
    choice,
  };
}
