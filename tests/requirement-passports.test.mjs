import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const sql=fs.readFileSync(new URL('../supabase/migrations/20260914105509_studkab_requirement_passports.sql',import.meta.url),'utf8');
const ui=fs.readFileSync(new URL('../reestr.html',import.meta.url),'utf8');

test('passport schema is private and callable only through the authenticated server adapter',()=>{
 assert.match(sql,/enable row level security/i);
 assert.match(sql,/revoke all on public\.studkab_requirement_passports from public, anon, authenticated/i);
 assert.doesNotMatch(sql,/grant\s+(?:select|insert|update|delete|all)[^;]+to\s+(?:anon|authenticated)/i);
 assert.match(sql,/security invoker/i);
 assert.match(sql,/revoke all on function[\s\S]+from public,anon,authenticated/i);
 assert.match(sql,/grant execute on function[\s\S]+to service_role/i);
});

test('passport versions are request-scoped, immutable in number and approve only unchanged items',()=>{
 assert.match(sql,/unique\(request_id, revision\)/i);
 assert.match(sql,/where id=p_passport and request_id=p_request for update/i);
 assert.match(sql,/selected\.items <> p_expected_items/i);
 assert.match(sql,/set status='stale' where request_id=p_request and status='approved'/i);
});

test('executor UI keeps four evidence categories separate and exposes no automatic AI action',()=>{
 for(const label of ['Требование методички','Измеримая проверка','Предметная рекомендация','Предположение'])assert.match(ui,new RegExp(label));
 assert.match(ui,/Сохранить проект паспорта/);
 assert.match(ui,/Утвердить/);
 assert.doesNotMatch(ui,/data-act="passport-auto-approve"/);
});
