import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
export default defineConfig({
 server:{host:'0.0.0.0',allowedHosts:['terminal.local']},
 plugins:[{name:'isolated-acceptance',configureServer(server){
   server.middlewares.use((req,res,next)=>{
     const url=new URL(req.url,'http://local');
     if(url.pathname==='/oblako-config.js') {
       res.setHeader('Content-Type','application/javascript');
       return res.end('window.OBLAKO_CONFIG={url:"http://terminal.local:4173",key:"test-only"};');
     }
     if(url.pathname==='/sw.js') {res.setHeader('Content-Type','application/javascript');return res.end('/* No worker in acceptance preview. */');}
     if(['/','/index.html','/reestr.html'].includes(url.pathname)){
       let html=fs.readFileSync(path.resolve(url.pathname==='/reestr.html'?'reestr.html':'index.html'),'utf8');
       html=html.replace(/<script[^>]+src="https:\/\/cdn.jsdelivr.net\/npm\/@supabase[^>]*><\/script>/g,'<script src="/tests/qa-cloud.js"></script>');
       if(url.searchParams.has('no-sdk')) html=html.replace('<script src="/tests/qa-cloud.js"></script>','<script>window.supabase=null;</script>');
       res.setHeader('Content-Type','text/html; charset=utf-8');
       // Explicit live-AI QA opt-in. Mocked cloud remains isolated; only the
       // existing owner-provided AI endpoint is allowed, never arbitrary URLs.
       const aiOrigin=url.searchParams.get('ai-qa')==='1'?' https://calm-bird-dae8.bf6mhynzgm.workers.dev':'';
       res.setHeader('Content-Security-Policy',"connect-src 'self'"+aiOrigin+"; worker-src 'none'");
       return res.end(html);
     }
     next();
   });
 }}]
});
