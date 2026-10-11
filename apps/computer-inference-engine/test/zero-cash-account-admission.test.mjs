import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {loadDirectEndpointProviderDescriptors,directEndpointAdmissionReasons,dispatchDirectEndpointOffer} from '../src/dispatch/direct-endpoint-provider.mjs';
const at=Date.parse('2026-10-07T12:00:00Z'), key='fixture-private-key';
const descriptor={provider:'urn:ame:fixture',endpoint:'https://example.invalid/v1/chat/completions',model:'fixture',apiKey:key,capabilities:['chat']};
const observation={type:'ProviderAccountEntitlementObservation',providerIdentity:descriptor.provider,endpoint:descriptor.endpoint,model:descriptor.model,credentialSha256:createHash('sha256').update(key).digest('hex'),accountIdentity:'projects/fixture',evidenceIdentity:'urn:fixture:account-observation',observedAt:new Date(at).toISOString(),validUntil:new Date(at+3600000).toISOString(),cashCost:'zero',paidOverage:'forbidden',billingEnabled:false,billingAccountBound:false};
const load=(rows,now=()=>at+1,entry=descriptor)=>loadDirectEndpointProviderDescriptors({DIRECT_ENDPOINT_PROVIDERS:JSON.stringify([entry])},{accountEntitlements:rows,pricingRoot:null,now})[0];
test('Zero-cash admission binds the exact observed credential, model, endpoint and billing state',()=>{
 assert.deepEqual(directEndpointAdmissionReasons(load([observation]),{zeroCashOnly:true}),[]);
 for(const change of [{credentialSha256:'changed'},{model:'other'},{endpoint:'https://other.invalid'},{billingEnabled:true},{billingAccountBound:true}]){
  assert.ok(directEndpointAdmissionReasons(load([{...observation,...change}]),{zeroCashOnly:true}).includes('zero-cash-entitlement-not-admitted'));
 }
});
test('A declared zero-cash policy cannot fabricate a live account observation',()=>{
 const row=load([],()=>at+1,{...descriptor,zeroCashPolicy:{cashCost:'zero',paidOverage:'forbidden'}});
 assert.ok(directEndpointAdmissionReasons(row,{zeroCashOnly:true}).includes('zero-cash-entitlement-not-admitted'));
 assert.deepEqual(directEndpointAdmissionReasons(row),[]);
});
test('An account observation that expires after selection blocks transport',async()=>{
 let now=at+1,called=false; const row=load([observation],()=>now);
 assert.deepEqual(directEndpointAdmissionReasons(row,{zeroCashOnly:true}),[]);
 now=at+3600000;
 await assert.rejects(dispatchDirectEndpointOffer(row,{messages:[{role:'user',content:'Harmless fixture'}],execution:{zeroCashOnly:true}},{invoke:async()=>{called=true;}}),/zero-cash-entitlement-not-admitted/);
 assert.equal(called,false);
});
