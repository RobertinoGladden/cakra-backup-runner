import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,randomBytes} from 'node:crypto';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {test} from 'node:test';
import {decryptBuffer,encryptStream} from '../src/envelope.mjs';

test('synthetic encrypted archive round trip and tamper rejection',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'cakra-runner-test-'));
 try{
  const key=generateKeyPairSync('rsa',{modulusLength:3072,publicKeyEncoding:{format:'pem',type:'spki'},privateKeyEncoding:{format:'pem',type:'pkcs8'}});
  const payload=randomBytes(157_111),file=join(dir,'synthetic.enc');
  const result=await encryptStream(Readable.from([payload]),key.publicKey,file);
  const encrypted=readFileSync(file);
  assert.equal(result.algorithm,'RSA-OAEP-SHA256+A256GCM');
  assert.equal(result.plainSha256,createHash('sha256').update(payload).digest('hex'));
  assert.equal(result.encryptedSha256,createHash('sha256').update(encrypted).digest('hex'));
  assert.deepEqual(decryptBuffer(encrypted,key.privateKey),payload);
  const corrupt=Buffer.from(encrypted);corrupt[corrupt.length-20]^=1;
  assert.throws(()=>decryptBuffer(corrupt,key.privateKey));
  await assert.rejects(()=>encryptStream(Readable.from([payload]),key.publicKey,file),/already exists/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
