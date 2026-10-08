// Read-only, local acceptance helper. Never publishes the input file or its rows.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {DOMParser} from '@xmldom/xmldom';
import {readCalendarXlsx,parseCalendarSheets,previewCalendarImport,applyCalendarImport} from '../calendar-import.mjs';
const path=process.argv[2];
if(!path)throw new Error('Укажите локальный Excel для проверки.');
const sheets=await readCalendarXlsx(new Uint8Array(fs.readFileSync(path)),{DOMParser});
const parsed=parseCalendarSheets(sheets);let seq=0;
const personal={id:'synthetic-personal',kind:'other',title:'Личная запись проверки',date:'2026-01-01',time:'09:00',note:'не изменять'};
const first=applyCalendarImport([personal],previewCalendarImport([personal],parsed,'local-check'),()=>`check-${++seq}`);
const second=applyCalendarImport(first.events,previewCalendarImport(first.events,parsed,'local-check'),()=>`check-${++seq}`);
assert.equal(second.added,0);assert.equal(second.updated,0);assert.deepEqual(second.events[0],personal);
assert.equal(second.events.length,first.events.length);
console.log(JSON.stringify({sheets:sheets.length,events:parsed.events.length,summary:parsed.summary,workMetadata:parsed.workMetadata.length,
 unresolved:parsed.issues.length,warnings:parsed.warnings.length,session:parsed.session,firstAdded:first.added,repeatAdded:second.added,
 repeatSkipped:second.skipped,personalPreserved:true},null,2));
if(parsed.issues.length)process.exitCode=2;
