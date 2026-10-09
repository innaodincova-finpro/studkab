import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {DOMParser} from '@xmldom/xmldom';import {getDocumentProxy,getResolvedPDFJS} from 'unpdf';
import {PGlite} from '@electric-sql/pglite';
import {readOfficeMath} from '../supabase/functions/studkab-requests/office-math.mjs';
import {readDocument,READER_VERSION} from '../supabase/functions/studkab-requests/structured-reader.mjs';
import {loadOriginal} from '../supabase/functions/studkab-requests/intake-reading.mjs';
import {handler} from '../supabase/functions/studkab-requests/handler.mjs';
import {schema,student,other,apiDatabase} from './intake-fixture.mjs';
const data=JSON.parse(fs.readFileSync(new URL('fixtures/intake-reading.json',import.meta.url))),bytes=name=>new Uint8Array(Buffer.from(data[name],'base64'));
const DOCX='application/vnd.openxmlformats-officedocument.wordprocessingml.document',XLSX='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const deps={DOMParser,loadPDF:async bytes=>({document:await getDocumentProxy(bytes,{isEvalSupported:false}),OPS:(await getResolvedPDFJS()).OPS})};
const read=(name,type)=>readDocument(bytes(name),type,deps);
test('real DOCX containers retain eight tables, ordered cell sources, years, units and decimal strings',async()=>{
 const r=await read('management.docx',DOCX);assert.equal(r.status,'ready');assert.equal(r.summary.tables,8);
 const cells=r.blocks.filter(b=>b.kind==='table_cell');assert.equal(cells.length,48);
 assert.equal(cells.find(b=>b.source.table===8&&b.source.row===2&&b.source.column===2).text,'1250.50');
 assert.match(r.extracted_text,/2023–2025/);assert.match(r.extracted_text,/thousand RUB/);assert.equal(r.readerVersion,READER_VERSION);
});
test('XLSX preserves formulas and cached results separately, raw numeric precision, hidden data, merges and styles',async()=>{
 const r=await read('finance.xlsx',XLSX);assert.equal(r.status,'ready');assert.equal(r.summary.sheets,2);
 const cell=(sheet,ref)=>r.blocks.find(b=>b.source.sheet===sheet&&b.source.cell===ref);
 assert.equal(cell('Finance','A1').value,'thousand RUB');assert.equal(cell('Finance','A2').formula.text,'SUM(B1:B2)');assert.equal(cell('Finance','A2').cachedValue,'2025.25');
 assert.equal(cell('Finance','A2').hiddenRow,true);assert.equal(cell('Finance','C1').hiddenColumn,true);
 assert.equal(cell('Hidden','A1').rawValue,'9999999999999999');assert.equal(cell('Hidden','A1').hiddenSheet,true);
 assert.equal(cell('Finance','E2').numberFormat.code,'yyyy-mm-dd');assert.equal(r.sheets[0].date1904,true);assert.deepEqual(r.sheets[0].mergedRanges,['A3:C3']);
 for(const code of ['formula_cache_unverified','formula_result_missing','external_formula','cell_error','shared_formula_reference'])assert.ok(r.warnings.some(w=>w.code===code),code);
});
test('actual PDF parser distinguishes textual, mixed and scanned pages; partial content is never accepted as complete',async()=>{
 const text=await read('text.pdf','application/pdf');assert.equal(text.status,'ready');assert.equal(text.pages[0].state,'text');assert.match(text.extracted_text,/2023/);assert.ok(text.blocks[0].transform.length);assert.equal(text.pages[1].state,'blank');
 const damaged=await readDocument(new TextEncoder().encode('%PDF-broken'),'application/pdf',deps);assert.equal(damaged.status,'blocked');assert.equal(damaged.warnings[0].code,'damaged_pdf');
 for(const name of ['mixed.pdf','scan.pdf']){const r=await read(name,'application/pdf');assert.equal(r.status,'blocked');assert.ok(r.pages.some(p=>p.state==='needs_text_version'));assert.ok(r.warnings.some(w=>w.code==='pdf_image_page'));}
});
test('damaged archives, entity expansion, corrupt ZIP CRC and resource bounds fail closed',async()=>{
 for(const [name,type,code] of [['damaged.docx',DOCX,'damaged_archive'],['damaged.xlsx',XLSX,'damaged_archive'],['unsafe.docx',DOCX,'unsafe_xml']]){const r=await read(name,type);assert.equal(r.status,'blocked');assert.equal(r.warnings[0].code,code);}
 const bomb=bytes('management.docx');const bv=new DataView(bomb.buffer);for(let i=0;i<bomb.length-46;i++)if(bv.getUint32(i,true)===0x02014b50){bv.setUint32(i+24,8388609,true);break;}assert.equal((await readDocument(bomb,DOCX,deps)).warnings[0].code,'archive_limit');
 const corrupt=bytes('management.docx');corrupt[40]^=1;assert.equal((await readDocument(corrupt,DOCX,deps)).status,'blocked');
 let calls=0;const limited=await readDocument(bytes('management.docx'),DOCX,{...deps,clock:()=>++calls===1?0:20000});assert.equal(limited.warnings[0].code,'time_limit');
});
async function fixture(){const db=new PGlite();await db.exec(schema());await db.exec('set role service_role');let who=student,reads=0,fail=false;
 const sql=apiDatabase(db),file=bytes('management.docx'),hash=Buffer.from(await crypto.subtle.digest('SHA-256',file)).toString('hex');
 const d=await sql('rpc/studkab_intake_open','POST',{p_student:student});const reserved=await sql('rpc/studkab_intake_reserve','POST',{p_student:student,p_draft:d.id,p_name:'Management.docx',p_type:DOCX,p_size:file.length,p_hash:hash,p_supersedes:null});
 await sql('rpc/studkab_intake_finish','POST',{p_student:student,p_draft:d.id,p_file:reserved.file.id,p_hash:hash});
 const options={db:sql,isMember:async()=>true,auth:async()=>({id:who,email_confirmed_at:'2026-01-01'}),loadIntake:async()=>{reads++;if(fail)throw Error('network');return file;},readIntake:(b,t)=>readDocument(b,t,deps)};
 const call=async(body)=>{const response=await handler(options)(new Request('https://example.test',{method:'POST',headers:{authorization:'Bearer synthetic'},body:JSON.stringify(body)}));return {status:response.status,...await response.json()};};
 return {db,sql,options,call,body:{action:'intake-read',id:d.id,fileId:reserved.file.id},get reads(){return reads;},setUser(id){who=id;},setFailure(value){fail=value;}};
}
test('owned original is read once, persisted and restored after lost finish response; foreign accounts never load bytes',async()=>{
 const f=await fixture();try{
  f.setUser(other);assert.equal((await f.call(f.body)).status,404);assert.equal(f.reads,0);f.setUser(student);
  const original=f.options.db;let lost=true;f.options.db=async(p,...args)=>{const r=await original(p,...args);if(lost&&p.endsWith('read_finish')){lost=false;throw Error('lost reply');}return r;};
  assert.equal((await f.call(f.body)).status,503);const repeated=await f.call(f.body);assert.equal(repeated.cached,true);assert.equal(repeated.reading.fileId,f.body.fileId);assert.equal(repeated.reading.summary.tables,8);assert.equal(f.reads,1);
  const reopened=await f.call({action:'intake-open'});assert.equal(reopened.files[0].read_status,'ready');assert.equal(reopened.files[0].read_result,undefined);assert.equal(reopened.files[0].storage_path,undefined);
 }finally{await f.db.close();}
});
test('unfinished lease survives restart and expires safely; failed reads retry saved original without re-upload',async()=>{
 const f=await fixture();try{
  const args={p_student:student,p_draft:f.body.id,p_file:f.body.fileId,p_version:READER_VERSION},one=await f.sql('rpc/studkab_intake_read_begin','POST',args);
  assert.equal((await f.call(f.body)).reading.status,'reading');assert.equal(f.reads,0);
  await f.db.query("update studkab_intake_files set read_until=now()-interval '1 second' where id=$1",[f.body.fileId]);
  f.setFailure(true);assert.equal((await f.call(f.body)).reading.status,'failed');f.setFailure(false);assert.equal((await f.call(f.body)).reading.status,'ready');
  const old=await f.sql('rpc/studkab_intake_read_finish','POST',{p_student:student,p_draft:f.body.id,p_file:f.body.fileId,p_lease:one.file.read_lease,p_version:READER_VERSION,p_result:{}});assert.equal(old.conflict,true);
  assert.equal((await f.db.query('select count(*)::int n from studkab_intake_files')).rows[0].n,1);
 }finally{await f.db.close();}
});
test('streamed storage read rejects excess size and hash mismatch before parser receives content',async()=>{
 const file=bytes('management.docx'),hash=Buffer.from(await crypto.subtle.digest('SHA-256',file)).toString('hex'),args={base:'https://example.test',key:'synthetic',path:'owned/file',size:file.length,hash,fetcher:async()=>new Response(file)};
 assert.deepEqual(await loadOriginal(args),file);await assert.rejects(()=>loadOriginal({...args,size:1}),/mismatch/);await assert.rejects(()=>loadOriginal({...args,hash:'0'.repeat(64)}),/mismatch/);
});

