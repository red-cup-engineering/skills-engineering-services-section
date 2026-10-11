// Liquid's documented Pythonic tool wire is a data language, never Python execution:
// https://docs.liquid.ai/lfm/key-concepts/tool-use
// Only named calls and JSON-compatible literals are admitted. The receiver's typed
// platform still decides which names, argument schemas and effects are granted.
export function decodeTextAssistantRequest(text, exchangeId) {
  let message;
  try { message = JSON.parse(text); } catch { /* Native text and tool frames have distinct grammars. */ }
  if (message?.role === "assistant" || message?.tool_calls !== undefined) return message;
  if (!text.includes("<|tool_call")) return { role: "assistant", content: text, tool_calls: [] };
  const frame = /^\s*<\|tool_call_start\|>([\s\S]*?)<\|tool_call_end\|>([\s\S]*)$/u.exec(text);
  if (!frame || frame[1].length > 262144) throw new TypeError("unsupported-text-tool-frame");
  const input = frame[1];
  const content = frame[2].replace(/<\|im_end\|>\s*$/u, "").trim();
  if (content.includes("<|tool_call")) throw new TypeError("multiple-text-tool-frames");
  // Native JSON frames carry the same inert name/argument data as literal calls.
  let framed;
  try { framed = JSON.parse(input); } catch { /* Fall through to the literal grammar. */ }
  if (framed !== undefined) {
    const requests = Array.isArray(framed) ? framed : [framed];
    if (!requests.length || requests.some(call => !call || Object.keys(call).some(key => !["name", "arguments"].includes(key))
      || typeof call.name !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(call.name)
      || !call.arguments || typeof call.arguments !== "object" || Array.isArray(call.arguments)))
      throw new TypeError("invalid-json-text-tool-frame");
    return { role: "assistant", content: content || null, tool_calls: requests.map((call, ordinal) => ({
      id: `${exchangeId}:${ordinal}`, type: "function", function: { name: call.name, arguments: JSON.stringify(call.arguments) }
    })) };
  }
  let cursor = 0;
  const skip = () => { while (/\s/u.test(input[cursor] ?? "") && cursor < input.length) cursor++; };
  const take = token => { skip(); if (!input.startsWith(token, cursor)) throw new TypeError("invalid-text-tool-syntax"); cursor += token.length; };
  const identifier = () => { skip(); const match = /^[A-Za-z_][A-Za-z0-9_]*/u.exec(input.slice(cursor)); if (!match) throw new TypeError("invalid-text-tool-name"); cursor += match[0].length; return match[0]; };
  const string = () => {
    skip(); const quote = input[cursor++]; let value = "";
    for (;;) {
      const char = input[cursor++];
      if (char === undefined || char.charCodeAt(0) < 32) throw new TypeError("invalid-text-tool-string");
      if (char === quote) return value;
      if (char !== "\\") { value += char; continue; }
      const escaped = input[cursor++], escapes = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "\\": "\\", "'": "'", '"': '"', "/": "/" };
      if (escaped === "u") {
        const hex = input.slice(cursor, cursor + 4); if (!/^[0-9a-f]{4}$/iu.test(hex)) throw new TypeError("invalid-text-tool-escape");
        value += String.fromCharCode(parseInt(hex, 16)); cursor += 4;
      } else if (Object.hasOwn(escapes, escaped)) value += escapes[escaped];
      else throw new TypeError("invalid-text-tool-escape");
    }
  };
  const literal = (depth = 0) => {
    if (depth > 64) throw new TypeError("text-tool-literal-depth-exceeded");
    skip(); const char = input[cursor];
    if (char === '"' || char === "'") return string();
    if (char === "[" || char === "{") {
      const object = char === "{", end = object ? "}" : "]", entries = []; take(char); skip();
      while (input[cursor] !== end) {
        if (object) { if (!["'", '"'].includes(input[cursor])) throw new TypeError("text-tool-object-key-not-string"); const key = string(); take(":"); entries.push([key, literal(depth + 1)]); }
        else entries.push(literal(depth + 1));
        skip(); if (input[cursor] === end) break; take(","); skip();
      }
      take(end);
      if (object && new Set(entries.map(([key]) => key)).size !== entries.length) throw new TypeError("duplicate-text-tool-key");
      return object ? Object.fromEntries(entries) : entries;
    }
    for (const [word, value] of [["True", true], ["False", false], ["None", null], ["true", true], ["false", false], ["null", null]]) {
      if (input.startsWith(word, cursor) && !/[A-Za-z0-9_]/u.test(input[cursor + word.length] ?? "")) { cursor += word.length; return value; }
    }
    const number = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/u.exec(input.slice(cursor));
    if (!number || !Number.isFinite(Number(number[0]))) throw new TypeError("text-tool-argument-not-literal");
    const value = Number(number[0]);
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) throw new TypeError("text-tool-integer-not-exact");
    cursor += number[0].length; return value;
  };
  skip(); const list = input[cursor] === "[";
  if (list) take("[");
  const calls = []; skip();
  while (list ? input[cursor] !== "]" : calls.length === 0) {
    const name = identifier(), entries = []; take("("); skip();
    while (input[cursor] !== ")") {
      const key = identifier(); take("="); entries.push([key, literal()]); skip();
      if (input[cursor] === ")") break; take(","); skip();
    }
    take(")");
    if (new Set(entries.map(([key]) => key)).size !== entries.length) throw new TypeError("duplicate-text-tool-argument");
    calls.push({ id: `${exchangeId}:${calls.length}`, type: "function", function: { name, arguments: JSON.stringify(Object.fromEntries(entries)) } });
    skip(); if (!list || input[cursor] === "]") break; take(","); skip();
  }
  if (list) take("]"); skip(); if (cursor !== input.length || !calls.length) throw new TypeError("invalid-text-tool-call-list");
  return { role: "assistant", content: content || null, tool_calls: calls };
}
