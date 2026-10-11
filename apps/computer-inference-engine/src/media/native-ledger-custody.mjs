import {lstatSync} from 'node:fs';
/** Existing original ledger evidence is never startup authorization to convert it. */
export function assertNativeLedgerCustody(path){
 for(const candidate of [path,path+'-wal',path+'-shm',path+'-journal',path+'.admission']){
  try{lstatSync(candidate);}catch(error){if(error.code==='ENOENT')continue;throw error;}
  throw new Error('Historical ledger custody requires explicit offline receiving into a distinct native destination');
 }
}
