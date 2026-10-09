// Bounded, non-evaluating OMML reading. Preserve the original math tree for provenance.
const M='http://schemas.openxmlformats.org/officeDocument/2006/math';
const CONSTRUCTS=['r','f','sSup','sSub','sSubSup','sPre','rad','limLow','limUpp','func','nary','d','m','eqArr'];
const nodes=n=>Array.from(n.childNodes||[]).filter(c=>c.nodeType===1);
const get=(n,name)=>nodes(n).filter(c=>c.namespaceURI===M&&c.localName===name);
const value=n=>{if(!n)return '';return n.getAttributeNS(M,'val')||n.getAttribute('m:val')||'';};
class UnsupportedMath extends Error{}
const bad=()=>{throw new UnsupportedMath();};
export function readOfficeMath(root){
 let visits=0;
 const original=root.toString();
 const one=(n,name)=>{const found=get(n,name);if(found.length!==1)bad();return found[0];};
 const settings=(n,name,allowed)=>{const list=get(n,name);if(list.length>1)bad();const p=list[0];
  if(p)for(const c of nodes(p)){if(c.namespaceURI!==M||!allowed.includes(c.localName)||nodes(c).length)bad();}
  return key=>value(p&&get(p,key)[0]);
 };
 const shape=(n,names)=>{for(const c of nodes(n))if(c.namespaceURI!==M||!names.includes(c.localName))bad();};
 function render(n,depth=0){
  if(++visits>4000||depth>48||n.namespaceURI!==M)bad();
  const name=n.localName,child=(key)=>render(one(n,key),depth+1);
  // Formatting and unknown structures never silently turn into flattened text.
  if(['oMath','e','num','den','sub','sup','deg','lim','fName'].includes(name)){shape(n,CONSTRUCTS);return nodes(n).map(c=>render(c,depth+1)).join('');}
  if(name==='r'){
   shape(n,['rPr','t']);const strings=get(n,'t');if(strings.length!==1)bad();
   const style=settings(n,'rPr',['sty','nor','lit','scr','aln','brk']);
   if(style('scr')&&!['roman'].includes(style('scr')))bad();
   if(style('brk')||style('aln'))bad();
   const text=strings[0].textContent;if(!text||/[\\{}]/.test(text)||nodes(strings[0]).length)bad();
   const sty=style('sty');if(sty&&!['p','i','b','bi'].includes(sty))bad();
   return sty==='b'?'\\mathbf{'+text+'}':sty==='bi'?'\\boldsymbol{'+text+'}':style('nor')==='1'||sty==='p'?'\\mathrm{'+text+'}':text;
  }
  if(name==='f'){
   shape(n,['fPr','num','den']);const p=settings(n,'fPr',['type']),type=p('type')||'bar';
   if(!['bar','lin','skw','noBar'].includes(type))bad();const num=child('num'),den=child('den');if(!num||!den)bad();
   return type==='noBar'?'\\genfrac{}{}{0pt}{}{'+num+'}{'+den+'}':type==='lin'?'('+num+')/('+den+')':'\\frac{'+num+'}{'+den+'}';
  }
  if(['sSup','sSub','sSubSup','sPre'].includes(name)){
   const subs=name!=='sSup',sups=name!=='sSub';shape(n,[name+'Pr','e',...(subs?['sub']:[]),...(sups?['sup']:[])]);
   settings(n,name+'Pr',[]);const base=child('e'),sub=subs?child('sub'):'',sup=sups?child('sup'):'';
   if(!base||(subs&&!sub)||(sups&&!sup))bad();
   const scripts=(subs?'_{'+sub+'}':'')+(sups?'^{'+sup+'}':'');return name==='sPre'?'{}'+scripts+'{'+base+'}':'{'+base+'}'+scripts;
  }
  if(name==='rad'){
   shape(n,['radPr','deg','e']);const p=settings(n,'radPr',['degHide']),degree=child('deg'),base=child('e');
   if(!base||!['','0','1'].includes(p('degHide'))||(p('degHide')==='1'&&degree))bad();
   return '\\sqrt'+(degree?'['+degree+']':'')+'{'+base+'}';
  }
  if(['limLow','limUpp'].includes(name)){
   shape(n,[name+'Pr','e','lim']);settings(n,name+'Pr',[]);const base=child('e'),limit=child('lim');if(!base||!limit)bad();
   return (name==='limLow'?'\\underset{':'\\overset{')+limit+'}{'+base+'}';
  }
  if(name==='func'){
   shape(n,['funcPr','fName','e']);settings(n,'funcPr',[]);const fn=child('fName'),argument=child('e');if(!fn||!argument)bad();return fn+'('+argument+')';
  }
  if(name==='nary'){
   shape(n,['naryPr','sub','sup','e']);const p=settings(n,'naryPr',['chr','limLoc','grow','subHide','supHide']);
   const operators={'∫':'\\int','∬':'\\iint','∭':'\\iiint','∮':'\\oint','∑':'\\sum','∏':'\\prod','⋂':'\\bigcap','⋃':'\\bigcup'};
   const operator=operators[p('chr')||'∫'];if(!operator||!['','subSup','undOvr'].includes(p('limLoc')))bad();
   const sub=child('sub'),sup=child('sup'),base=child('e');if(!base||(p('subHide')==='1'&&sub)||(p('supHide')==='1'&&sup))bad();
   return operator+(sub?'_{'+sub+'}':'')+(sup?'^{'+sup+'}':'')+'{'+base+'}';
  }
  if(name==='d'){
   shape(n,['dPr','e']);const p=settings(n,'dPr',['begChr','endChr','sepChr','grow','shp']);
   const delimiters=['(',')','[',']','{','}','|','‖','⌈','⌉','⌊','⌋','⟨','⟩',''];
   const property=key=>{const pr=get(n,'dPr')[0],el=pr&&get(pr,key)[0];return el?value(el):null;};
   const begin=property('begChr')??'(',end=property('endChr')??')',separator=property('sepChr')??'|';
   if(!delimiters.includes(begin)||!delimiters.includes(end)||!['|',',',';',''].includes(separator))bad();
   const escape=s=>s==='{'?'\\{':s==='}'?'\\}':s;const parts=get(n,'e');if(!parts.length)bad();
   return escape(begin)+parts.map(c=>render(c,depth+1)).join(separator)+escape(end);
  }
  if(name==='m'){
   shape(n,['mPr','mr']);settings(n,'mPr',['baseJc','plcHide','rSpRule','rSp','cGpRule','cGp','cSp']);
   const rows=get(n,'mr');if(!rows.length||rows.length>100)bad();let columns;
   const text=rows.map(row=>{shape(row,['e']);const cells=get(row,'e');if(!cells.length||cells.length>100||(columns!==undefined&&columns!==cells.length))bad();columns=cells.length;return cells.map(c=>render(c,depth+1)).join(' & ');}).join(' \\\\ ');
   return '\\begin{matrix}'+text+'\\end{matrix}';
  }
  if(name==='eqArr'){
   shape(n,['eqArrPr','e']);settings(n,'eqArrPr',['baseJc','maxDist','objDist','rSpRule','rSp']);const rows=get(n,'e');if(!rows.length)bad();return '\\begin{aligned}'+rows.map(c=>render(c,depth+1)).join(' \\\\ ')+'\\end{aligned}';
  }
  // acc/bar/groupChr/phantom and unknown math are retained but require full support.
  bad();
 }
 try{
  if(root.localName!=='oMath'||root.namespaceURI!==M||original.length>200000)bad();
  const text=render(root);if(!text.trim())bad();return {complete:true,text,format:'latex',omml:original};
 }catch(e){if(!(e instanceof UnsupportedMath))throw e;return {complete:false,text:'',format:'omml',omml:original};}
}
