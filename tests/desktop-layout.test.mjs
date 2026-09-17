import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css=fs.readFileSync(new URL('../desktop.css',import.meta.url),'utf8');
const ui=fs.readFileSync(new URL('../reestr.html',import.meta.url),'utf8');
const cabinet=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');

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

test('primary forms and modal sheets expose accessible names and focus handling',()=>{
 for(const html of [cabinet,ui]){
  assert.match(html,/setAttribute\("role","dialog"\)/);
  assert.match(html,/setAttribute\("aria-modal","true"\)/);
  assert.match(html,/setAttribute\("aria-labelledby",heading\.id\)/);
  assert.match(html,/opener&&opener\.isConnected&&opener\.focus/);
  assert.match(html,/ev\.key!=="Tab"/);
 }
 assert.match(cabinet,/<label for="nTopic">/);
 assert.match(cabinet,/<label for="stWarn">/);
 assert.match(ui,/<label for="requestStatus">/);
 assert.match(ui,/<label for="note">/);
});

test('registry instructions describe cloud intake and reviewed Word delivery',()=>{
 assert.match(ui,/Заявка сохраняется в облаке и попадает в реестр/);
 assert.match(ui,/Проверить и передать Word/);
 assert.doesNotMatch(ui,/Сообщение приходит в WhatsApp или Telegram/);
 assert.doesNotMatch(ui,/Передать черновик студенту/);
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
