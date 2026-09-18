import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
// C-051, замечания 7 и 8: сценарии на изолированной копии базы в памяти.
const run=(...args)=>execFileSync(process.execPath,['tests/manual/c051-money.mjs',...args],{encoding:'utf8'});
test('C-051: без миграции дефекты учёта расходов воспроизводятся',()=>{
 assert.match(run('--before'),/Дефект воспроизведён/);
});
test('C-051: неподтверждённый запрос удерживается, обрыв по длине не повторяется',()=>{
 assert.match(run(),/все сценарии пройдены/);
});
test('C-061: dispatch reserves only same-section context and credits reconciled releases',()=>{
 const sql=readFileSync(new URL('../supabase/migrations/20260918092405_expose_bounded_job_release_total.sql',import.meta.url),'utf8');
 assert.match(sql,/x\.spec->>'section_id'=p\.spec->>'section_id'/);
 assert.match(sql,/used=used-released/);
 assert.match(sql,/unnest\(r\.request_ids\) as q\(request_id\)/);
 assert.match(sql,/a\.request_id=q\.request_id/);
 assert.match(sql,/create schema if not exists studkab_private/);
 assert.match(sql,/grant execute on function studkab_private\.gen_job_released\(uuid\) to service_role/);
 assert.doesNotMatch(sql,/grant select on public\.studkab_gen_reconciliations/);
});
