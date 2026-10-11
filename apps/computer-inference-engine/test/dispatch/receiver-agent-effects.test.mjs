import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadDirectEndpointProviderDescriptors, dispatchDirectEndpointOffer } from "../../src/dispatch/direct-endpoint-provider.mjs";
import { executeReceiverToolAgent } from "../../src/dispatch/receiver-agent.mjs";
import { createToolAgentBudget } from "../../src/openai/tool-agent.mjs";
import { runHordeTextExchange } from "../../src/horde/text-exchange.mjs";
import { decodeTextAssistantRequest } from "../../src/horde/assistant-request.mjs";

const operation = { type: "function", function: { name: "read_requirement", parameters: { type: "object", additionalProperties: false, properties: {}, required: [] } } };
const request = { role: "assistant", content: null, tool_calls: [{ id: "requirement-1", type: "function", function: { name: "read_requirement", arguments: "{}" } }] };
const source = 'export function activate(input) { return {kind:"actor-request",recipient:input.recipient,body:input.finding}; }';
const answer = { role: "assistant", content: JSON.stringify({ source }), tool_calls: [] };
const messages = [{ role: "user", content: "Read the requirement, then return the implementing module." }];
const execution = () => ({ maximumToolRounds: 2, maximumToolCalls: 2, maximumOutputTokens: 512,
  budget: createToolAgentBudget({ maximumRequests: 3, maximumToolCalls: 2, maximumOutputTokens: 1536 }) });
function descriptor(id) {
  return loadDirectEndpointProviderDescriptors({}, { pricingRoot: null }).find(row => row.providerId === id);
}

function commandFixture(mode = "normal") {
  const root = mkdtempSync(join(tmpdir(), "command-receiver-"));
  const code = `#!${process.execPath}\nimport {readFileSync,writeFileSync,readdirSync} from "node:fs";
const text = readFileSync(0,"utf8");
const packet = JSON.parse(text.slice(text.indexOf('{"assistantRequestSchema"')));
if(process.env.TEST_SECRET || readdirSync(process.cwd()).includes("private.txt")) process.exit(8);
const result = packet.messages.findLast(m=>m.role==="tool");
if(result && (result.tool_call_id!=="requirement-1" || JSON.parse(result.content).recipient!=="actor:recipient")) process.exit(9);
${mode === "cancel" ? 'setTimeout(()=>{},30000);' : `const message = result ? ${JSON.stringify(mode === "structured" ? {...answer,content:JSON.parse(answer.content)} : answer)} : ${JSON.stringify(mode === "ungranted" ? { ...request, tool_calls: [{ ...request.tool_calls[0], function: { name: "write_secret", arguments: "{}" } }] } : request)};
writeFileSync(process.argv[process.argv.indexOf("-o")+1],JSON.stringify(message));
console.log(JSON.stringify({type:"turn.completed",usage:{input_tokens:17,output_tokens:23}}));`}`;
  writeFileSync(join(root, "codex"), code, { mode: 0o755 });
  return { root, env: { ...process.env, PATH: root, TEST_SECRET: "must-never-enter-command" }, close: () => rmSync(root, { recursive: true, force: true }) };
}

test("command agent uses the receiver boundary and produces a module consumed for actor actuation", async () => {
  const f = commandFixture(); let reads = 0, reserved = 0;
  try {
    const d = descriptor("codex"); assert.equal(d.auth.mode, "none");
    const result = await dispatchDirectEndpointOffer(d, { messages, tools: [operation],
      toolHandlers: { read_requirement: () => { reads++; return { recipient: "actor:recipient" }; } },
      execution: { ...execution(), env: f.env } }, { invoke: async options => { reserved++; return executeReceiverToolAgent(options); } });
    assert.equal(reserved, 1, "the command agent passes through the same account reservation wrapper");
    assert.equal(result.disposition, "delivered"); assert.equal(reads, 1);
    assert.equal(result.exchanges.length, 2); assert.equal(result.exchanges[0].usage.outputTokens, 23);
    const module = await import("data:text/javascript," + encodeURIComponent(JSON.parse(result.text).source));
    assert.deepEqual(module.activate({ recipient: "actor:operator", finding: "move to the receiving area" }),
      { kind: "actor-request", recipient: "actor:operator", body: "move to the receiving area" });
    await assert.rejects(dispatchDirectEndpointOffer(d, { messages, execution: { zeroCashOnly: true } }), /zero-cash-entitlement-not-admitted/u);
  } finally { f.close(); }
});

