import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';

test('production command rejects an unexpected repository before contacting external services',()=>{
 const result=spawnSync(process.execPath,['src/run.mjs','production'],{encoding:'utf8',env:{PATH:process.env.PATH,GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'untrusted/fork',GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'schedule',BACKUP_PRODUCTION_ENABLE:'OWNER_APPROVED'}});
 assert.notEqual(result.status,0);
 assert.match(result.stderr,/execution context not approved/);
});

test('synthetic command requires an explicit local acknowledgement',()=>{
 const result=spawnSync(process.execPath,['src/run.mjs','synthetic'],{encoding:'utf8',env:{PATH:process.env.PATH}});
 assert.notEqual(result.status,0);
 assert.match(result.stderr,/acknowledgement or GitHub Actions required/);
});
