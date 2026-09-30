import test from 'node:test';
import assert from 'node:assert/strict';
import {inventoryNumberedCalculations as inventory} from '../supabase/functions/studkab-generation-api/calculation-inventory.mjs';
const hash='a'.repeat(64);
const source=text=>({materials:[{id:'method-1',category:'methodology',fileHash:hash,text}]});
test('all 50 explicit equations remain visible, without granting completeness or a pass',()=>{
 const result=inventory(source(Array.from({length:50},(_,i)=>`Показатель = A / B, (${i+1})\nгде A — исходное значение.\n`).join('\n')));
 assert.equal(result.entries.length,50);
 assert.deepEqual(result.entries.map(r=>r.formulaNumber),Array.from({length:50},(_,i)=>String(i+1)));
 assert.equal(result.complete,false);
 assert.ok(result.entries.every(r=>r.status==='not_checked'&&r.sourceHash===hash));
 assert.ok(result.gaps.includes('unnumbered_and_repeated_calculations_unverified'));
});
test('references do not invent equations and duplicate equation IDs retain both locations',()=>{
 assert.equal(inventory(source('См. формулу (1) внутри предложения.\n1. Список источников.')).entries.length,0);
 const result=inventory(source('X = A + B (2.1)\n\n\nY = C - D (2.1)'));
 assert.equal(result.entries.length,2);assert.notEqual(result.entries[0].id,result.entries[1].id);
 assert.ok(result.gaps.includes('duplicate_formula_number'));
});
test('unreadable, unbound and excessively large inventory never claims complete coverage',()=>{
 assert.deepEqual(inventory(null).gaps,['materials_missing']);
 const packet=source('X = A + B (1)');delete packet.materials[0].fileHash;
 assert.ok(inventory(packet).gaps.includes('source_context_invalid'));
 const long=inventory(source(Array.from({length:257},(_,i)=>`X = A + B (${i+1})`).join('\n')));
 assert.equal(long.entries.length,256);assert.ok(long.gaps.includes('inventory_limit'));
 const mixed=source('X = A + B (1)');mixed.materials[0].category='sources';
 assert.equal(inventory(mixed).entries.length,0);
});
