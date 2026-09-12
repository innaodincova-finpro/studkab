// Local visual fixture. No provider/API calls and no student data.
const fs=require('node:fs'),vm=require('node:vm');
const q=require('../../draft-quality.js'),ctx={window:{},Blob,TextEncoder};
vm.runInNewContext(fs.readFileSync('result-docx.js','utf8'),ctx);
const info={job:{id:'22222222-2222-4222-8222-222222222222',version:'319275c075532bfceeda031057e9cacd214b2bed'},parts:[{ordinal:0,section:'ch2',state:'done',text:'### 2.1 Проверка отображения\nТехнический образец проверяет оформление сохранённых частей. Он не является результатом финансового исследования.\n\nТаблица 1 — Учебные показатели\n| Показатель | 2023 | 2024 | 2025 |\n| --- | --- | --- | --- |\n| Активы | 10000 | 11400 | 12800 |\n| Оборотные активы | 4000 | 4800 | 5600 |\nИсточник: синтетический контрольный комплект. Единицы: тыс. руб.'},{ordinal:1,section:'ch2',state:'unknown',text:null}]};
const draft=q.cloudDraft(info);fs.mkdirSync('test-results',{recursive:true});
ctx.window.ResultDocx(draft,draft.chapters).arrayBuffer().then(b=>fs.writeFileSync('test-results/cloud-word-render.docx',Buffer.from(b)));
