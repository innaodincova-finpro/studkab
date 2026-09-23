import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {scanInternalBorrowing, BORROWING_LIMITS} from '../supabase/functions/_shared/internal-borrowing.mjs';
const fileHash='a'.repeat(64);
const phrase='один два три четыре пять шесть семь восемь девять десять';
const sha=x=>createHash('sha256').update(x).digest('hex');
const scan=(text,sources=[],extra={})=>scanInternalBorrowing({text,fileHash,sources,minMatchTokens:8,...extra});

test('Cyrillic punctuation/case matching preserves exact text hash and UTF16 locations',async()=>{
  const text='Заголовок\nОДИН, два — три; четыре! пять шесть семь восемь девять десять.';
  const r=await scan(text,[{id:'s1',text:phrase}]);
  assert.equal(r.status,'manual');assert.equal(r.matches.length,1);
  const m=r.matches[0];assert.equal(m.tokenCount,10);assert.equal(m.document.lineStart,2);
  assert.equal(text.slice(m.document.startOffset,m.document.endOffset),m.document.excerpt);
  assert.equal(r.textHash,sha(text));assert.equal(r.sources[0].sha256,sha(phrase));
  assert.equal(r.scope.officialOriginality,false);assert.equal(r.requiresReview,true);
  assert.equal('originalityPercent' in r,false);assert.equal('pass' in r,false);
});
test('contiguous threshold excludes scattered words and seven-token passages',async()=>{
  assert.equal((await scan('один два три четыре пять шесть семь',[{id:'s',text:phrase}])).matches.length,0);
  assert.equal((await scan('один x два x три x четыре x пять x шесть x семь x восемь',[{id:'s',text:phrase}])).matches.length,0);
  assert.equal((await scan(phrase,[{id:'s',text:phrase}],{minMatchTokens:10})).matches[0].tokenCount,10);
});
test('empty corpus remains not checked while internal repetitions are located without overlap',async()=>{
  const text=phrase+'\n'+phrase,r=await scan(text);
  assert.equal(r.status,'not_checked');assert.equal(r.matches.length,1);
  const m=r.matches[0];assert.equal(m.kind,'internal');assert.equal(m.source.id,'document');
  assert.equal(m.source.lineStart,1);assert.equal(m.document.lineStart,2);
  assert.ok(m.source.endToken<=m.document.startToken);
  assert.equal((await scan(phrase)).matches.length,0);
});
test('zero matches never constitutes automatic approval, short/empty fragments are unusable',async()=>{
  const r=await scan('неповторяющийся текст',[{id:'s',text:phrase}]);
  assert.equal(r.status,'manual');assert.equal(r.matches.length,0);assert.equal(r.requiresReview,true);
  assert.equal((await scan(phrase,[{id:'blank',text:''},{id:'short',text:'один'}])).status,'not_checked');
});
test('corpus digest and findings are deterministic, order independent and exact-byte sensitive',async()=>{
  const sources=[{id:'b',text:phrase},{id:'a',text:'другие слова'}],snapshot=JSON.stringify(sources);
  const a=await scan(phrase,sources),b=await scan(phrase,[...sources].reverse());
  assert.deepEqual(a,b);assert.equal(JSON.stringify(sources),snapshot);
  const c=await scan(phrase,[{id:'b',text:phrase+' '},{id:'a',text:'другие слова'}]);
  assert.notEqual(a.corpusHash,c.corpusHash);assert.notEqual(a.sources[1].sha256,c.sources[1].sha256);
});
test('Unicode canonical normalization matches decomposed Cyrillic; ё is not silently е',async()=>{
  const s='ёлка йод мир труд май июнь июль август';
  assert.equal((await scan(s.normalize('NFD'),[{id:'s',text:s}])).matches.length,1);
  assert.equal((await scan(s.replace('ё','е'),[{id:'s',text:s}])).matches.length,0);
});
test('repetitive adversarial input stops explicitly with bounded report and non-overlapping internal spans',async()=>{
  const r=await scan(('слово ').repeat(2000),[{id:'s',text:('слово ').repeat(2000)}]);
  assert.equal(r.limits.truncated,true);assert.ok(r.limits.reasons.length);
  assert.ok(r.matches.length<=BORROWING_LIMITS.maxMatches);
  assert.ok(r.limits.tokenComparisons<=BORROWING_LIMITS.maxTokenComparisons+1);
  assert.ok(JSON.stringify(r).length<300000);assert.equal(r.status,'manual');
});
test('document and corpus token coverage limits are explicit, with exact whole-input hashes',async()=>{
  const text=Array.from({length:20005},(_,i)=>'слово'+i).join(' ');
  const source=Array.from({length:40005},(_,i)=>'токен'+i).join(' ');
  const r=await scan(text,[{id:'s',text:source}]);
  assert.equal(r.scope.documentTokens,20005);assert.equal(r.scope.scannedDocumentTokens,20000);
  assert.equal(r.sources[0].tokenCount,40005);assert.equal(r.sources[0].scannedTokenCount,40000);
  assert.equal(r.textHash,sha(text));assert.equal(r.sources[0].sha256,sha(source));
  assert.deepEqual(r.limits.reasons,['document_token_limit','corpus_token_limit']);
});
test('comparison budget stops long overlapping candidates before an apparent complete report',async()=>{
  const text='слово '.repeat(20000),r=await scan(text,[{id:'s',text}]);
  assert.equal(r.limits.truncated,true);assert.deepEqual(r.limits.reasons,['comparison_limit']);
  assert.equal(r.limits.tokenComparisons,BORROWING_LIMITS.maxTokenComparisons+1);
  assert.ok(r.matches.length<BORROWING_LIMITS.maxMatches);
  assert.equal(r.matches[0].document.excerptTruncated,true);
  assert.equal(r.matches[0].document.excerpt.length,BORROWING_LIMITS.maxExcerptCharacters);
});
test('invalid hashes, duplicate/reserved ids and unbounded parameters fail closed',async()=>{
  for(const extra of [{fileHash:'bad'},{minMatchTokens:7},{minMatchTokens:41},{minMatchTokens:8.5}])await assert.rejects(scan(phrase,[],extra));
  await assert.rejects(scan(''));
  await assert.rejects(scan(phrase,[{id:'s',text:phrase},{id:'s',text:phrase}]));
  await assert.rejects(scan(phrase,[{id:'document',text:phrase}]));
  await assert.rejects(scan('x'.repeat(BORROWING_LIMITS.maxInputCharacters+1)));
  await assert.rejects(scan(phrase,Array.from({length:33},(_,i)=>({id:String(i),text:''}))));
});
test('scan has no network dependency',async()=>{
  const before=globalThis.fetch;globalThis.fetch=()=>{throw new Error('NETWORK_FORBIDDEN');};
  try {assert.equal((await scan(phrase,[{id:'s',text:phrase}])).matches.length,1);}
  finally {globalThis.fetch=before;}
});
