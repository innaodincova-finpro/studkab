import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
// C-054 (аудит, замечание 13): личные адреса почты не хранятся в текущих файлах открытого репозитория.
// Исключения: применённые миграции базы (их текст зафиксирован отпечатком и не меняется).
const immutable=f=>/^supabase\/migrations\/\d{14}_.*\.sql$/.test(f);
test('C-054: в текущих файлах нет личной почты',()=>{
 const files=execFileSync('git',['ls-files'],{encoding:'utf8'}).split('\n').filter(f=>f&&!immutable(f)&&!/\.(png|jpg|ico|woff2?)$/.test(f));
 const found=[];
 for(const f of files){
  let text;try{text=readFileSync(f,'utf8');}catch{continue;}
  for(const m of text.matchAll(/[A-Za-z0-9._%+-]+@(mail|gmail|yandex|ya|bk|inbox|list|rambler|outlook|hotmail|icloud)\.[a-z]{2,}/gi))found.push(f+': '+m[0].replace(/^(.).*@/,'$1…@'));
 }
 assert.deepEqual(found,[]);
});
test('C-054: адрес уведомлений — адрес сайта, а не почта',()=>{
 const push=readFileSync('supabase/functions/studkab-push/index.ts','utf8');
 assert.match(push,/subject:'https:\/\/innaodincova-finpro\.github\.io\/studkab\/'/);
});
