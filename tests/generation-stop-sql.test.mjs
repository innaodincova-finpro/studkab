import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
// C-051, замечание 2: сценарии выполняются на изолированной копии базы в памяти.
const run=(...args)=>execFileSync(process.execPath,['tests/manual/c051-stop.mjs',...args],{encoding:'utf8'});
test('C-051: без миграции дефект остановки воспроизводится',()=>{
 assert.match(run('--before'),/Дефект воспроизведён/);
});
test('C-051: с миграцией остановка и проверка паспорта работают',()=>{
 assert.match(run(),/все сценарии пройдены/);
});
