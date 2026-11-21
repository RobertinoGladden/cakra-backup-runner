import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {DriveStore} from '../src/drive.mjs';

test('private app-owned folder, scoped token, upload readback and synthetic cleanup',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'cakra-drive-test-'));
 try{
  const path=join(dir,'synthetic.enc'),bytes=Buffer.alloc(100_000,0x5a),sha256=createHash('sha256').update(bytes).digest('hex');
  writeFileSync(path,bytes);
  const folderId='syntheticFolder123',fileId='syntheticFile12345',name='synthetic.enc',runId='synthetic-run';
  let stored=null;
  const mock=async(url,options={})=>{
   const target=String(url);
   if(target==='https://oauth2.googleapis.com/token')return Response.json({access_token:'synthetic-access',token_type:'Bearer',scope:'https://www.googleapis.com/auth/drive.file'});
   assert.equal(options.headers.authorization,'Bearer synthetic-access');
   if(target.includes(`${folderId}?fields=`))return Response.json({id:folderId,name:'Synthetic private folder',mimeType:'application/vnd.google-apps.folder',shared:false,ownedByMe:true,owners:[{emailAddress:'owner@example.invalid'}],appProperties:{cakraBackupFolder:'synthetic-marker'}});
   if(target.startsWith('https://www.googleapis.com/drive/v3/files?q='))return Response.json({files:stored?[{id:fileId,name,size:String(stored.length),appProperties:{cakraBackupRun:runId}}]:[]});
   if(target.includes(`${fileId}?fields=`))return Response.json({id:fileId,parents:[folderId],shared:false,owners:[{emailAddress:'owner@example.invalid'}]});
   if(target.includes('uploadType=resumable&fields='))return new Response(null,{status:200,headers:{location:'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=synthetic'}});
   if(target.includes('upload_id=synthetic')){const chunks=[];for await(const chunk of options.body)chunks.push(Buffer.from(chunk));stored=Buffer.concat(chunks);return Response.json({id:fileId,size:String(stored.length),sha256Checksum:createHash('sha256').update(stored).digest('hex')},{status:201});}
   if(target.endsWith(`${fileId}?alt=media`))return new Response(stored,{status:200});
   if(target.endsWith(`/${fileId}`)&&options.method==='DELETE'){stored=null;return new Response(null,{status:204});}
   throw new Error('Unexpected Drive mock endpoint');
  };
  const config={clientId:'synthetic-client',clientSecret:'synthetic-secret',refreshToken:'synthetic-refresh',folderId,folderName:'Synthetic private folder',folderMarker:'synthetic-marker',ownerEmail:'owner@example.invalid',fetchImpl:mock};
  const drive=new DriveStore(config);
  await drive.verifyDestination();
  await assert.rejects(()=>new DriveStore({...config,folderMarker:'wrong'}).verifyDestination(),/identity or privacy mismatch/);
  const uploaded=await drive.uploadVerified({path,name,runId,sha256});
  assert.equal(uploaded.reused,false);
  assert.deepEqual(await drive.download(uploaded.id),bytes);
  assert.equal((await drive.uploadVerified({path,name,runId,sha256})).reused,true);
  await drive.deleteSynthetic({name,runId});
  assert.equal((await drive.listName(name)).length,0);
  const overscoped=new DriveStore({...config,fetchImpl:async()=>Response.json({access_token:'a',token_type:'Bearer',scope:'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive'})});
  await assert.rejects(()=>overscoped.token(),/scope mismatch/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
