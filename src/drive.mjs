import {createHash} from 'node:crypto';
import {createReadStream,statSync} from 'node:fs';

const FILES='https://www.googleapis.com/drive/v3/files';
const UPLOAD='https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,size,sha256Checksum,parents,appProperties';
const TOKEN='https://oauth2.googleapis.com/token';
const SCOPE='https://www.googleapis.com/auth/drive.file';
const validId=value=>{if(!/^[A-Za-z0-9_-]{10,128}$/.test(value??''))throw new Error('Invalid Drive ID');return value;};

export class DriveStore{
 constructor({clientId,clientSecret,refreshToken,folderId,folderName,folderMarker,ownerEmail,fetchImpl=fetch}){
  if(!clientId||!clientSecret||!refreshToken||!folderName||!folderMarker||!ownerEmail)throw new Error('Incomplete dedicated Drive configuration');
  this.clientId=clientId;this.clientSecret=clientSecret;this.refreshToken=refreshToken;
  this.folderId=validId(folderId);this.folderName=folderName;this.folderMarker=folderMarker;this.ownerEmail=ownerEmail.toLowerCase();
  this.fetch=fetchImpl;this.accessToken=null;
 }
 async token(){
  if(this.accessToken)return this.accessToken;
  const response=await this.fetch(TOKEN,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:this.clientId,client_secret:this.clientSecret,refresh_token:this.refreshToken,grant_type:'refresh_token'})});
  if(!response.ok)throw new Error(`Drive OAuth refresh failed: HTTP ${response.status}`);
  const data=await response.json(),scopes=String(data.scope??'').split(/\s+/).filter(Boolean);
  if(typeof data.access_token!=='string'||data.token_type?.toLowerCase()!=='bearer'||scopes.length!==1||scopes[0]!==SCOPE)throw new Error('Drive OAuth token scope mismatch');
  this.accessToken=data.access_token;return this.accessToken;
 }
 async request(url,options={}){
  const response=await this.fetch(url,{...options,redirect:'manual',headers:{authorization:`Bearer ${await this.token()}`,...options.headers}});
  if(response.status===401){this.accessToken=null;throw new Error('Drive OAuth token expired or revoked');}
  return response;
 }
 async verifyDestination(){
  const fields='id,name,mimeType,shared,ownedByMe,owners(emailAddress),appProperties';
  const response=await this.request(`${FILES}/${this.folderId}?fields=${encodeURIComponent(fields)}`);
  if(!response.ok)throw new Error(`Drive destination inspection failed: HTTP ${response.status}`);
  const folder=await response.json();
  const owner=folder.owners?.some(item=>item.emailAddress?.toLowerCase()===this.ownerEmail)===true;
  if(folder.id!==this.folderId||folder.name!==this.folderName||folder.mimeType!=='application/vnd.google-apps.folder'||folder.shared!==false||folder.ownedByMe!==true||!owner||folder.appProperties?.cakraBackupFolder!==this.folderMarker)throw new Error('Drive destination identity or privacy mismatch');
 }
 async listName(name){
  if(!/^[A-Za-z0-9_.-]{1,180}$/.test(name))throw new Error('Invalid archive name');
  const q=`name = '${name}' and '${this.folderId}' in parents and trashed = false`;
  const response=await this.request(`${FILES}?q=${encodeURIComponent(q)}&fields=${encodeURIComponent('files(id,name,size,parents,appProperties),nextPageToken')}&pageSize=100`);
  if(!response.ok)throw new Error(`Drive list failed: HTTP ${response.status}`);
  const result=await response.json();
  if(result.nextPageToken)throw new Error('Ambiguous Drive filename');
  return result.files??[];
 }
 async verifyStoredFile(id){
  const response=await this.request(`${FILES}/${validId(id)}?fields=${encodeURIComponent('id,parents,shared,owners(emailAddress)')}`);
  if(!response.ok)throw new Error(`Drive stored-file inspection failed: HTTP ${response.status}`);
  const file=await response.json(),owner=file.owners?.some(item=>item.emailAddress?.toLowerCase()===this.ownerEmail)===true;
  if(file.id!==id||file.shared!==false||!file.parents?.includes(this.folderId)||!owner)throw new Error('Drive stored-file privacy mismatch');
 }
 async hashRemote(id){
  const response=await this.request(`${FILES}/${validId(id)}?alt=media`);
  if(!response.ok||!response.body)throw new Error(`Drive readback failed: HTTP ${response.status}`);
  const hash=createHash('sha256');let bytes=0;
  for await(const chunk of response.body){hash.update(chunk);bytes+=chunk.length;}
  return {bytes,sha256:hash.digest('hex')};
 }
 async download(id){
  const response=await this.request(`${FILES}/${validId(id)}?alt=media`);
  if(!response.ok)throw new Error(`Drive download failed: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
 }
 async uploadVerified({path,name,runId,sha256}){
  const size=statSync(path).size,existing=await this.listName(name);
  if(existing.length>1)throw new Error('Duplicate archive filename');
  if(existing.length===1){
   const file=existing[0];
   if(file.appProperties?.cakraBackupRun!==runId||Number(file.size)!==size)throw new Error('Archive filename collision');
   const readback=await this.hashRemote(file.id);
   if(readback.bytes!==size||readback.sha256!==sha256)throw new Error('Existing archive checksum mismatch');
   await this.verifyStoredFile(file.id);return {id:file.id,size,reused:true};
  }
  const metadata={name,mimeType:'application/octet-stream',parents:[this.folderId],appProperties:{cakraBackupRun:runId}};
  const start=await this.request(UPLOAD,{method:'POST',headers:{'content-type':'application/json; charset=UTF-8','x-upload-content-type':'application/octet-stream','x-upload-content-length':String(size)},body:JSON.stringify(metadata)});
  if(!start.ok)throw new Error(`Drive upload initiation failed: HTTP ${start.status}`);
  const session=start.headers.get('location');
  if(!session?.startsWith('https://www.googleapis.com/upload/drive/v3/files?'))throw new Error('Invalid Drive upload session');
  let offset=0,remote=null;
  for(let attempt=0;attempt<5&&!remote;attempt++){
   try{
    const response=await this.request(session,{method:'PUT',headers:{'content-type':'application/octet-stream','content-length':String(size-offset),'content-range':`bytes ${offset}-${size-1}/${size}`},body:createReadStream(path,{start:offset}),duplex:'half'});
    if(response.status===200||response.status===201){remote=await response.json();break;}
    if(response.status!==308&&response.status<500)throw new Error(`Drive upload failed: HTTP ${response.status}`);
   }catch(error){if(attempt===4)throw error;}
   await new Promise(resolve=>setTimeout(resolve,Math.min(1000*2**attempt,8000)));
   const probe=await this.request(session,{method:'PUT',headers:{'content-length':'0','content-range':`bytes */${size}`}});
   if(probe.status===200||probe.status===201){remote=await probe.json();break;}
   if(probe.status!==308)throw new Error(`Drive upload probe failed: HTTP ${probe.status}`);
   const range=probe.headers.get('range');offset=range?Number(range.match(/bytes=0-(\d+)/)?.[1]??-1)+1:0;
   if(!Number.isSafeInteger(offset)||offset<0||offset>=size)throw new Error('Invalid Drive upload offset');
  }
  if(!remote?.id||Number(remote.size)!==size)throw new Error('Drive upload size mismatch');
  if(remote.sha256Checksum&&remote.sha256Checksum.toLowerCase()!==sha256.toLowerCase())throw new Error('Drive checksum mismatch');
  const readback=await this.hashRemote(remote.id);
  if(readback.bytes!==size||readback.sha256!==sha256)throw new Error('Drive readback checksum mismatch');
  await this.verifyStoredFile(remote.id);
  return {id:remote.id,size,reused:false};
 }
 async deleteSynthetic({name,runId}){
  for(const file of await this.listName(name)){
   if(file.appProperties?.cakraBackupRun!==runId)throw new Error('Refusing to delete a foreign Drive file');
   const response=await this.request(`${FILES}/${validId(file.id)}`,{method:'DELETE'});
   if(response.status!==204)throw new Error(`Synthetic cleanup failed: HTTP ${response.status}`);
  }
  if((await this.listName(name)).length!==0)throw new Error('Synthetic Drive file remains after cleanup');
 }
}
