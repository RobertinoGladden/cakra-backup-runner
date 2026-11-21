/** Generic backup executor. Production execution needs a protected manual workflow. */
import {createHash,generateKeyPairSync,randomBytes} from 'node:crypto';
import {mkdtempSync,readFileSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,sep} from 'node:path';
import {spawn} from 'node:child_process';
import {Readable} from 'node:stream';
import {DriveStore} from './drive.mjs';
import {decryptBuffer,encryptStream} from './envelope.mjs';
import {requiresFreshnessSignal,signalMonitor} from './heartbeat.mjs';
import {verifySupabaseCertificate} from './certificate.mjs';

const mode=process.argv[2];
const postgresImage='postgres@sha256:b60e90042aa6b8dbecd58e224b3e36114dbf8ad754465264c2476ad58a86e45c';
if(!['synthetic','production'].includes(mode))throw new Error('Choose synthetic or production mode');
const github=process.env.GITHUB_ACTIONS==='true';
const monitorRequired=requiresFreshnessSignal(mode,process.env.GITHUB_EVENT_NAME);
if(!github&&!(mode==='synthetic'&&process.env.BACKUP_LOCAL_SYNTHETIC_ACK==='DISPOSABLE_ONLY'))throw new Error('Owner-local synthetic acknowledgement or GitHub Actions required');
if(mode==='production'){
 if(process.env.BACKUP_PRODUCTION_ENABLE!=='OWNER_APPROVED'||process.env.GITHUB_REPOSITORY!=='RobertinoGladden/cakra-backup-runner'||process.env.GITHUB_REF!=='refs/heads/main'||!['schedule','workflow_dispatch'].includes(process.env.GITHUB_EVENT_NAME))throw new Error('Production backup execution context not approved');
 if(monitorRequired&&!process.env.BACKUP_HEARTBEAT_URL)throw new Error('Independent backup monitor required for scheduled backups');
}
const needed=['DRIVE_CLIENT_ID','DRIVE_CLIENT_SECRET','DRIVE_REFRESH_TOKEN','DRIVE_FOLDER_ID','DRIVE_FOLDER_NAME','DRIVE_FOLDER_MARKER','DRIVE_OWNER_EMAIL'];
for(const key of needed)if(!process.env[key])throw new Error(`Missing runner input: ${key}`);
const drive=new DriveStore({clientId:process.env.DRIVE_CLIENT_ID,clientSecret:process.env.DRIVE_CLIENT_SECRET,refreshToken:process.env.DRIVE_REFRESH_TOKEN,folderId:process.env.DRIVE_FOLDER_ID,folderName:process.env.DRIVE_FOLDER_NAME,folderMarker:process.env.DRIVE_FOLDER_MARKER,ownerEmail:process.env.DRIVE_OWNER_EMAIL});