test("ungranted command requests preserve residue without invoking a receiver operation", async () => {
  const f = commandFixture("ungranted"); let effects = 0;
  try {
    const result = await dispatchDirectEndpointOffer(descriptor("codex"), { messages, tools: [operation],
      toolHandlers: { read_requirement: () => { effects++; } }, execution: { ...execution(), env: f.env } });
    assert.equal(result.disposition, "refused"); assert.equal(result.cause.reason, "ungranted-tool-request");
    assert.equal(effects, 0); assert.equal(result.exchanges.length, 1);
  } finally { f.close(); }
});

test("specified final products cross the command carrier as JSON values without inferential string escaping", async () => {
  const f = commandFixture("structured");
  try {
    const result = await dispatchDirectEndpointOffer(descriptor("codex"), { messages, tools: [operation],
      toolHandlers: { read_requirement: () => ({recipient:"actor:recipient"}) },
      responseFormat: {type:"json_schema",json_schema:{schema:{type:"object",additionalProperties:false,required:["source"],properties:{source:{type:"string"}}}}},
      execution: {...execution(),env:f.env} });
    assert.equal(result.disposition,"delivered");
    assert.deepEqual(JSON.parse(result.text),{source});
  } finally {f.close();}
});

test("receiver cancellation kills its command exchange before tools can run", async () => {
  const f = commandFixture("cancel"); let effects = 0;
  try {
    const result = await dispatchDirectEndpointOffer(descriptor("codex"), { messages, tools: [operation],
      toolHandlers: { read_requirement: () => { effects++; } },
      execution: { ...execution(), env: f.env, signal: AbortSignal.timeout(200) } });
    assert.equal(result.disposition, "refused"); assert.equal(result.cause.kind, "cancelled");
    assert.equal(result.toolInvocations.length, 0); assert.equal(effects, 0);
  } finally { f.close(); }
});

test("native anonymous volunteer compute returns correlated receiver tools and their consumed product", async () => {
  const d = descriptor("ai-horde-anonymous"); let submitted = 0, reads = 0;
  const id = "00000000-0000-0000-0000-000000000123";
  const fetchImpl = async (url, init) => {
    assert.equal(init.headers.apikey, "0000000000");
    if (url.endsWith("workers?type=text")) return Response.json([{online:true,models:[d.model],max_length:512,max_context_length:4096}]);
    if (init.method === "POST") {
      const input = JSON.parse(init.body); assert.equal(input.context_fit, "grow"); assert.deepEqual(input.models, [d.model]);
      const envelope = JSON.parse(input.prompt.slice(input.prompt.indexOf('{"messages"'), input.prompt.lastIndexOf("<turn|>")));
      if (submitted) assert.equal(envelope.messages.findLast(m=>m.role==="tool").tool_call_id, "requirement-1");
      submitted++; return Response.json({ id });
    }
    assert.equal(init.method, undefined, "a completed request is never cancelled");
    return Response.json({ done: true, generations: [{ model: d.model, text: JSON.stringify(submitted === 1 ? request : answer) }], kudos: 1 });
  };
  const result = await dispatchDirectEndpointOffer(d, { messages, tools: [operation],
    toolHandlers: { read_requirement: () => { reads++; return { recipient: "actor:recipient" }; } },
    execution: { ...execution(), zeroCashOnly: true, fetchImpl } }, { invoke: executeReceiverToolAgent });
  assert.equal(result.disposition, "delivered"); assert.equal(reads, 1); assert.equal(submitted, 2);
  assert.equal(result.exchanges[0].usage.outputTokens, null, "volunteer usage is never invented from kudos");
  assert.equal(JSON.parse(result.text).source, source);
});

