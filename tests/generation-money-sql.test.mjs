import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
// C-051, замечания 7 и 8: сценарии на изолированной копии базы в памяти.
const run=(...args)=>execFileSync(process.execPath,['tests/manual/c051-money.mjs',...args],{encoding:'utf8'});
test('C-051: без миграции дефекты учёта расходов воспроизводятся',()=>{
 assert.match(run('--before'),/Дефект воспроизведён/);
});
test('C-051: неподтверждённый запрос удерживается, обрыв по длине не повторяется',()=>{
 assert.match(run(),/все сценарии пройдены/);
});
