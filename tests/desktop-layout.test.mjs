import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css=fs.readFileSync(new URL('../desktop.css',import.meta.url),'utf8');
const ui=fs.readFileSync(new URL('../reestr.html',import.meta.url),'utf8');

test('desktop request detail uses a bounded linear workflow',()=>{
 assert.match(css,/\.screen\[data-detail=true\]\{display:block;max-width:1080px/);
 assert.match(css,/body:has\(\.screen\[data-detail=true\]\) \.fab\{display:none\}/);
 assert.match(css,/\.screen\[data-detail=true\] \.btn\{min-height:52px;font-size:16px\}/);
 assert.match(ui,/desktop\.css\?v=2/);
});
