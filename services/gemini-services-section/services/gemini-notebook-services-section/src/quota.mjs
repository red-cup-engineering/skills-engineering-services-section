// Provider-native usage is authoritative; historical per-video caps cannot price compute.
import {homedir} from 'node:os';
import {join,dirname} from 'node:path';
import {readFileSync,writeFileSync,renameSync,mkdirSync,existsSync} from 'node:fs';
import {openHeadless} from '@red-cup-engineering/assisted-browser-services-section/window';
import {notebookStoragePath} from './gemini-notebook-client.mjs';

export async function readNotebookUsage({env=process.env,force=false}={}) {
 const path=join(env.XDG_STATE_HOME??join(homedir(),'.local/state'),'561-group','gemini-notebook-usage.json');
 if(!force&&existsSync(path)) {const cached=JSON.parse(readFileSync(path,'utf8'));if(Date.now()-Date.parse(cached.observedAt)<120_000)return cached;}
 const session=await openHeadless({storageState:env.GEMINI_NOTEBOOK_STORAGE_STATE??notebookStoragePath({env}),userAgent:'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36'});
 try {
  const page=session.page;page.setDefaultTimeout(45_000);
  await page.goto('https://notebook.google.com/',{waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:/Settings/i}).first().click();
  await page.getByText('Usage',{exact:true}).first().click();
  const dialog=page.getByRole('dialog').filter({hasText:'Weekly limit'}).first();await dialog.waitFor({state:'visible'});
  // Percent labels initially render as zero before the usage request resolves.
  let text='';
  for(let attempt=0;attempt<60;attempt++) {
   text=await dialog.innerText();
   if(/Weekly limit\s+\d+% used\s+Resets/u.test(text))break;
   await page.waitForTimeout(250);
  }
  if(!/Weekly limit\s+\d+% used\s+Resets/u.test(text))throw new Error('Notebook usage request did not finish loading');
  const current=text.match(/Current Gemini Notebook AI usage\s+(\d+)% used/u),weekly=text.match(/Weekly limit\s+(\d+)% used/u);
  if(!current||!weekly) throw new Error('Gemini Notebook did not expose both native usage percentages');
  const usage={observedAt:new Date().toISOString(),source:'https://notebook.google.com/',currentUsedPercent:Number(current[1]),weeklyUsedPercent:Number(weekly[1]),resets:text.split('\n').filter(line=>line.startsWith('Resets'))};
  if([usage.currentUsedPercent,usage.weeklyUsedPercent].some(value=>value<0||value>100))throw new Error('Invalid native Notebook usage');
  mkdirSync(dirname(path),{recursive:true,mode:0o700});const temporary=path+'.'+process.pid+'.tmp';writeFileSync(temporary,JSON.stringify(usage),{mode:0o600});renameSync(temporary,path);
  return usage;
 }finally{await session.close();}
}
export async function admitNotebookQuota(options={}) {
 // A status cache cannot admit a series of submissions against the same reading.
 try {const usage=await readNotebookUsage({...options,force:true});return usage.currentUsedPercent<100&&usage.weeklyUsedPercent<100?{admitted:true,usage}:{admitted:false,usage,message:`Gemini Notebook reports ${usage.currentUsedPercent}% window and ${usage.weeklyUsedPercent}% weekly usage; ${usage.resets.join('; ')}`};}
 catch(error){return {admitted:false,message:`Notebook usage reading unavailable: ${error.message}`};}
}
