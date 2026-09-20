import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css=fs.readFileSync(new URL('../desktop.css',import.meta.url),'utf8');
const ui=fs.readFileSync(new URL('../reestr.html',import.meta.url),'utf8');
const cabinet=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');

test('executor detail has six accessible panels and a separate primary action',()=>{
 assert.match(css,/request-workspace\{grid-template-columns:minmax\(0,1fr\) 280px/);
 assert.match(css,/request-panel\[hidden\]/);
 assert.match(ui,/role="tablist"/);
 assert.match(ui,/role="tabpanel"/);
 assert.match(ui,/aria-controls="request-panel-/);
 assert.match(ui,/request-action/);
 assert.match(ui,/desktop\.css\?v=7/);
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
 assert.match(ui,/<label for="note">/);
});

test('registry instructions describe cloud intake and reviewed Word delivery',()=>{
 assert.match(ui,/Заявка сохраняется в облаке и попадает в реестр/);
 assert.match(fs.readFileSync(new URL('../request-workflow.js',import.meta.url),'utf8'),/Провести итоговую проверку/);
 assert.doesNotMatch(ui,/Сообщение приходит в WhatsApp или Telegram/);
 assert.doesNotMatch(ui,/Передать черновик студенту/);
});

test('student request accepts bounded private materials before generation',()=>{
 assert.match(cabinet,/data-request-file="assignment"/);
 assert.match(cabinet,/data-request-file="methodology"/);
 assert.match(cabinet,/data-request-file="data"/);
 assert.match(cabinet,/data-request-file="sources"/);
 assert.match(cabinet,/5242880/);
 assert.match(cabinet,/crypto\.subtle\.digest\('SHA-256'/);
 assert.match(cabinet,/attachment-list/);
 assert.match(cabinet,/attachment-upload/);
 assert.match(ui,/attachment-context/);
 assert.match(ui,/attachment-download/);
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
