import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {advanceNotebookVideo,NotebookVideoBlocked} from '../src/report-video.mjs';

test('received video custody survives source cleanup refusal and resumes without its generation service',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'received-video-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const reportPath=join(dir,'report.md'),outputPath=join(dir,'video.mp4');
 await writeFile(reportPath,'An unchanged source-grounded report.');
 const bytes=Buffer.from('0000ftypisomverified-video-bytes');
 let checkpoint={artifactId:'accepted-video',notebookId:'owned-notebook',sourceId:'owned-source',sourceOwned:true},events=[];
 const request={reportPath,outputPath,title:'Lesson',sourceTitle:'Unique source',notebookId:'owned-notebook',checkpoint,onCheckpoint:async value=>{checkpoint=value;},onRecord:async value=>events.push(value)};
 const received=await advanceNotebookVideo({...request,notebook:{getVideo:async()=>({status:'completed'}),downloadVideo:async()=>{await writeFile(outputPath,bytes);return {bytes:bytes.length};},removeSources:async()=>{throw new Error('Generation session expired after download');}}});
 assert(!(received instanceof NotebookVideoBlocked));assert.equal(received.downloadedArtifactId,'accepted-video');assert(events.some(event=>event.outcome==='cleanup-deferred'));
 const offline=new Proxy({},{get:()=>()=>assert.fail('A verified received artifact must not contact Notebook')});
 const resumed=await advanceNotebookVideo({...request,checkpoint:received,notebook:offline});
 assert.equal(resumed.downloadSha256,received.downloadSha256);
 await writeFile(outputPath,Buffer.from('0000ftypisomcorrupted-video-bytes'));
 const corrupt=await advanceNotebookVideo({...request,checkpoint:received,notebook:offline});assert.equal(corrupt.status,'video-download-corrupt');
 await writeFile(reportPath,'Changed source report');
 assert.equal((await advanceNotebookVideo({...request,checkpoint:received,notebook:offline})).status,'report-changed');
});
