import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
// C-054, замечания 4 и 5: список допущенных студентов на копии базы в памяти.
const run=(...a)=>execFileSync(process.execPath,['tests/manual/c054-members.mjs',...a],{encoding:'utf8'});
test('C-054: без списка облако открыто любому аккаунту',()=>assert.match(run('--before'),/Дефект воспроизведён/));
test('C-054: облако — только допущенным, действующие пользователи сохранили доступ',()=>assert.match(run(),/все сценарии пройдены/));
