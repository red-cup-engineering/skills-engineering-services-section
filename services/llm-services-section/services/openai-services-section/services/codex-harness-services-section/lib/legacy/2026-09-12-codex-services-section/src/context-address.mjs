const ROOT = Object.freeze(["codex", "actor", "bare-cedar-fog-codex"]);
const DEFINITIONS = Object.freeze({
  SessionStart: Object.freeze({ suffix: ["continuity", "session-start"], type: "CodexContinuityLocator", resolver: "observe_codex_session_context" }),
  UserPromptSubmit: Object.freeze({ suffix: ["prompt-cycle", "active"], type: "CodexPromptContextLocator", resolver: "observe_codex_prompt_context" }),
  PostToolUse: Object.freeze({ suffix: ["evidence", "current-tool-result"], type: "CodexToolEvidenceLocator", resolver: "observe_codex_tool_context" }),
});
const render = (parts) => parts.join("/");

export function contextAddressForHookEvent(event) {
  const definition = DEFINITIONS[event];
  if (!definition) throw new TypeError("hook event has no context-address derivation");
  return Object.freeze({ address: render([...ROOT, ...definition.suffix]), type: definition.type, resolver: definition.resolver });
}

export function parseCodexContextAddress(value) {
  const address = String(value ?? "");
  const found = Object.entries(DEFINITIONS).find(([, definition]) => address === render([...ROOT, ...definition.suffix]));
  if (!found) throw new TypeError("context address is not a canonical Codex proof-path selector");
  const [event, definition] = found;
  return Object.freeze({ event, address, type: definition.type, resolver: definition.resolver });
}

export function contextResolverContract(address) {
  const parsed = parseCodexContextAddress(address);
  return Object.freeze({ type: "CodexContextResolution", address: parsed.address, resourceType: parsed.type, operation: parsed.resolver, arguments: { address: parsed.address } });
}
