import assert from 'node:assert/strict';import test from 'node:test';
import {exchangeOpenAiCompatibleAssistantMessage} from '../../src/openai/openai-compatible-chat-completion.mjs';
import {executeOpenAiCompatibleToolAgent} from '../../src/openai/tool-agent.mjs';
import {admitCloudflareFreeInvocation} from '../../src/openai/cloudflare-free-tier-admission.mjs';
const endpoint='https://api.cloudflare.com/client/v4/accounts/test-account/ai/v1/chat/completions';
const env={API_KEY_CLOUDFLARE_BILLING_READ:'private-account-read'};
const free=[{state:'Paid',rate_plan:{id:'free',public_name:'Cloudflare Free Plan'}},{state:'Paid',rate_plan:{id:'r2_paid',public_name:'R2 Paid'}}];
const account=rows=>Response.json({success:true,result:rows});
test('the actual endpoint account controls zero-cash admission before any inference exchange',async()=>{
 for(const [rows,reason]of [[free,null],[[...free,{state:'Paid',rate_plan:{id:'workers_paid',public_name:'Workers Paid'}}],'cloudflare-workers-paid-or-unknown-plan'],[[{state:'Paid',rate_plan:{id:'workers_unknown',public_name:'Workers'}}],'cloudflare-free-plan-not-observed']]){
  const calls=[];
  const result=await exchangeOpenAiCompatibleAssistantMessage({model:'@cf/openai/gpt-oss-120b',messages:[{role:'user',content:'read'}],max_tokens:64},{providerId:'alias',chatCompletionsUrl:endpoint,apiKey:'private-inference-key',env,execution:{}},async(url,init)=>{
   calls.push(url);
   if(url.endsWith('/subscriptions')){assert.equal(init.headers.authorization,'Bearer private-account-read');return account(rows);}
   return Response.json({choices:[{message:{role:'assistant',content:'observed'}}]});
  });
  assert.equal(result.ok,reason===null);
  assert.equal(calls.length,reason===null?2:1);
  if(reason)assert.equal(result.cause.reason,reason);
 }
});
test('every tool turn carries the vendor content projection while native observations remain exact',async()=>{
 const tool={type:'function',function:{name:'read_source',parameters:{type:'object',additionalProperties:false}}};
 let checks=0,exchanges=0,effects=0;
 const original={role:'assistant',content:null,tool_calls:[{id:'native-1',type:'function',function:{name:'read_source',arguments:'{}'}}]};
 const result=await executeOpenAiCompatibleToolAgent({provider:'alias',endpoint,apiKey:'private-inference-key',env,model:'@cf/openai/gpt-oss-120b',messages:[{role:'user',content:'read'}],tools:[tool],toolHandlers:{read_source:async()=>{effects++;return{text:'actual-observation'}}},maximumToolRounds:1,maximumToolCalls:1,fetchImpl:async(url,init)=>{
  if(url.endsWith('/subscriptions')){checks++;return account(free);}
  exchanges++;const request=JSON.parse(init.body);
  assert.equal(new Headers(init.headers).get('authorization'),'Bearer private-inference-key');
  assert.equal(JSON.stringify(request).includes('private-account-read'),false);
  if(exchanges===2){assert.equal(request.messages[1].content,'');assert.deepEqual(request.messages[1].tool_calls,original.tool_calls);assert.equal(request.messages[2].tool_call_id,'native-1');}
  return Response.json({model:'@cf/openai/gpt-oss-120b',choices:[{message:exchanges===1?original:{role:'assistant',content:'actual-observation'},finish_reason:exchanges===1?'tool_calls':'stop'}],usage:{prompt_tokens:4,completion_tokens:2,total_tokens:6}});
 }});
 assert.equal(result.text,'actual-observation');assert.equal(effects,1);assert.equal(checks,2);assert.equal(exchanges,2);
 assert.deepEqual(result.messages[1],original);assert.deepEqual(result.exchanges[0].message,original);
});
test('an unverifiable or paid account cannot execute a model-selected tool',async()=>{
 let effects=0,requests=0;
 const result=await executeOpenAiCompatibleToolAgent({provider:'cloudflare-workers-ai',endpoint,apiKey:'private-inference-key',env:{},model:'@cf/openai/gpt-oss-120b',messages:[{role:'user',content:'read'}],tools:[{type:'function',function:{name:'read',parameters:{type:'object'}}}],toolHandlers:{read:()=>effects++},fetchImpl:async()=>{requests++;assert.fail('missing account binding cannot reach HTTP')}});
 assert.equal(result.cause.reason,'cloudflare-billing-read-binding-unavailable');assert.equal(effects,0);assert.equal(requests,0);
 await assert.rejects(admitCloudflareFreeInvocation({endpoint,env,fetchImpl:async()=>account([{state:'Paid',rate_plan:{id:'free'}},{state:'Paid',rate_plan:{id:'workers_advanced',public_name:'Workers Advanced'}}])}),/paid-or-unknown/);
});

test('the additional exact-model offering inherits executable account policy and private credentials',async()=>{
 const {providerConfiguration}=await import('../../src/openai/provider-runtime.mjs');
 const {loadDirectEndpointProviderDescriptors}=await import('../../src/dispatch/direct-endpoint-provider.mjs');
 const policy=providerConfiguration('cloudflare-workers-ai-gpt-oss');
 assert.equal(policy.defaultModel,'@cf/openai/gpt-oss-120b');
 assert.equal(policy.execution.cloudflareFreeAccountPreflight,true);
 const admitted=loadDirectEndpointProviderDescriptors({CLOUDFLARE_ACCOUNT_ID:'test-account',API_KEY_CLOUDFLARE_WORKERS_AI:'fixture-inference'});
 const offering=admitted.find(d=>d.providerId==='cloudflare-workers-ai-gpt-oss');
 assert.ok(offering);
 assert.equal(offering.endpoint,endpoint);
 assert.equal(offering.apiKey,'fixture-inference');
 assert.equal(offering.model,'@cf/openai/gpt-oss-120b');
 assert.ok(offering.capabilities.includes('tool-calling'));
 const rows=[{providerId:'root',chatCompletionsUrl:endpoint,execution:{cloudflareFreeAccountPreflight:true}},{providerId:'branch',providerFamily:'root'},{providerId:'leaf',providerFamily:'branch',defaultModel:'model'}];
 assert.equal(providerConfiguration('leaf',rows).execution.cloudflareFreeAccountPreflight,true);
 assert.throws(()=>providerConfiguration('leaf',[{providerId:'leaf',providerFamily:'leaf'}]),/cyclic provider family/);
});
