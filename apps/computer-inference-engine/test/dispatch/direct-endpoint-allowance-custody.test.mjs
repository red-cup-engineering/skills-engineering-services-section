import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {loadDirectEndpointProviderDescriptors,dispatchDirectEndpointOffer,directEndpointAdmissionReasons} from '../../src/dispatch/direct-endpoint-provider.mjs';
import {allowanceLedgerEvidence,recordAllowanceEvidence} from '../../src/media/allowance-ledger.mjs';
import {subscriptionAllowance} from '../../src/media/subscription-allowances.mjs';

test('actual response windows stay in admitted allowance custody despite ambient and execution substitution',async t=>{
  const root=mkdtempSync(join(tmpdir(),'inference-allowance-custody-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const owner=join(root,'owner.journal'),other=join(root,'other.journal');
  const env={INFERENCE_ALLOWANCE_LEDGER_FILE:owner,KEY:'public-assay-key',DIRECT_ENDPOINT_PROVIDERS:JSON.stringify([{
    provider:'urn:ame:allowance-custody-assay',endpoint:'https://provider.example/v1/chat/completions',apiKeyEnv:'KEY',model:'fixture',
    allowance:'openrouter-requests',availableCapacity:1,
  }])};
  const descriptor=loadDirectEndpointProviderDescriptors(env,{accountEntitlements:[]})[0];
  assert.ok(!JSON.stringify(descriptor).includes(owner));
  const prior=process.env.INFERENCE_ALLOWANCE_LEDGER_FILE;
  process.env.INFERENCE_ALLOWANCE_LEDGER_FILE=other;
  t.after(()=>{if(prior===undefined)delete process.env.INFERENCE_ALLOWANCE_LEDGER_FILE;else process.env.INFERENCE_ALLOWANCE_LEDGER_FILE=prior;});
  const now=Date.now();
  const result=await dispatchDirectEndpointOffer(descriptor,{
    messages:[{role:'user',content:'isolated fixture'}],
    execution:{now:()=>now,INFERENCE_ALLOWANCE_LEDGER_FILE:other,fetchImpl:async()=>new Response('{}',{headers:{
      'x-ratelimit-limit':'100','x-ratelimit-remaining':'75','x-ratelimit-reset':String(now+3600000),
    }})},
  },{invoke:async({fetchImpl})=>{
    await fetchImpl('https://provider.example/v1/chat/completions',{body:'{}'});
    return {type:'ReceiverOwnedToolAgentCompletion',text:'fixture',invocations:[],exchanges:[]};
  }});
  assert.equal(result.disposition,'delivered');
  const evidence=allowanceLedgerEvidence('openrouter-requests',{storePath:owner});
  assert.equal(evidence.length,1);
  assert.equal(evidence[0].type,'reading');assert.equal(evidence[0].used,25);
  assert.deepEqual(allowanceLedgerEvidence('openrouter-requests',{storePath:other}),[]);
  recordAllowanceEvidence(subscriptionAllowance('openrouter-requests'),[{
    type:'reading',meter:'requests',at:new Date(now).toISOString(),used:100,resetsAt:new Date(now+3600000).toISOString(),source:'isolated-exhausted-window',
  }],{storePath:owner});
  assert.ok(directEndpointAdmissionReasons(loadDirectEndpointProviderDescriptors(env,{accountEntitlements:[]})[0]).includes('no-available-capacity'));
  assert.equal(loadDirectEndpointProviderDescriptors({...env,INFERENCE_ALLOWANCE_LEDGER_FILE:other},{accountEntitlements:[]})[0].availableCapacity,1);
});