test('database rejects mismatched source hashes and browser access to reading RPCs',async()=>{
 const f=await fixture();try{const reserved=await f.sql('rpc/studkab_intake_read_begin','POST',{p_student:student,p_draft:f.body.id,p_file:f.body.fileId,p_version:READER_VERSION});
 const bad=await f.sql('rpc/studkab_intake_read_finish','POST',{p_student:student,p_draft:f.body.id,p_file:f.body.fileId,p_lease:reserved.file.read_lease,p_version:READER_VERSION,p_result:{readerVersion:READER_VERSION,status:'ready',fileId:f.body.fileId,fileHash:'0'.repeat(64),blocks:[],warnings:[],extracted_text:'fake'}});assert.equal(bad.invalid,true);
 await f.db.exec('reset role;set role authenticated');await assert.rejects(()=>f.db.query('select studkab_intake_read_begin($1,$2,$3,$4)',[student,f.body.id,f.body.fileId,READER_VERSION]),/permission denied/);
 await assert.rejects(()=>f.db.query('select read_result from studkab_intake_files'),/permission denied/);
 }finally{await f.db.close();}
});

// R12: structural equations retain operators and source locations; never flatten m:t.
const mathFixtures=JSON.parse(fs.readFileSync(new URL('fixtures/office-math-reading.json',import.meta.url)));
test('actual DOCX math keeps nested fraction and exponent in paragraph, table and header with original OMML',async()=>{
 const r=await readDocument(new Uint8Array(Buffer.from(mathFixtures['math.docx'],'base64')),DOCX,deps);
 assert.equal(r.status,'ready');assert.doesNotMatch(r.extracted_text,/12x|1x2/);
 assert.match(r.blocks[0].text,/Вычислить \\\(\\frac\{1\}\{\{x\}\^\{2\}\}\\\) при x=2\./);
 const equations=r.blocks.flatMap(b=>b.equations||[]);assert.equal(equations.length,3);
 assert.equal(equations[0].source.paragraph,1);assert.equal(equations[1].source.table,1);assert.equal(equations[1].source.column,1);assert.equal(equations[2].source.part,'word/header1.xml');
 for(const e of equations){assert.equal(e.complete,true);assert.equal(e.text,'\\frac{1}{{x}^{2}}');assert.match(e.omml,/<m:f>/);assert.match(e.omml,/<m:sSup>/);}
});
test('unsupported Word math preserves original structure and stays blocked instead of accepting a partial formula',async()=>{
 const r=await readDocument(new Uint8Array(Buffer.from(mathFixtures['math-unsupported.docx'],'base64')),DOCX,deps);
 assert.equal(r.status,'blocked');assert.equal(r.warnings[0].code,'equation_layout');assert.equal(r.warnings[0].source.equation,1);
 const e=r.blocks[0].equations[0];assert.equal(e.complete,false);assert.match(e.omml,/<m:phant>/);assert.equal(e.text,'');
});

