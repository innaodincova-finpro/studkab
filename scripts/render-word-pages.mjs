#!/usr/bin/env node
// Local inspection only: does not certify Microsoft Word compatibility or quality.
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,readdirSync,renameSync,rmSync,statSync,writeFileSync,mkdirSync} from 'node:fs';
import {basename,dirname,extname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

function run(command,args){
 const result=spawnSync(command,args,{encoding:'utf8',timeout:120000,maxBuffer:1024*1024});
 if(result.error||result.status!==0)throw Error(`${command}: ${result.error?.message||result.stderr||result.stdout||'exit '+result.status}`);
 return result.stdout;
}
function hash(path){return createHash('sha256').update(readFileSync(path)).digest('hex');}

export function renderWordPages(input,output){
 if(!input||!output)throw Error('Usage: node scripts/render-word-pages.mjs INPUT.docx OUTPUT_DIRECTORY');
 const docx=resolve(input),target=resolve(output),size=statSync(docx).size;
 if(extname(docx).toLowerCase()!=='.docx'||size<4||size>32*1024*1024)throw Error('Expected DOCX from 4 bytes to 32 MiB');
 if(readFileSync(docx).subarray(0,4).toString('binary')!=='PK\x03\x04')throw Error('Not a DOCX archive');
 // Never replace a previous inspection: it may refer to a different Word version.
 try{statSync(target);throw Error('Output directory already exists');}catch(e){if(e.code!=='ENOENT')throw e;}
 mkdirSync(dirname(target),{recursive:true});
 const staging=mkdtempSync(join(dirname(target),'.word-pages-'));
 try{
  const profile=join(staging,'profile'),pdf=join(staging,basename(docx).replace(/\.docx$/i,'.pdf'));
  const version=run('soffice',['--version']).trim();
  run('soffice',['-env:UserInstallation='+pathToFileURL(profile).href,'--headless','--convert-to','pdf','--outdir',staging,docx]);
  if(readFileSync(pdf).subarray(0,5).toString()!=='%PDF-')throw Error('Converter did not produce a PDF');
  const info=run('pdfinfo',[pdf]),match=info.match(/^Pages:\s*(\d+)\s*$/m),count=Number(match?.[1]);
  if(!Number.isInteger(count)||count<1||count>200)throw Error('PDF has no valid page count (limit 200)');
  run('pdftoppm',['-png','-scale-to','1440',pdf,join(staging,'page')]);
  const pages=readdirSync(staging).filter(name=>/^page-\d+\.png$/.test(name))
   .sort((a,b)=>Number(a.match(/\d+/)[0])-Number(b.match(/\d+/)[0]));
  if(pages.length!==count)throw Error(`Rendered ${pages.length} of ${count} pages`);
  const manifest={sourceName:basename(docx),sourceSha256:hash(docx),sourceBytes:size,
   converter:version,pdfName:basename(pdf),pdfSha256:hash(pdf),pageCount:count,
   pages:pages.map(name=>({name,sha256:hash(join(staging,name))})),
   scope:'Local LibreOffice rendering; Microsoft Word opening, accuracy and layout are not certified.'};
  writeFileSync(join(staging,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  rmSync(profile,{recursive:true,force:true});
  renameSync(staging,target);
  return manifest;
 }catch(error){rmSync(staging,{recursive:true,force:true});throw error;}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const manifest=renderWordPages(process.argv[2],process.argv[3]);
  process.stdout.write(JSON.stringify({sourceSha256:manifest.sourceSha256,pdfSha256:manifest.pdfSha256,pageCount:manifest.pageCount})+'\n');
 }catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}
}
