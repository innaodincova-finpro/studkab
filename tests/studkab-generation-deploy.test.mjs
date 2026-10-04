import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const workflow=readFileSync(new URL('../.github/workflows/deploy-studkab-generation.yml',import.meta.url),'utf8');

test('KIT-07b: studkab generation deployment is main-only, pinned, keeps JWT check and cannot change the database',()=>{
 assert.match(workflow,/github\.ref == 'refs\/heads\/main'/);
 assert.match(workflow,/supabase\/setup-cli@[0-9a-f]{40}/);
 assert.match(workflow,/version: 2\.117\.0/);
 assert.match(workflow,/functions deploy studkab-generation --project-ref dcpthwmuiodrjepifzsd --use-api\n/);
 assert.doesNotMatch(workflow,/no-verify-jwt/);
 assert.match(workflow,/SUPABASE_ACCESS_TOKEN: \$\{\{ secrets\.SUPABASE_ACCESS_TOKEN \}\}/);
 assert.doesNotMatch(workflow,/db (push|reset)|migration|execute_sql|CLOUDFLARE|DEEPSEEK/);
});
