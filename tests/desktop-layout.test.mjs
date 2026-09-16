import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css=fs.readFileSync(new URL('../desktop.css',import.meta.url),'utf8');
const ui=fs.readFileSync(new URL('../reestr.html',import.meta.url),'utf8');

test('desktop request detail uses a bounded grouped workflow',()=>{
 assert.match(css,/\.screen\[data-detail=true\]\{display:block;max-width:900px/);
 assert.match(css,/body:has\(\.screen\[data-detail=true\]\) \.fab\{display:none\}/);
 assert.match(css,/\.screen\[data-detail=true\] \.btn\{min-height:46px;font-size:15px\}/);
 assert.match(ui,/function group\(key,title,inner,open\)/);
 assert.match(ui,/Требования и материалы/);
 assert.match(ui,/Выполнение и проверка/);
 assert.match(ui,/Готовый результат/);
 assert.match(ui,/details\.fold-group\[open\]/);
 assert.match(ui,/desktop\.css\?v=5/);
});

test('university registry uses compact semantic disclosure',()=>{
 assert.match(css,/\.screen\[data-view=refs\]\{max-width:1100px\}/);
 assert.match(css,/\.ref-tools\{display:flex/);
 assert.match(ui,/class="fold ref-group/);
 assert.match(ui,/data-ref-group=/);
 assert.match(ui,/Поиск по вузу, факультету, кафедре/);
 assert.match(ui,/Требует уточнения/);
 assert.match(ui,/details\.ref-group\[open\]/);
 assert.match(ui,/entries\.length\+' '\+plural\(entries\.length,'направление','направления','направлений'\)/);
});
