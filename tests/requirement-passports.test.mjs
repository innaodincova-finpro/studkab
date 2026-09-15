import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const sql=fs.readFileSync(new URL('../supabase/migrations/20260914105509_studkab_requirement_passports.sql',import.meta.url),'utf8');
const gate=fs.readFileSync(new URL('../supabase/migrations/20260915070508_mandatory_passport_generation_limits.sql',import.meta.url),'utf8');
const ui=fs.readFileSync(new URL('../reestr.html',import.meta.url),'utf8');
const {defaultPassport}=await import('../supabase/functions/studkab-requests/requirements.mjs');

test('passport schema is private and callable only through the authenticated server adapter',()=>{
 assert.match(sql,/enable row level security/i);
 assert.match(sql,/revoke all on public\.studkab_requirement_passports from public, anon, authenticated/i);
 assert.doesNotMatch(sql,/grant\s+(?:select|insert|update|delete|all)[^;]+to\s+(?:anon|authenticated)/i);
 assert.match(sql,/security invoker/i);
 assert.match(sql,/revoke all on function[\s\S]+from public,anon,authenticated/i);
 assert.match(sql,/grant execute on function[\s\S]+to service_role/i);
});

test('generation gate binds approved passport, work limits and temporary total ceiling',()=>{
 assert.match(gate,/source_fingerprint=coalesce\(p_input->>'material_fingerprint',''\)/i);
 assert.match(gate,/\('control',100000\),\('coursework',250000\),\('thesis',600000\)/i);
 assert.match(gate,/temporary_total_microusd\) values\(true,500000\)/i);
 assert.match(gate,/cost>j\.max_cost_microusd-used/i);
 assert.match(gate,/least\(b\.limit_microusd,policy\.temporary_total_microusd\)/i);
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

test('default passport stores formatting as readable Russian text instead of internal JSON',()=>{
 const passport=defaultPassport({fm:{fn:'Times New Roman',sz:14,ml:30,mr:15,mt:20,mb:20,sp:1.5,ind:1.25}});
 const formatting=passport.items.find(item=>item.id==='FORMATTING').text;
 assert.match(formatting,/Times New Roman, 14 пт/);
 assert.match(formatting,/слева 30 мм/);
 assert.match(formatting,/межстрочный интервал 1,5/);
 assert.doesNotMatch(formatting,/\{"fn"/);
});

test('passport UI blocks approval and paid preparation while required facts are unresolved',()=>{
 assert.match(ui,/Паспорт не утверждён — платная подготовка запрещена/);
 assert.match(ui,/data-act="passport-approve"[\s\S]+disabled title="Сначала заполните обязательные требования"/);
 assert.match(ui,/return requireApprovedPassport\(x\)\.then/);
});
