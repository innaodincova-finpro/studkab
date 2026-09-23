const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'reestr.html'), 'utf8');

test('document builder exposes one whole-document preparation process', () => {
  assert.equal((html.match(/data-prepare(?:'|\s|>)/g) || []).length, 1);
  assert.doesNotMatch(html, /data-genall|data-genover|data-cloud-start|data-cloud-check/);
  assert.doesNotMatch(html, /Подготовить весь черновик|Подготовка в облаке/);
  assert.match(html, /окно можно закрыть и продолжить позже/);
});

test('unified preparation has one final Word output', () => {
  assert.doesNotMatch(html, /Скачать неполный Word|Неполный-черновик/);
  assert.match(html, /data-docx="1"[^>]*>Скачать Word</);
});

test('a lost job is searched before a new paid start', () => {
  const history = html.indexOf("action:'history'");
  const estimate = html.indexOf("action:'estimate'", history);
  const start = html.indexOf("action:'start'", estimate);
  assert.ok(history > -1 && estimate > history && start > estimate);
  assert.match(html,/Проверьте суммы и нажмите кнопку ещё раз/);
  assert.match(html, /Paid Start|Автоматический повтор заблокирован/);
});

test('AI eligibility blocks explicit prohibition and an attached reviewed Word',()=>{
  const code=html.slice(html.indexOf('function approvedStructure(x){'),html.indexOf('function buildPrompt(x){'));
  const ctx={DraftQuality:{inputs:x=>x.doc&&x.doc.inputs||{}}};vm.createContext(ctx);vm.runInContext(html.slice(html.indexOf('var MATERIAL_PAYLOAD_FIELDS='),html.indexOf('function passportContent(')),ctx);vm.runInContext(code,ctx);
  const x={requirements:'Техническая проверка. AI не запускать.',externalResult:{id:'word'},attachments:[{id:'a'}],passports:[{status:'approved',items:[{id:'STRUCTURE',verified:true,text:'Структура: Один раздел'}]}]};
  const blockers=Array.from(ctx.preparationBlockers(x));
  assert.ok(blockers.some(x=>x.includes('прикреплён Word')));
  assert.ok(blockers.some(x=>x.includes('запрещено использовать ИИ')));
});

test('AI eligibility requires a verified approved structure and materials',()=>{
  const code=html.slice(html.indexOf('function approvedStructure(x){'),html.indexOf('function buildPrompt(x){'));
  const ctx={DraftQuality:{inputs:x=>x.doc&&x.doc.inputs||{}}};vm.createContext(ctx);vm.runInContext(html.slice(html.indexOf('var MATERIAL_PAYLOAD_FIELDS='),html.indexOf('function passportContent(')),ctx);vm.runInContext(code,ctx);
  const base={passports:[{status:'approved',items:[]}],attachments:[]};
  assert.ok(Array.from(ctx.preparationBlockers(base)).some(x=>x.includes('нет проверенной структуры')));
  assert.ok(Array.from(ctx.preparationBlockers(base)).some(x=>x.includes('Добавьте материалы')));
  const ready={passports:[{status:'approved',material_manifest:{basis:'Задание',requirements:[{id:'M1',label:'Задание',required:true,attachment_ids:['a'],answer_ids:[],payload_fields:[],not_applicable_reason:''}]},items:[{id:'STRUCTURE',verified:true,text:'Структура: Введение\nГлава 1\nЗаключение'}]}],attachments:[{id:'a'}]};
  assert.deepEqual(Array.from(ctx.preparationBlockers(ready)),[]);
  assert.equal(ctx.approvedStructure(ready),'Введение\nГлава 1\nЗаключение');
});

test('C098 legacy approval and unavailable evidence cannot enable preparation',()=>{
  const ctx={DraftQuality:{inputs:()=>({})}};vm.createContext(ctx);
  vm.runInContext(html.slice(html.indexOf('var MATERIAL_PAYLOAD_FIELDS='),html.indexOf('function passportContent(')),ctx);
  vm.runInContext(html.slice(html.indexOf('function approvedStructure(x){'),html.indexOf('function buildPrompt(x){')),ctx);
  const x={requirements:'Условие задания',attachments:[{id:'current'}],clarifications:[{id:'answered',answer:'Полученный ответ'}],passports:[{status:'approved',items:[{id:'STRUCTURE',verified:true,text:'Структура: Введение\nАнализ\nЗаключение'}]}]};
  assert.ok(Array.from(ctx.preparationBlockers(x)).some(s=>s.includes('состав обязательных материалов')));
  const p=x.passports[0];p.material_manifest={basis:'Задание',requirements:[{id:'M1',label:'Материал',required:true,attachment_ids:['superseded'],answer_ids:['answered'],payload_fields:['rq'],not_applicable_reason:''}]};
  assert.ok(Array.from(ctx.preparationBlockers(x)).some(s=>s.includes('отсутствует или устарело')));
  p.material_manifest.requirements[0].attachment_ids=['current'];
  assert.deepEqual(Array.from(ctx.preparationBlockers(x)),[]);
  p.material_manifest.requirements[0].required=false;p.material_manifest.requirements[0].attachment_ids=[];p.material_manifest.requirements[0].answer_ids=[];p.material_manifest.requirements[0].payload_fields=[];
  assert.ok(Array.from(ctx.preparationBlockers(x)).some(s=>s.includes('объясните, почему')));
  p.material_manifest.requirements[0].not_applicable_reason='Этот материал не предусмотрен заданием';
  assert.deepEqual(Array.from(ctx.preparationBlockers(x)),[]);
});
