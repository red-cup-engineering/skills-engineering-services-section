import { randomUUID } from "node:crypto";
import { sha256Hex } from "@red-cup-engineering/cryptographic-data-service/integrity";
import { createR2RestClient, r2RestConfiguration } from "@red-cup-engineering/cloudflare-r2-services-section/r2-rest";

const encode = (value) => new TextEncoder().encode(JSON.stringify(value));
const digest = (value) => sha256Hex(value);
const keyId = (key) => digest(JSON.stringify(key));
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
function decode(remote,label){try{return JSON.parse(Buffer.from(remote.body).toString("utf8"));}catch(error){throw new Error(`${label} is not JSON: ${error.message}`);}}
async function list(client,prefix,label){const keys=[];let cursor;do{const page=await client.list(prefix,cursor);keys.push(...page.keys);cursor=page.continuationToken;}while(cursor!==undefined);return(await Promise.all(keys.map(async(key)=>{const remote=await client.get(key);return remote===null?null:{key,value:decode(remote,label)};}))).filter(Boolean);}
function page(items,cursor,limit){const offset=cursor===undefined?0:Number(cursor);if(!Number.isSafeInteger(offset)||offset<0)throw new TypeError("ActivityPub custody cursor is invalid");const selected=items.slice(offset,offset+limit);return{items:selected,totalItems:items.length,...(offset+selected.length<items.length?{nextCursor:String(offset+selected.length)}:{})};}
function kv(client,prefix){let writes=Promise.resolve();const path=(key)=>`${prefix}/kv/${keyId(key)}.json`;const serial=(operation)=>{const next=writes.then(operation,operation);writes=next.then(()=>undefined,()=>undefined);return next;};const read=async(key)=>{const remote=await client.get(path(key));return remote===null?null:decode(remote,"ActivityPub KV");};return Object.freeze({async get(key){const row=await read(key);return row===null||row.deleted===true||(row.expiresAt!==null&&Date.now()>=row.expiresAt)?undefined:row.value;},async set(key,value,options={}){const milliseconds=options.ttl===undefined?null:Number(options.ttl.total({unit:"milliseconds"}));await serial(()=>client.putCurrent(path(key),{body:encode({key,value,deleted:false,expiresAt:milliseconds===null?null:Date.now()+milliseconds}),mediaType:"application/json"}));},async delete(key){await serial(()=>client.putCurrent(path(key),{body:encode({key,value:null,deleted:true,expiresAt:null}),mediaType:"application/json"}));},async cas(key,expectedValue,newValue,options={}){return serial(async()=>{const row=await read(key);const current=row===null||row.deleted===true?undefined:row.value;if(JSON.stringify(current)!==JSON.stringify(expectedValue))return false;const milliseconds=options.ttl===undefined?null:Number(options.ttl.total({unit:"milliseconds"}));await client.putCurrent(path(key),{body:encode({key,value:newValue,deleted:false,expiresAt:milliseconds===null?null:Date.now()+milliseconds}),mediaType:"application/json"});return true;});},async *list(prefixKey=undefined){for(const {value} of await list(client,`${prefix}/kv/`,"ActivityPub KV")){if(value.deleted===true)continue;if(prefixKey!==undefined&&!prefixKey.every((part,index)=>value.key[index]===part))continue;yield{key:value.key,value:value.value};}}});}
function inbox(client,prefix){const root=`${prefix}/inbox/`;return Object.freeze({async retain(arrival){const activity=arrival?.jsonLd;if(!activity||typeof activity!=="object")throw new TypeError("verified ActivityPub arrival is required");const identity=typeof activity.id==="string"&&activity.id?activity.id:JSON.stringify(activity);await client.putCurrent(`${root}${digest(identity)}.json`,{body:encode({receivedAt:new Date().toISOString(),activity}),mediaType:"application/json"});},async list({cursor,limit}){const rows=await list(client,root,"ActivityPub inbox");return page(rows.map(({value})=>value).sort((a,b)=>String(b.receivedAt).localeCompare(String(a.receivedAt))).map(({activity})=>activity),cursor,limit);}});}
function queue(client,prefix){
  const root=`${prefix}/queue/`; let listener;
  const rows=()=>list(client,root,"ActivityPub queue");
  const priority=({value})=>value.message?.type==="inbox"?0:1;
  async function settle(handler,{key,value}){
    try {
      await client.putCurrent(key,{body:encode({...value,status:"processing"}),mediaType:"application/json"});
      await handler(value.message);
      await client.putCurrent(key,{body:encode({...value,status:"done",completedAt:new Date().toISOString(),lastError:null}),mediaType:"application/json"});
    } catch(error) {
      const lastError=(error instanceof Error?error.stack??error.message:String(error)).slice(0,4000);
      process.stderr.write(`ActivityPub queue handler failed: ${lastError}\n`);
      await client.putCurrent(key,{body:encode({...value,status:"pending",attempts:value.attempts+1,availableAt:Date.now()+Math.min(60000,1000*2**value.attempts),failedAt:new Date().toISOString(),lastError}),mediaType:"application/json"});
    }
  }
  return Object.freeze({
    nativeRetrial:true,
    async enqueue(message,options={}){const milliseconds=options.delay===undefined?0:Number(options.delay.total({unit:"milliseconds"}));const id=randomUUID();await client.putCurrent(`${root}${id}.json`,{body:encode({id,message,status:"pending",attempts:0,availableAt:Date.now()+milliseconds}),mediaType:"application/json"});},
    async listen(handler,options={}){
      if(listener!==undefined)throw new Error("ActivityPub queue already has a listener");
      listener=(async()=>{while(!options.signal?.aborted){const ready=(await rows()).filter(({value})=>value.status==="pending"&&value.availableAt<=Date.now()).sort((left,right)=>priority(left)-priority(right)||left.value.availableAt-right.value.availableAt);for(let offset=0;offset<ready.length;offset+=4)await Promise.all(ready.slice(offset,offset+4).map((row)=>settle(handler,row)));await delay(1000);}})();
      return listener;
    },
    async getDepth(){const pending=(await rows()).map(({value})=>value).filter((value)=>value.status==="pending");return{queued:pending.length,ready:pending.filter((value)=>value.availableAt<=Date.now()).length,delayed:pending.filter((value)=>value.availableAt>Date.now()).length};}
  });
}
export function createActivityPubR2Custody({actor,client=createR2RestClient(r2RestConfiguration())}){if(typeof actor!=="string"||!actor)throw new TypeError("ActivityPub R2 custody actor is required");const prefix=`activitypub/v1/${digest(actor)}`;return Object.freeze({kv:kv(client,prefix),inbox:inbox(client,prefix),queue:queue(client,prefix)});}

// activitypub-services-section's canonical createActivityPubR2Custody deliberately exports no
// queue (R2 has no atomic dequeue; see its src/r2-custody.mjs doc comment), so serve-activitypub.mjs
// composes canonical kv+inbox custody with this gemini-notebook-specific queue -- the same polling
// implementation createActivityPubR2Custody above has always used, exposed standalone.
export function createGeminiNotebookActivityPubR2Queue({actor,client=createR2RestClient(r2RestConfiguration())}){if(typeof actor!=="string"||!actor)throw new TypeError("ActivityPub R2 custody actor is required");return queue(client,`activitypub/v1/${digest(actor)}`);}
