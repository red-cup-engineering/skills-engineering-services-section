#!/usr/bin/env node
// Faster, resumable companion to the serial admission runner.  It only appends
// distinct manifest titles to the exact owned notebook, in bounded batches.
import { runGeminiNotebook } from "./gemini-notebook-cli.mjs";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const TARGET="1a19fe72-e4d4-48ee-98f9-dad841ff272b", CEILING=300;
const COMPILED=join(ROOT,"data/advisory-corpus/union-self-conception-corpus-compilation.json");
const STATE=join(ROOT,"data/advisory-corpus/union-self-conception-corpus-admission-state.json");
if(!process.argv.includes("--execute"))throw new Error("rerun with --execute");
const batch=Math.min(10,Math.max(1,Number(process.argv[process.argv.indexOf("--batch")+1]||8)));
function run(args){return runGeminiNotebook(args,{root:ROOT,timeout:0,maxBuffer:64*1024*1024}).catch(error=>{throw new Error(String(error.stderr||error.stdout||error.message).slice(0,1000))});}
async function sources(){const x=await run(["source","list","--notebook",TARGET]);if(!Array.isArray(x.sources))throw new Error("bad inventory");return x.sources;}
function write(x){const t=`${STATE}.${process.pid}.tmp`;writeFileSync(t,JSON.stringify(x,null,2)+"\n",{mode:0o600});renameSync(t,STATE)}
const compilation=JSON.parse(readFileSync(COMPILED,"utf8")), desired=compilation.receipt.projected;
let state=existsSync(STATE)?JSON.parse(readFileSync(STATE,"utf8")):{targetNotebookId:TARGET,compilation:compilation.receipt.sourceSetDigest,admitted:[]};
if(state.targetNotebookId!==TARGET||state.compilation!==compilation.receipt.sourceSetDigest)throw new Error("state mismatch");
for(;;){let live=await sources();if(live.length>CEILING)throw new Error("capacity exceeded");const canon=x=>x.replace(/^\d{3} /,"");const have=new Set(live.map(x=>canon(x.title)));const todo=desired.filter(x=>!have.has(canon(x.title)));if(!todo.length||live.length===CEILING)break;const group=todo.slice(0,Math.min(batch,CEILING-live.length));await Promise.all(group.map(async row=>{const added=await run(["source","add",row.path,"--type","file","--mime-type","text/plain","--title",row.title.slice(0,180),"--notebook",TARGET],360000);const id=added.source?.id??added.id;if(typeof id!=="string")throw new Error(`no id: ${row.title}`);await run(["source","wait",id,"--notebook",TARGET,"--timeout","600"]);return {title:row.title,sourceId:id,digest:row.digest}}));live=await sources();const byTitle=new Map(live.map(x=>[canon(x.title),x]));state.admitted=desired.filter(x=>byTitle.has(canon(x.title))).map(x=>({title:x.title,sourceId:byTitle.get(canon(x.title)).id,digest:x.digest}));state.updatedAt=new Date().toISOString();write(state);process.stdout.write(JSON.stringify({admitted:state.admitted.length,remaining:desired.length-state.admitted.length,totalSources:live.length})+"\n");}
const final=await sources();if(final.length!==CEILING||final.some(x=>x.status!=="ready"))throw new Error(`unsettled final inventory: ${final.length}`);write({...state,completedAt:new Date().toISOString(),finalSourceCount:final.length,finalReadyCount:final.length});console.log(JSON.stringify({ok:true,sourceCount:final.length}));
