const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function emailConfigured({apiKey,from,to}){
 return Boolean(apiKey&&EMAIL.test(from||'')&&EMAIL.test(to||''));
}
export async function sendRequestEmail(row,{apiKey,from,to,request=fetch}){
 if(!emailConfigured({apiKey,from,to}))throw Error('Email not configured');
 const url='https://innaodincova-finpro.github.io/studkab/reestr.html#request='+encodeURIComponent(row.request_id);
 let response;
 try{
  response=await request('https://api.brevo.com/v3/smtp/email',{
   method:'POST',headers:{'Content-Type':'application/json',accept:'application/json','api-key':apiKey},
   body:JSON.stringify({sender:{email:from,name:'STUDKAB'},to:[{email:to}],
    subject:'Новая заявка №'+row.number+' в STUDKAB',
    textContent:'Опубликована заявка №'+row.number+'. Откройте её в реестре после входа: '+url}),
   signal:AbortSignal.timeout(10000)
  });
 }catch{return {status:'unknown'};}
 if(response.status===429)return {status:'pending'};
 if(!response.ok)return {status:response.status>=500?'unknown':'failed'};
 let answer;try{answer=await response.json();}catch{return {status:'unknown'};}
 return answer?.messageId?{status:'accepted',messageId:String(answer.messageId)}:{status:'unknown'};
}
