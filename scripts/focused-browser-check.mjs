import {execFileSync,spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const args=process.argv.slice(2);
let specs=[];
let list=false;
if(args.includes('--list')){list=true;args.splice(args.indexOf('--list'),1);}
if(args[0]==='--changed'){
  const base=args[1];
  if(args.length!==2 || !/^[a-f0-9]{40}$/.test(base||'')){
    console.error('Supply --changed with an exact 40-character base commit SHA.');process.exit(2);
  }
  const paths=execFileSync('git',['diff','--name-only','--diff-filter=ACMR','-z',base,'HEAD'],{cwd:root,encoding:'utf8'}).split('\0');
  specs=paths.filter(p=>/^tests\/browser\/[a-zA-Z0-9_./-]+\.spec\.cjs$/.test(p)&&existsSync(new URL('../'+p,import.meta.url)));
  if(!specs.length)console.log('No changed browser specs: checking the complete browser suite first.');
}else{
  if(!args.length || args.some(p=>!/^tests\/browser\/[a-zA-Z0-9_./-]+\.spec\.cjs$/.test(p)||p.includes('..')||!existsSync(new URL('../'+p,import.meta.url)))){
    console.error('Supply existing tests/browser/*.spec.cjs files, or --changed <base SHA>.');process.exit(2);
  }
  specs=args;
}
console.log('Browser precheck: '+(specs.join(', ')||'all browser specs'));
const result=spawnSync(process.execPath,[fileURLToPath(new URL('../node_modules/@playwright/test/cli.js',import.meta.url)),'test',...specs,...(list?['--list']:[])],{cwd:root,stdio:'inherit'});
if(result.error)console.error(result.error.message);
process.exit(result.status??1);
