import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {certificatePath,verifySupabaseCertificate} from '../src/certificate.mjs';

test('the pinned Supabase root is valid and an altered root is rejected',()=>{
 assert.equal(verifySupabaseCertificate(),certificatePath);
 const dir=mkdtempSync(join(tmpdir(),'cakra-ca-test-'));
 try{
  const pem=readFileSync(certificatePath,'utf8');
  const changed=pem.replace('MIID','MIIC');
  const path=join(dir,'altered.crt');
  writeFileSync(path,changed);
  assert.throws(()=>verifySupabaseCertificate(path));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
