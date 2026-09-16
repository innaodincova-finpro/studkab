import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
// C-054, замечание 3: сценарии на изолированной копии базы в памяти.
const run=(...a)=>execFileSync(process.execPath,['tests/manual/c054-cloud-guard.mjs',...a],{encoding:'utf8'});
test('C-054: без изменения базы запись в обход приложения возможна',()=>assert.match(run('--before'),/Дефект воспроизведён/));
test('C-054: запись кабинета и реестра — только через приложение, до 10 МБ',()=>assert.match(run(),/все сценарии пройдены/));