test("volunteer cancellation deletes only its admitted job using a separate cleanup lifetime", async () => {
  const controller = new AbortController(), id = "00000000-0000-0000-0000-000000000456", removed = [];
  const fetchImpl = async (url, init) => {
    if (url.endsWith("workers?type=text")) return Response.json([{online:true,models:[descriptor("ai-horde-anonymous").model],max_length:512,max_context_length:4096}]);
    if (init.method === "POST") return Response.json({ id });
    if (init.method === "DELETE") { assert.equal(init.signal.aborted, false); removed.push(url); return Response.json({}); }
    controller.abort(); return Response.json({ done: false });
  };
  const result = await runHordeTextExchange({ model: descriptor("ai-horde-anonymous").model, messages }, { fetchImpl, signal: controller.signal });
  assert.deepEqual(result.refusal.unmet, ["receiver-cancelled"]);
  assert.deepEqual(removed, [`https://aihorde.net/api/v2/generate/text/status/${id}`]);
});

test("native text tool grammar preserves literal arguments and refuses executable expressions", () => {
  const text = '<|tool_call_start|>[read_source(path="research.md", options={\'fresh\': True, \'held\': [None, 3]})]<|tool_call_end|>';
  const decoded = decodeTextAssistantRequest(text, "exchange:one");
  assert.deepEqual(JSON.parse(decoded.tool_calls[0].function.arguments), { path: "research.md", options: { fresh: true, held: [null, 3] } });
  assert.equal(decoded.tool_calls[0].id, "exchange:one:0");
  const jsonFrame = decodeTextAssistantRequest('<|tool_call_start|>{"name":"read_requirement","arguments":{}}<|tool_call_end|>', "json");
  assert.equal(jsonFrame.tool_calls[0].function.name, "read_requirement");
  assert.deepEqual(JSON.parse(jsonFrame.tool_calls[0].function.arguments), {});
  assert.throws(() => decodeTextAssistantRequest('<|tool_call_start|>{"name":"read_requirement","arguments":"execute me"}<|tool_call_end|>', "json"));
  assert.throws(() => decodeTextAssistantRequest('<|tool_call_start|>[read_source(path=__import__("os").system("id"))]<|tool_call_end|>', "x"));
  assert.throws(() => decodeTextAssistantRequest('<|tool_call_start|>[read_source(path="a",path="b")]<|tool_call_end|>', "x"));
  assert.equal(decodeTextAssistantRequest('<|tool_call_start|>read_source()<|tool_call_end|>Checking source.<|im_end|>', "x").content, "Checking source.");
  assert.throws(() => decodeTextAssistantRequest('<|tool_call_start|>[read_source()]<|tool_call_end|><|tool_call_start|>[write_secret()]<|tool_call_end|>', "x"));
});


test("development output instructions retain the optional executable handoff", async () => {
  const {dispatchInferenceAsConfiguredCustomer,CODEX_CUSTOMER} = await import("../../src/dispatch/inference-dispatch.mjs");
  const schema={type:"object",additionalProperties:false,required:["role","text","unresolved"],properties:{
   role:{const:"artifact-specifications"},text:{type:"string"},unresolved:{type:"array",items:{type:"string"}},product:{type:"object"}}};
  let instruction;
  await dispatchInferenceAsConfiguredCustomer({objective:"Produce an executable specification",context:"The native fabricator consumes product.schemaModules.",
   workType:"inquiry",outputSchema:schema},{customerActor:CODEX_CUSTOMER,zeroCashOnly:false,directDescriptors:[descriptor("codex")],
   procure:async()=>({disposition:"no-admissible-provider-offer",market:{admitted:[],refused:[]}}),
   directTransport:async call=>{
    instruction=call.messages.at(-1).content;
    return {type:"ReceiverOwnedToolAgentCompletion",text:JSON.stringify({role:"artifact-specifications",text:"Derived",unresolved:[],product:{schemaModules:[]}}),
     model:"default",durationMs:1,invocations:[],exchanges:[{finishReason:"stop",usage:{promptTokens:1,outputTokens:1,totalTokens:2}}]};
   }});
  assert.equal(typeof instruction,"string");
  assert.match(instruction,/Declared top-level properties: role, text, unresolved, product/u);
  assert.match(instruction,/optional and may be included/u);
  assert.doesNotMatch(instruction,/exactly these required properties/u);
});
