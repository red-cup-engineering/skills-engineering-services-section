import assert from 'node:assert/strict';import test from 'node:test';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {dispatchInferenceAsConfiguredCustomer,CODEX_CUSTOMER} from '../../src/dispatch/inference-dispatch.mjs';
import {loadDirectEndpointProviderDescriptors} from '../../src/dispatch/direct-endpoint-provider.mjs';
import {executeOpenAiCompatibleToolAgent,executeOpenAiCompatibleAssistantTurn} from '../../src/openai/tool-agent.mjs';
import {inferenceCallFromOpenAIChat,inferenceCallToOpenAIChat} from '../../src/openai/chat-completions/inference.mjs';
import {openAiChatMessageCarrier} from '../../src/openai/chat-completion-carriers.mjs';
import {CHAT_COMPLETION_TURN_INPUT_SCHEMA} from '../../src/openai/chat-turn-contract.mjs';
import {validateJsonSchema} from '@red-cup-engineering/json-schema-services-section/validation';
const TOOL={type:'function',function:{name:'read_source',parameters:{type:'object',properties:{id:{type:'string'}},required:['id'],additionalProperties:false}}};
const nativeCall={id:'source-1',type:'function',function:{name:'read_source',arguments:'{"id":"admitted-source"}'},extra_content:{google:{thought_signature:'opaque-native-continuation'}}};
const assistant={role:'assistant',content:null,extra_content:{google:{thought:true}},tool_calls:[nativeCall]};
const wire=message=>({id:'continuity',object:'chat.completion',created:1,model:'model',choices:[{index:0,message,finish_reason:message.tool_calls?'tool_calls':'stop'}],usage:{prompt_tokens:7,completion_tokens:3,total_tokens:10}});
function fixture(t){
 const root=mkdtempSync(join(tmpdir(),'agent-continuity-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const environment={INFERENCE_WORK_LOT_DATA_ROOT:root,DIRECT_ENDPOINT_PROVIDERS:JSON.stringify([{provider:'urn:ame:continuity',endpoint:'http://127.0.0.1:19/v1/chat/completions',model:'model',apiKey:'fixture',zeroCashPolicy:{cashCost:'zero',paidOverage:'forbidden',local:true},capabilities:['chat','tool-calling'],effects:['read-only'],idempotence:['idempotent'],authorityScopes:['urn:scope:bounded-inference-candidate'],availableCapacity:1,declaredResources:[{resource:'provider-attention',unit:'bounded-lot',numerator:'1',denominator:'1'}],considerationKind:'quota',considerationAsset:'urn:union:consideration:free-tier-inference',considerationUnit:'provider-invocation',considerationNumerator:'1',considerationDenominator:'1'}])};
 return{environment,directDescriptors:loadDirectEndpointProviderDescriptors(environment),pricingRoot:null,customerActor:CODEX_CUSTOMER};
}
test('signature-bearing assistant continuation survives every native wire reader',async()=>{
 openAiChatMessageCarrier.assert(assistant);
 assert.equal(validateJsonSchema({messages:[assistant],tools:[TOOL]},CHAT_COMPLETION_TURN_INPUT_SCHEMA).valid,true);
 const input={model:'model',messages:[{role:'user',content:'read'},assistant,{role:'tool',tool_call_id:'source-1',content:'{"text":"observed"}'}],tools:[TOOL]};
 const neutral=inferenceCallFromOpenAIChat(input,{request:'urn:request',subject:'urn:actor',observedAt:'2026-10-07T00:00:00Z'});
 const projected=inferenceCallToOpenAIChat(neutral);
 assert.deepEqual(projected.messages,input.messages);
 assert.throws(()=>inferenceCallToOpenAIChat({...neutral,messages:[{...neutral.messages[0],extensions:{'openai.chat-completions.message.extensions':{role:'system'}}}]}),/cannot override/);
});
test('separately received assistant turns retain native continuation information',async t=>{
 const options=fixture(t),packets=[];
 const transport=call=>executeOpenAiCompatibleAssistantTurn({...call,fetchImpl:async(_url,init)=>{
  const packet=JSON.parse(init.body);packets.push(packet);
  if(packets.length===2)assert.deepEqual(packet.messages[1],assistant);
  return Response.json(wire(packets.length===1?assistant:{role:'assistant',content:'continued'}));
 }});
 const first=await dispatchInferenceAsConfiguredCustomer({workLotId:'urn:work:turn:first',objective:'read',zeroCashOnly:true,chatCompletion:{messages:[{role:'user',content:'read'}],tools:[TOOL]}},{...options,directTransport:transport});
 assert.deepEqual(first.candidate.choices[0].message,assistant);
 const second=await dispatchInferenceAsConfiguredCustomer({workLotId:'urn:work:turn:second',objective:'continue',zeroCashOnly:true,chatCompletion:{messages:[{role:'user',content:'read'},first.candidate.choices[0].message,{role:'tool',tool_call_id:'source-1',content:'{"text":"observed"}'}],tools:[TOOL]}},{...options,directTransport:transport});
 assert.equal(second.candidate.choices[0].message.content,'continued');assert.equal(packets.length,2);
});
test('schema repair consumes the executed source conversation without repeating its effect',async t=>{
 let effects=0;const packets=[],options=fixture(t);
 const result=await dispatchInferenceAsConfiguredCustomer({workLotId:'urn:work:repair',objective:'Read the source and return its value in text.',context:'receiver-granted source',outputSchema:{type:'object',properties:{text:{type:'string'}},required:['text'],additionalProperties:false},zeroCashOnly:true,agentBounds:{maximumRequests:3,maximumToolCalls:1,maximumToolRounds:1,maximumOutputTokens:96,maximumTokensPerRequest:32}},{...options,directTools:[TOOL],directToolHandlers:{read_source:async()=>{effects++;return{text:'actual-source-observation'}}},directTransport:call=>executeOpenAiCompatibleToolAgent({...call,fetchImpl:async(_url,init)=>{
  const packet=JSON.parse(init.body);packets.push(packet);
  if(packets.length===1)return Response.json(wire(assistant));
  if(packets.length===2)return Response.json(wire({role:'assistant',content:'{"value":"actual-source-observation"}'}));
  assert.deepEqual(packet.messages.find(m=>m.tool_calls),assistant);
  assert.equal(packet.messages.find(m=>m.role==='tool').content,'{"text":"actual-source-observation"}');
  assert.equal(packet.messages.at(-2).content,'{"value":"actual-source-observation"}');
  return Response.json(wire({role:'assistant',content:'{"text":"actual-source-observation"}'}));
 }})});
 assert.deepEqual(result.candidate,{text:'actual-source-observation'});assert.equal(effects,1);assert.equal(packets.length,3);
 assert.deepEqual(result.providerEvidence.outputs,['{"value":"actual-source-observation"}','{"text":"actual-source-observation"}']);
 assert.equal(result.providerEvidence.messages.filter(m=>m.role==='tool').length,1);
 assert.deepEqual(result.providerEvidence.exchanges[0].message,assistant);
 assert.equal(result.providerEvidence.sharedBudgetRemaining.requests,0);
 assert.equal(result.integrationAccepted,false);
});
test('an unrepairable delivery keeps the actual output for the next warranted transformation',async t=>{
 const options=fixture(t);
 const result=await dispatchInferenceAsConfiguredCustomer({workLotId:'urn:work:refused',objective:'Return JSON',context:'receiver-granted work',zeroCashOnly:true,outputSchema:{type:'object',required:['text']}},{...options,directTransport:call=>executeOpenAiCompatibleToolAgent({...call,fetchImpl:async()=>Response.json(wire({role:'assistant',content:'The supplied work order lacks a readable source.'}))})});
 assert.equal(result.outcome,'market-residue');
 const evidence=result.directLaneRefusals[0].providerEvidence;
 assert.deepEqual(evidence.outputs,['The supplied work order lacks a readable source.']);
 assert.equal(evidence.messages.at(-1).content,evidence.outputs[0]);
 assert.equal(evidence.exchanges[0].message.content,evidence.outputs[0]);
});
