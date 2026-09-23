// Local, deterministic comparison only. Callers must bind extracted text to exact Word bytes.
export const BORROWING_ALGORITHM_VERSION = 'contiguous-tokens-v1';
export const BORROWING_LIMITS = Object.freeze({maxInputCharacters:1000000,maxSources:32,maxDocumentTokens:20000,maxCorpusTokens:40000,maxMatches:100,maxCandidates:200000,maxTokenComparisons:1000000,maxExcerptCharacters:400});
const encoder = new TextEncoder();
async function hash(text) {
  return [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',encoder.encode(text)))].map(x=>x.toString(16).padStart(2,'0')).join('');
}
function tokenize(text) {
  const tokens=[]; let line=1,previous=0;
  for (const m of text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}\p{M}]*/gu)) {
    for(let k=previous;k<m.index;k++) if(text[k]==='\n') line++;
    tokens.push({value:m[0].normalize('NFC').toLowerCase(),start:m.index,end:m.index+m[0].length,line});
    previous=m.index+m[0].length;
  }
  return tokens;
}
function location(item,start,count) {
  const a=item.tokens[start],b=item.tokens[start+count-1];
  const full=item.text.slice(a.start,b.end);
  return {startToken:start,endToken:start+count,startOffset:a.start,endOffset:b.end,lineStart:a.line,lineEnd:b.line,excerpt:full.slice(0,BORROWING_LIMITS.maxExcerptCharacters),excerptTruncated:full.length>BORROWING_LIMITS.maxExcerptCharacters};
}
/** Offsets are UTF-16, ends exclusive, lines 1-based. No stemming, OCR, semantics,
 * citation exclusions, Internet search or official originality measurement. */
export async function scanInternalBorrowing({text,fileHash,sources=[],minMatchTokens=12}={}) {
  const cap=BORROWING_LIMITS;
  if(typeof text!=='string'||!text.trim()||text.length>cap.maxInputCharacters) throw new Error('BORROWING_TEXT_INVALID');
  if(typeof fileHash!=='string'||!/^[a-f0-9]{64}$/.test(fileHash)) throw new Error('BORROWING_FILE_HASH_INVALID');
  if(!Number.isInteger(minMatchTokens)||minMatchTokens<8||minMatchTokens>40) throw new Error('BORROWING_MIN_MATCH_INVALID');
  if(!Array.isArray(sources)||sources.length>cap.maxSources) throw new Error('BORROWING_CORPUS_INVALID');
  const ids=new Set(); let characters=text.length;
  for(const s of sources) {
    if(!s||typeof s.id!=='string'||!s.id.trim()||s.id.length>128||s.id==='document'||ids.has(s.id)||typeof s.text!=='string') throw new Error('BORROWING_SOURCE_INVALID');
    ids.add(s.id); characters+=s.text.length;
    if(characters>cap.maxInputCharacters) throw new Error('BORROWING_INPUT_TOO_LARGE');
  }
  const reasons=new Set(),matches=[];
  const allDocumentTokens=tokenize(text),textHash=await hash(text);
  const document={id:'document',sha256:textHash,text,tokens:allDocumentTokens.slice(0,cap.maxDocumentTokens)};
  if(document.tokens.length<allDocumentTokens.length) reasons.add('document_token_limit');
  let remaining=cap.maxCorpusTokens;
  const corpus=[];
  for(const s of [...sources].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)) {
    const all=tokenize(s.text),tokens=all.slice(0,remaining); remaining-=tokens.length;
    if(tokens.length<all.length) reasons.add('corpus_token_limit');
    corpus.push({...s,sha256:await hash(s.text),tokens,tokenCount:all.length});
  }
  const sourceSummary=corpus.map(s=>({id:s.id,sha256:s.sha256,tokenCount:s.tokenCount,scannedTokenCount:s.tokens.length}));
  const corpusHash=await hash(JSON.stringify(sourceSummary.map(s=>[s.id,s.sha256])));
  let candidates=0,comparisons=0,halted=false;
  function key(tokens,i) {return tokens.slice(i,i+minMatchTokens).map(t=>t.value).join('\u0000');}
  function compare(source,internal) {
    const index=new Map(),diagonals=new Map();
    for(let j=0;j<=source.tokens.length-minMatchTokens;j++) {
      const k=key(source.tokens,j); if(!index.has(k))index.set(k,[]); index.get(k).push(j);
    }
    for(let i=0;i<=document.tokens.length-minMatchTokens&&!halted;i++) {
      for(const j of index.get(key(document.tokens,i))||[]) {
        if(internal&&j+minMatchTokens>i) break;
        if(++candidates>cap.maxCandidates){reasons.add('candidate_limit');halted=true;break;}
        const diagonal=j-i;
        if((diagonals.get(diagonal)||0)>i) continue;
        let count=minMatchTokens;
        while(i+count<document.tokens.length&&j+count<source.tokens.length&&(!internal||j+count<i)) {
          if(++comparisons>cap.maxTokenComparisons){reasons.add('comparison_limit');halted=true;break;}
          if(document.tokens[i+count].value!==source.tokens[j+count].value)break;
          count++;
        }
        if(halted)break;
        diagonals.set(diagonal,i+count-minMatchTokens+1);
        if(matches.length>=cap.maxMatches){reasons.add('match_limit');halted=true;break;}
        matches.push({id:`${internal?'internal':'corpus'}:${encodeURIComponent(source.id)}:${i}:${j}:${count}`,kind:internal?'internal':'corpus',tokenCount:count,document:location(document,i,count),source:{id:source.id,sha256:source.sha256,...location(source,j,count)}});
      }
    }
  }
  for(const s of corpus) {if(halted)break; compare(s,false);}
  if(!halted)compare(document,true);
  const usableSources=corpus.filter(s=>s.tokens.length>=minMatchTokens).length;
  return {algorithmVersion:BORROWING_ALGORITHM_VERSION,status:usableSources?'manual':'not_checked',requiresReview:true,fileHash,textHash,corpusHash,sources:sourceSummary,
    scope:{providedSources:sources.length,usableSources,documentTokens:allDocumentTokens.length,scannedDocumentTokens:document.tokens.length,officialOriginality:false,normalization:'NFC lowercase Unicode letters/numbers; punctuation separates tokens; ё remains distinct',coverage:'provided extracted source fragments and document body text only',limitations:['No Internet or external database search','No semantic or paraphrase detection','No automatic quotation or bibliography exclusions','No proof of extraction completeness or file/text binding; caller must verify','Locations are extracted-text lines, not Word pages','Every match and absence of matches requires human review']},
    limits:{...cap,minMatchTokens,candidates,tokenComparisons:comparisons,truncated:reasons.size>0,reasons:[...reasons]},matches};
}
