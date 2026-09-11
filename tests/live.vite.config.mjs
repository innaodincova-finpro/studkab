import {defineConfig} from 'vite';
import fs from 'node:fs';
import path from 'node:path';
const target=process.env.API_URL;
if(!target||!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(target))throw Error('Live acceptance requires loopback Supabase');
if(!process.env.ANON_KEY)throw Error('Missing isolated publishable key');
export default defineConfig({server:{host:'127.0.0.1',proxy:Object.fromEntries(['/auth/v1','/rest/v1','/storage/v1','/functions/v1'].map(p=>[p,{target,changeOrigin:true}]))},plugins:[{
 name:'live-isolated-acceptance',configureServer(server){server.middlewares.use((req,res,next)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/oblako-config.js'){res.setHeader('Content-Type','application/javascript');return res.end('window.OBLAKO_CONFIG={url:location.origin,key:'+JSON.stringify(process.env.ANON_KEY)+'};');}
  if(url.pathname==='/sw.js'){res.setHeader('Content-Type','application/javascript');return res.end('/* test environment: no service worker */');}
  if(['/','/index.html','/reestr.html'].includes(url.pathname)){
   let html=fs.readFileSync(path.resolve(url.pathname==='/reestr.html'?'reestr.html':'index.html'),'utf8');
   html=html.replace(/https:\/\/cdn.jsdelivr.net\/npm\/@supabase\/supabase-js@2/g,'/tests/live-sdk.js');
   res.setHeader('Content-Type','text/html; charset=utf-8');
   res.setHeader('Content-Security-Policy',"connect-src 'self'; worker-src 'none'");return res.end(html);
  }
  next();
 });}
}]});
