import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {exchangeOpenAiCompatibleAssistantMessage} from '../../src/openai/openai-compatible-chat-completion.mjs';
import {withProviderCapacity} from '../../src/openai/provider-runtime.mjs';
test('provider transport deadline starts after its resource admission',async()=>{
 const root=mkdtempSync(join(tmpdir(),'provider-admission-'));mkdirSync(join(root,'data'));
 try{
  writeFileSync(join(root,'data/groq-last-live-admission'),String(Date.now())+'\n');
  let called=false;
  const result=await exchangeOpenAiCompatibleAssistantMessage({model:'qwen/qwen3.8-27b',messages:[{role:'user',content:'fixture'}],max_tokens:12},
   {providerId:'groq',chatCompletionsUrl:'https://api.groq.com/openai/v1/chat/completions',apiKey:'fixture',resourceRoot:root,
    env:{GROQ_INFERENCE_MIN_INTERVAL_MS:'80'},timeoutMs:10},
   async(_url,options)=>{assert.equal(options.signal.aborted,false);called=true;return Response.json({choices:[{message:{role:'assistant',content:'received'}}]});});
  assert.equal(called,true);assert.equal(result.ok,true);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('caller cancellation stops waiting admission and frees the kernel lease',async()=>{
 const root=mkdtempSync(join(tmpdir(),'provider-cancel-')),lock=join(root,'slot.lock');
 let entered,release;const ready=new Promise(resolve=>entered=resolve),held=new Promise(resolve=>release=resolve);
 const first=withProviderCapacity(lock,async()=>{entered();await held;});
 await ready;
 try{
  await assert.rejects(withProviderCapacity(lock,()=>assert.fail('cancelled waiter cannot act'),{signal:AbortSignal.timeout(30)}),{name:'AbortError'});
 }finally{release();await first;}
 assert.equal(await withProviderCapacity(lock,()=> 'next effect'), 'next effect');
 rmSync(root,{recursive:true,force:true});
});
