#!/usr/bin/env node
// Hosted operator entry for the complete provider; credentials and SDK stay here.
import {homedir} from 'node:os';
import {dirname,join} from 'node:path';
import {readFileSync,existsSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {fileURLToPath} from 'node:url';
const home=homedir(),code=dirname(fileURLToPath(import.meta.url));
const settings=join(home,'.config/561-group/media-production.env');
if(existsSync(settings))for(const [key,value]of Object.entries(parseEnv(readFileSync(settings,'utf8'))))process.env[key]??=value;
process.env.GEMINI_NOTEBOOK_PYTHON??=join(home,'.notebooklm/venv/bin/python');
process.env.PATH=dirname(process.execPath)+':'+home+'/.local/bin:/usr/bin:/bin';
const [command='library',...args]=process.argv.slice(2);
if(command==='usage') {
 const {readNotebookUsage}=await import('@red-cup-engineering/gemini-notebook-services-section/quota');
 console.log(JSON.stringify(await readNotebookUsage({force:true})));
}else if(command==='library') {
 const {openGeminiNotebook}=await import('@red-cup-engineering/gemini-notebook-services-section/gemini-notebook-client');
 const notebooks=await(await openGeminiNotebook()).listNotebooks();
 console.log(JSON.stringify(notebooks.map(({id,title,isOwner,sources})=>({id,title,isOwner,sourceCount:sources.length}))));
}else if(command==='sdk') {
 if(args[0]==='generate') {
  const {admitNotebookQuota}=await import('@red-cup-engineering/gemini-notebook-services-section/quota');
  const admission=await admitNotebookQuota();if(!admission.admitted)throw new Error(admission.message);
 }
 const {runGeminiNotebookSync}=await import('@red-cup-engineering/gemini-notebook-services-section/gemini-notebook-cli');
 const result=runGeminiNotebookSync(args,{json:false,timeout:300_000});
 process.stdout.write(result.stdout);process.stderr.write(result.stderr);process.exitCode=result.status??1;
}else {
 const root=join(code,'..'),manifest=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
 const entry=manifest.bin[command];
 if(!entry)throw new Error('usage: gemini-notebook library|usage|sdk <args>|'+Object.keys(manifest.bin).join('|'));
 const path=join(root,entry);process.argv=[process.argv[0],path,...args];await import(path);
}
