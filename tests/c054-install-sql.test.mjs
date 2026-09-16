import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
// C-054: файл установки выполняется на изолированной копии базы в памяти.
const run=(...a)=>execFileSync(process.execPath,['tests/manual/c054-install-sql.mjs',...a],{encoding:'utf8'});
test('C-054: файл установки регистрирует оба изменения и защищён от повторного запуска',()=>assert.match(run(),/все сценарии пройдены/));
