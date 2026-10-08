import test from 'node:test';
import assert from 'node:assert/strict';
import {DOMParser} from '@xmldom/xmldom';
import {deflateRawSync} from 'node:zlib';
import {calendarDate,calendarTime,parseCalendarText,parseCalendarSheets,previewCalendarImport,applyCalendarImport,readCalendarXlsx} from '../calendar-import.mjs';
const classes={name:'Занятия',rows:[['№','Дата','Начало','Конец','Дисциплина','Вид занятия','Преподаватель'],[1,'2026-10-08','14:20','15:40','Тестовый предмет','Практическое занятие','Тестов А.А.'],[2,'2026-10-08','16:10','17:30','Тестовый предмет','Лабораторная работа','Тестов А.А.']]};
const plan={name:'План по дням',rows:[['Дата','Время','Дисциплина','Действие','Что сделать','Код работы','Статус'],['2026-10-10','09:00–10:00','Тестовый предмет','Сдача','Отправить решение','Р01','Запланировано'],['2026-10-11','10:00–11:00','Тестовый предмет','Тест','Промежуточный тест 1','—','Запланировано']]};
const tests={name:'Тесты',rows:[['№','Дисциплина','Название','Дата в плане','Резерв времени'],[1,'Тестовый предмет','Промежуточный тест 1','2026-10-11','10:00–11:00']]};
const works={name:'Работы',rows:[['Код','Дисциплина','Комплект / задание','Подготовка','Сдача','Опорная дата','План сдачи','Факт сдачи'],['Р01','Тестовый предмет','Решение','Подготовлена','Не сдана','2026-10-08','2026-10-10','']]};
let sequence=0;const uid=()=>`synthetic-${++sequence}`;
const load=()=>parseCalendarSheets(structuredClone([classes,plan,tests,works]));
const manual={id:'manual',kind:'other',title:'Личное',date:'2026-10-10',time:'09:00',note:'не изменять'};
test('all layers produce four events, not extra copies from tests or work sheets',()=>{
 const p=load();assert.equal(p.events.length,4);assert.equal(p.issues.length,0);assert.deepEqual(p.summary,{classes:2,actions:2,tests:1});
 assert.equal(p.workMetadata.length,1);assert.equal(p.workMetadata[0].submission,'Не сдана');assert.equal(p.workMetadata[0].actualDate,'');
 assert.equal(p.events.find(e=>e.recordType==='Сдача').time,'09:00');assert.equal(p.events[0].endTime,'15:40');
});
test('repeated import skips everything; unrelated/personal data and ids remain unchanged',()=>{
 const p=load(),initial=[structuredClone(manual)],snapshot=JSON.stringify(initial);
 const first=applyCalendarImport(initial,previewCalendarImport(initial,p,'source'),uid);assert.equal(first.added,4);assert.equal(JSON.stringify(initial),snapshot);
 const before=JSON.stringify(first.events),again=applyCalendarImport(first.events,previewCalendarImport(first.events,p,'source'),uid);
 assert.equal(again.added,0);assert.equal(again.updated,0);assert.equal(again.skipped,4);assert.equal(JSON.stringify(again.events),before);assert.deepEqual(again.events[0],manual);
});
test('partial input never deletes earlier imported entries or manual records',()=>{
 const initial=applyCalendarImport([manual],previewCalendarImport([manual],load(),'source'),uid).events;
 const p=parseCalendarSheets([{name:'Занятия',rows:classes.rows.slice(0,2)}]);
 const result=applyCalendarImport(initial,previewCalendarImport(initial,p,'source'),uid);assert.equal(result.events.length,5);assert.deepEqual(result.events,initial);
});
test('a changed date is a proposal, requires explicit acceptance and preserves id',()=>{
 const p=load(),before=applyCalendarImport([],previewCalendarImport([],p,'source'),uid).events;
 const next=structuredClone(classes);next.rows[1][1]='2026-10-09';const changed=parseCalendarSheets([next]),preview=previewCalendarImport(before,changed,'source');
 assert.equal(preview.changes.length,1);assert.equal(preview.add.length,0);
 assert.deepEqual(applyCalendarImport(before,preview,uid).events,before);
 const oldId=preview.changes[0].oldId,result=applyCalendarImport(before,preview,uid,{acceptChanges:[oldId]});assert.equal(result.updated,1);assert.equal(result.events.find(e=>e.id===oldId).date,'2026-10-09');
});
test('exact manual match is skipped and never overwritten with import details',()=>{
 const p=load(),entry={...p.events[0],id:'manual-match',note:'личное уточнение'},preview=previewCalendarImport([entry],p,'source');
 assert.equal(preview.skip.length,1);assert.equal(preview.changes.length,0);const result=applyCalendarImport([entry],preview,uid);assert.deepEqual(result.events[0],entry);
});
test('late calendar mutation rejects whole application and leaves input unchanged',()=>{
 const p=load(),before=[manual],preview=previewCalendarImport(before,p,'source'),later=[...before,{...manual,id:'another'}],snapshot=JSON.stringify(later);
 assert.throws(()=>applyCalendarImport(later,preview,uid),/изменился после проверки/);assert.equal(JSON.stringify(later),snapshot);
});
test('renamed source with a shifted date is exposed rather than silently adding a duplicate',()=>{
 const p=load(),before=applyCalendarImport([],previewCalendarImport([],p,'old-source'),uid).events;
 const next=structuredClone(classes);next.rows[1][1]='2026-10-09';const preview=previewCalendarImport(before,parseCalendarSheets([next]),'renamed-source');
 assert.equal(preview.add.length,0);assert.equal(preview.skip.length,1);assert.equal(preview.issues.length,1);
});
test('invalid dates, times, missing year and formula events are exposed, not guessed',()=>{
 assert.equal(calendarDate('31.02.2026'),'');assert.equal(calendarDate('08.10'),'');assert.equal(calendarTime('24:00'),'');assert.equal(calendarTime(0.5),'12:00');assert.equal(calendarTime(1),'');
 const s=structuredClone(classes);s.rows[1][1]='2026-02-31';s.formulaRows=[3];const p=parseCalendarSheets([s]);assert.equal(p.events.length,0);assert.equal(p.issues.length,2);
});
test('cached formula work deadline is metadata corroborated by plan, not extra event or submission',()=>{
 const w=structuredClone(works);w.formulaRows=[2];const p=parseCalendarSheets([classes,plan,w]);assert.equal(p.events.length,4);assert.equal(p.warnings.length,1);assert.equal(p.workMetadata[0].submission,'Не сдана');assert.equal(p.events.find(e=>e.recordType==='Сдача').workMetadata.formulaReference,true);
 const mismatch=structuredClone(w);mismatch.rows[1][6]='2026-10-12';assert(parseCalendarSheets([classes,plan,mismatch]).issues.some(e=>/не совпадает/.test(e.message)));
});
test('unknown sheets, inconsistent test dates and missing work times remain visible',()=>{
 const unknown={name:'Другие занятия',rows:[['неизвестный формат']]};assert.equal(parseCalendarSheets([classes,unknown]).issues.length,1);
 const t=structuredClone(tests);t.rows[1][3]='2026-10-12';assert(parseCalendarSheets([plan,t]).issues.some(e=>/не совпадает/.test(e.message)));
 assert(parseCalendarSheets([works]).issues.some(e=>/нет времени/.test(e.message)));
});
test('inline university text recognizes distinct classes, teacher and session; broken rows visible',()=>{
 const text='Тестовый предмет (часть 1/1) Тестов А.А.\nРасписание:\nПрактическое занятие по дисциплине Тестовый предмет 08.10.2026 14:20 — 15:40\nЛабораторная работа по дисциплине Тестовый предмет 08.10.2026 16:10 — 17:30\nПериод сессии: 24.12.2026 — 26.01.2027\nЛекция по дисциплине Тестовый предмет 31.02.2026 14:20 — 15:40';
 const p=parseCalendarText(text);assert.equal(p.events.length,2);assert.equal(p.issues.length,1);assert.match(p.events[0].note,/Тестов/);assert.deepEqual(p.session,{from:'2026-12-24',to:'2027-01-26'});
 assert.equal(parseCalendarText(text+'\nПрактическое занятие по дисциплине Тестовый предмет 08.10.2026 14:20 — 15:40').duplicates,1);
});
test('pasted spreadsheet text preserves timed actions and tests without guessing dates',()=>{
 const text=plan.rows.map(row=>row.join('\t')).join('\n'),p=parseCalendarText(text);
 assert.equal(p.events.length,2);assert.equal(p.summary.tests,1);assert.equal(p.issues.length,0);assert.equal(p.events[0].time,'09:00');assert.equal(p.events[0].planOnly,true);
});
// Actual ZIP containers, generated entirely from synthetic XML, without user files.
function zip(files,{compressed=false}={}){
 const crc=data=>{let c=-1;for(const b of data){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^-1)>>>0;};
 const local=[],central=[];let offset=0;
 for(const [name,xml] of Object.entries(files)){const n=Buffer.from(name),data=Buffer.from(xml),packed=compressed?deflateRawSync(data):data,header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(compressed?8:0,8);header.writeUInt32LE(crc(data),14);header.writeUInt32LE(packed.length,18);header.writeUInt32LE(data.length,22);header.writeUInt16LE(n.length,26);
  local.push(header,n,packed);const entry=Buffer.alloc(46);entry.writeUInt32LE(0x02014b50);entry.writeUInt16LE(compressed?8:0,10);entry.writeUInt32LE(crc(data),16);entry.writeUInt32LE(packed.length,20);entry.writeUInt32LE(data.length,24);entry.writeUInt16LE(n.length,28);entry.writeUInt32LE(offset,42);central.push(entry,n);offset+=header.length+n.length+packed.length;
 }const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(Object.keys(files).length,8);end.writeUInt16LE(Object.keys(files).length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);return new Uint8Array(Buffer.concat([...local,directory,end]));
}
const xmlFiles={
 '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
 'xl/workbook.xml':'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Занятия" sheetId="1" r:id="r1"/></sheets></workbook>',
 'xl/_rels/workbook.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>',
 'xl/worksheets/sheet1.xml':'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>№</t></is></c><c r="B1" t="inlineStr"><is><t>Дата</t></is></c><c r="C1" t="inlineStr"><is><t>Начало</t></is></c><c r="D1" t="inlineStr"><is><t>Конец</t></is></c><c r="E1" t="inlineStr"><is><t>Дисциплина</t></is></c><c r="F1" t="inlineStr"><is><t>Вид занятия</t></is></c></row><row r="2"><c r="A2"><v>1</v></c><c r="B2"><v>46303</v></c><c r="C2"><v>0.5</v></c><c r="D2" t="inlineStr"><is><t>13:20</t></is></c><c r="E2" t="inlineStr"><is><t>Предмет проверки</t></is></c><c r="F2" t="inlineStr"><is><t>Лекция</t></is></c></row></sheetData></worksheet>'};