const tempRoot=realpathSync(tmpdir()),dir=mkdtempSync(join(tempRoot,'cakra-runner-'));
if(!dir.startsWith(tempRoot+sep))throw new Error('Unexpected temporary directory');
const runId=mode==='synthetic'?`synthetic-${Date.now()}-${randomBytes(5).toString('hex')}`:process.env.GITHUB_RUN_ID??'';
if(mode==='production'&&!/^\d{1,24}$/.test(runId))throw new Error('Missing GitHub run identity');
const archiveName=`cakra-${mode}-${runId}.dump.enc`,manifestName=`cakra-${mode}-${runId}.manifest.json`;
const archive=join(dir,archiveName),manifestPath=join(dir,manifestName);
let syntheticPrivateKey=null,syntheticPayload=null;
const started=Date.now();
try{
 if(monitorRequired)await signalMonitor(process.env.BACKUP_HEARTBEAT_URL,'start');
 await drive.verifyDestination();
 let source,publicKey,sourceRef,exit;
 if(mode==='synthetic'){
  syntheticPayload=randomBytes(131_072);
  const disposable=generateKeyPairSync('rsa',{modulusLength:3072,publicKeyEncoding:{format:'pem',type:'spki'},privateKeyEncoding:{format:'pem',type:'pkcs8'}});
  publicKey=disposable.publicKey;syntheticPrivateKey=disposable.privateKey;
  source=Readable.from([syntheticPayload]);sourceRef='disposable-synthetic-data';
 }else{
  const required=['BACKUP_DATABASE_URL','BACKUP_EXPECTED_HOST','BACKUP_EXPECTED_USER','BACKUP_EXPECTED_DB','BACKUP_SOURCE_ID','RECIPIENT_PUBLIC_KEY_PEM','RECIPIENT_PUBLIC_KEY_SHA256'];
  for(const key of required)if(!process.env[key])throw new Error(`Missing production runner input: ${key}`);
  const database=new URL(process.env.BACKUP_DATABASE_URL);
  const user=decodeURIComponent(database.username),name=database.pathname.slice(1);
  if(!['postgres:','postgresql:'].includes(database.protocol)||database.hostname!==process.env.BACKUP_EXPECTED_HOST||user!==process.env.BACKUP_EXPECTED_USER||name!==process.env.BACKUP_EXPECTED_DB||!database.password)throw new Error('Backup database identity mismatch');
  publicKey=process.env.RECIPIENT_PUBLIC_KEY_PEM;
  const fingerprint=createHash('sha256').update(publicKey).digest('hex');
  if(!/^[a-f0-9]{64}$/i.test(process.env.RECIPIENT_PUBLIC_KEY_SHA256)||fingerprint!==process.env.RECIPIENT_PUBLIC_KEY_SHA256.toLowerCase())throw new Error('Recipient public key fingerprint mismatch');
  sourceRef=process.env.BACKUP_SOURCE_ID;
  const caPath=verifySupabaseCertificate();
  const env={...process.env,PGHOST:database.hostname,PGPORT:database.port||'5432',PGUSER:user,PGPASSWORD:decodeURIComponent(database.password),PGDATABASE:name,PGSSLMODE:'verify-full',PGSSLROOTCERT:'/etc/ssl/certs/supabase-prod-ca-2021.crt'};
  const args=['run','--rm','--pull=never','--mount',`type=bind,src=${caPath},dst=${env.PGSSLROOTCERT},readonly`,'-e','PGHOST','-e','PGPORT','-e','PGUSER','-e','PGPASSWORD','-e','PGDATABASE','-e','PGSSLMODE','-e','PGSSLROOTCERT',postgresImage,'pg_dump','--format=custom','--no-owner','--no-large-objects','--schema=public','--schema=auth','--schema=storage','--schema=supabase_migrations'];
  const dump=spawn('docker',args,{env,stdio:['ignore','pipe','pipe']});
  dump.stderr.resume();source=dump.stdout;
  exit=new Promise((resolve,reject)=>{dump.once('error',reject);dump.once('close',resolve);});
 }
 const sealed=await encryptStream(source,publicKey,archive);
 if(exit){const status=await exit;if(status!==0||sealed.plainBytes<1024)throw new Error('Database export failed');}
 const saved=await drive.uploadVerified({path:archive,name:archiveName,runId,sha256:sealed.encryptedSha256});
 const manifest={schema:'cakra-backup-manifest-v2',synthetic:mode==='synthetic',sourceRef,runId,createdAt:new Date().toISOString(),format:sealed.format,algorithm:sealed.algorithm,recipientKeySha256:createHash('sha256').update(publicKey).digest('hex'),plainBytes:sealed.plainBytes,plainSha256:sealed.plainSha256,encryptedBytes:sealed.encryptedBytes,encryptedSha256:sealed.encryptedSha256,driveArchiveId:saved.id,readbackVerified:true,retention:'manual-legal-hold-review'};
 writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n',{mode:0o600,flag:'wx'});
 const manifestHash=createHash('sha256').update(readFileSync(manifestPath)).digest('hex');
 const receipt=await drive.uploadVerified({path:manifestPath,name:manifestName,runId,sha256:manifestHash});
 if(mode==='synthetic'){
  const downloaded=await drive.download(saved.id);
  if(createHash('sha256').update(downloaded).digest('hex')!==sealed.encryptedSha256||!decryptBuffer(downloaded,syntheticPrivateKey).equals(syntheticPayload))throw new Error('Synthetic recovery mismatch');
 }
 if(monitorRequired)await signalMonitor(process.env.BACKUP_HEARTBEAT_URL,'success');
 process.stdout.write(JSON.stringify({result:'PASS',mode,runId,archiveId:saved.id,manifestId:receipt.id,encryptedBytes:sealed.encryptedBytes,readbackVerified:true,syntheticRecovery:mode==='synthetic',elapsedSeconds:Math.round((Date.now()-started)/1000)})+'\n');
}catch{
 if(monitorRequired)try{await signalMonitor(process.env.BACKUP_HEARTBEAT_URL,'fail');}catch{}
 process.stderr.write(`CAKRA ${mode} backup FAILED; inspect restricted runner telemetry.\n`);
 process.exitCode=1;
}finally{
 if(mode==='synthetic'){
  try{await drive.deleteSynthetic({name:manifestName,runId});await drive.deleteSynthetic({name:archiveName,runId});}
  catch{process.stderr.write('Synthetic Drive cleanup could not be verified.\n');process.exitCode=1;}
 }
 rmSync(dir,{recursive:true,force:true});
}