const mathRun=text=>'<m:r><m:t>'+text+'</m:t></m:r>';
const mathNode=body=>new DOMParser().parseFromString('<m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">'+body+'</m:oMath>','application/xml').documentElement;
for(const [name,body,expected] of [
 ['subscript','<m:sSub><m:e>'+mathRun('x')+'</m:e><m:sub>'+mathRun('i')+'</m:sub></m:sSub>','{x}_{i}'],
 ['both scripts','<m:sSubSup><m:e>'+mathRun('x')+'</m:e><m:sub>'+mathRun('i')+'</m:sub><m:sup>'+mathRun('2')+'</m:sup></m:sSubSup>','{x}_{i}^{2}'],
 ['root','<m:rad><m:deg>'+mathRun('3')+'</m:deg><m:e>'+mathRun('x')+'</m:e></m:rad>','\\sqrt[3]{x}'],
 ['lower limit','<m:limLow><m:e>'+mathRun('lim')+'</m:e><m:lim>'+mathRun('x→0')+'</m:lim></m:limLow>','\\underset{x→0}{lim}'],
 ['sum','<m:nary><m:naryPr><m:chr m:val="∑"/></m:naryPr><m:sub>'+mathRun('i=1')+'</m:sub><m:sup>'+mathRun('n')+'</m:sup><m:e>'+mathRun('i')+'</m:e></m:nary>','\\sum_{i=1}^{n}{i}'],
 ['matrix','<m:m><m:mr><m:e>'+mathRun('1')+'</m:e><m:e>'+mathRun('2')+'</m:e></m:mr><m:mr><m:e>'+mathRun('3')+'</m:e><m:e>'+mathRun('4')+'</m:e></m:mr></m:m>','\\begin{matrix}1 & 2 \\\\ 3 & 4\\end{matrix}'],
 ['delimiters','<m:d><m:dPr><m:begChr m:val="["/><m:endChr m:val="]"/><m:sepChr m:val=","/></m:dPr><m:e>'+mathRun('a')+'</m:e><m:e>'+mathRun('b')+'</m:e></m:d>','[a,b]'],
 ['fraction without bar','<m:f><m:fPr><m:type m:val="noBar"/></m:fPr><m:num>'+mathRun('n')+'</m:num><m:den>'+mathRun('k')+'</m:den></m:f>','\\genfrac{}{}{0pt}{}{n}{k}']
])test('OMML '+name+' preserves its mathematical structure',()=>{const r=readOfficeMath(mathNode(body));assert.equal(r.complete,true);assert.equal(r.text,expected);assert.ok(r.omml);});
for(const body of [
 '<m:f><m:num>'+mathRun('1')+'</m:num><m:den>'+mathRun('2')+'</m:den><m:den>'+mathRun('3')+'</m:den></m:f>',
 '<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg>'+mathRun('3')+'</m:deg><m:e>'+mathRun('x')+'</m:e></m:rad>',
 '<m:unknown>'+mathRun('x')+'</m:unknown>',
 '<m:num>'+mathRun('x')+'</m:num>',
 mathRun('\\input'),
 '<m:r><m:t>{x}</m:t></m:r>',
 '<m:r><m:rPr><m:scr m:val="double-struck"/></m:rPr><m:t>R</m:t></m:r>'
])test('ambiguous, hidden or unsupported OMML cannot be accepted as completely read: '+body.slice(0,30),()=>{const r=readOfficeMath(mathNode(body));assert.equal(r.complete,false);assert.equal(r.text,'');assert.ok(r.omml);});
test('math namespace spoofing and resource exhaustion fail closed',()=>{
 const fake=new DOMParser().parseFromString('<m:oMath xmlns:m="urn:not-office-math"><m:r><m:t>x</m:t></m:r></m:oMath>','application/xml').documentElement;
 assert.equal(readOfficeMath(fake).complete,false);
 assert.equal(readOfficeMath(mathNode(mathRun('x').repeat(4001))).complete,false);
});
