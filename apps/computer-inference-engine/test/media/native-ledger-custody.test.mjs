import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, mkdtempSync,readdirSync,lstatSync,readFileSync,readlinkSync,writeFileSync,mkdirSync,symlinkSync,rmSync} from 'node:fs';
import {join,relative} from 'node:path';
import {tmpdir} from 'node:os';
import {openLedgerJournal,ledgerJournalRoot} from '../../src/media/ledger-journal.mjs';
import {openAccountArtifactCapacityStore} from '../../src/media/account-artifact-capacity.mjs';
import {allowanceLedgerPools} from '../../src/media/allowance-ledger.mjs';
const openers=[file=>openLedgerJournal(file,'native-custody-test'),file=>openAccountArtifactCapacityStore(file),file=>allowanceLedgerPools({storePath:file})];
function scratch(body){const root=mkdtempSync(join(tmpdir(),'native-ledger-custody-'));try{return body(root);}finally{rmSync(root,{recursive:true,force:true});}}
function snapshot(root){const rows=[];function walk(dir){for(const name of readdirSync(dir).sort()){const file=join(dir,name),s=lstatSync(file),key=relative(root,file);if(s.isSymbolicLink())rows.push([key,'link',readlinkSync(file)]);else if(s.isDirectory()){rows.push([key,'dir']);walk(file);}else rows.push([key,'file',readFileSync(file).toString('base64')]);}}walk(root);return rows;}
function unchangedRefusal(root,file){const before=snapshot(root);for(const open of openers){assert.throws(()=>open(file),/explicit offline receiving/);assert.deepEqual(snapshot(root),before,'refusal must not seed, overwrite, delete or reclaim any carrier');}}
for(const kind of ['empty','opaque','header','directory','link','dangling','backup-locator']){
 test(`all native ledger entry points refuse retained ${kind} custody without a reset`,()=>scratch(root=>{
  const file=join(root,kind==='backup-locator'?'saved-original.backup':'ledger.sqlite');
  if(kind==='directory')mkdirSync(file);
  else if(kind==='link'||kind==='dangling'){const target=join(root,'original');if(kind==='link')writeFileSync(target,'original');symlinkSync(target,file);}
  else writeFileSync(file,kind==='header'?'SQLite format 3\0original bytes':kind==='empty'?'':'original retained bytes');
  unchangedRefusal(root,file);assert.equal(existsSync(ledgerJournalRoot(file)),false);
 }));
}
for(const existing of [false,true])for(const suffix of ['-wal','-shm','-journal','.admission']){
 test(`unresolved ${suffix} refuses ${existing?'an existing':'a fresh'} native ledger unchanged`,()=>scratch(root=>{
  const file=join(root,'ledger.sqlite');if(existing){const store=openLedgerJournal(file,'native-custody-test');store.record('held',{frontier:8});}
  writeFileSync(file+suffix,'');unchangedRefusal(root,file);
 }));
}
test('native ledger reopen retains exact current records without any original SQL locator',()=>scratch(root=>{
 const file=join(root,'ledger.sqlite'),store=openLedgerJournal(file,'native-custody-test');store.record('held',{frontier:8});store.record('held',{frontier:9});
 // A read may materialize the journal's derived verification checkpoint.
 assert.deepEqual(store.read('held'),[{frontier:8},{frontier:9}]);
 const before=snapshot(root);assert.deepEqual(openLedgerJournal(file,'native-custody-test').read('held'),[{frontier:8},{frontier:9}]);assert.deepEqual(snapshot(root),before);
}));
test('a historical admission receipt does not authorize ignoring an original source',()=>scratch(root=>{
 const file=join(root,'ledger.sqlite'),store=openLedgerJournal(file,'native-custody-test');store.record('held',{frontier:9});
 writeFileSync(join(ledgerJournalRoot(file),'sql-admission.json'),JSON.stringify({type:'LedgerSqlAdmission',version:1,from:file,counts:{held:1}}));
 writeFileSync(file,'SQLite format 3\0original');unchangedRefusal(root,file);
}));