test('stored/compressed XLSX, numeric dates/times and default workbook content type are read locally',async()=>{
 for(const compressed of [false,true]){const sheets=await readCalendarXlsx(zip(xmlFiles,{compressed}),{DOMParser}),p=parseCalendarSheets(sheets);assert.equal(p.events.length,1);assert.equal(p.issues.length,0);assert.equal(p.events[0].time,'12:00');assert.equal(p.events[0].date,calendarDate(46303));}
});
test('corruption, XML entities, external relationship, macros and size bombs fail closed',async()=>{
 await assert.rejects(readCalendarXlsx(new Uint8Array(22),{DOMParser}));
 const corrupt=zip(xmlFiles);corrupt[50]^=1;await assert.rejects(readCalendarXlsx(corrupt,{DOMParser}));
 await assert.rejects(readCalendarXlsx(zip({...xmlFiles,'xl/workbook.xml':'<!DOCTYPE workbook [<!ENTITY x "bad">]>'+xmlFiles['xl/workbook.xml']}),{DOMParser}));
 await assert.rejects(readCalendarXlsx(zip({...xmlFiles,'xl/_rels/workbook.xml.rels':xmlFiles['xl/_rels/workbook.xml.rels'].replace('Target="','TargetMode="External" Target="')}),{DOMParser}));
 await assert.rejects(readCalendarXlsx(zip({...xmlFiles,'xl/vbaProject.bin':'macro'}),{DOMParser}));
 const bomb=zip(xmlFiles);for(let i=0;i<bomb.length-46;i++){const v=new DataView(bomb.buffer,bomb.byteOffset);if(v.getUint32(i,true)===0x02014b50){v.setUint32(i+24,9000000,true);break;}}await assert.rejects(readCalendarXlsx(bomb,{DOMParser}));
});
