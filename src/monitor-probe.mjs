import {signalMonitor} from './heartbeat.mjs';

if(process.env.GITHUB_ACTIONS!=='true'||process.env.GITHUB_REPOSITORY!=='RobertinoGladden/cakra-backup-runner'||process.env.GITHUB_REF!=='refs/heads/main'||process.env.GITHUB_EVENT_NAME!=='workflow_dispatch')throw new Error('Monitor probe requires protected manual runner context');
if(!process.env.BACKUP_HEARTBEAT_URL)throw new Error('Missing monitor secret');
await signalMonitor(process.env.BACKUP_HEARTBEAT_URL,'success');
console.log(JSON.stringify({result:'PASS',monitorSignal:'accepted',databaseAccess:false}));
