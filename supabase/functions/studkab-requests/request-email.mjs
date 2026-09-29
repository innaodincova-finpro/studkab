const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const enc=new TextEncoder(),dec=new TextDecoder();
export function requestEmailSettings(cfg,{from,password}={}){
 return {from,password,to:cfg?.notification_email};
}
export function emailConfigured({from,password,to}){
 return Boolean(password&&EMAIL.test(from||'')&&EMAIL.test(to||''));
}
const b64=value=>btoa(Array.from(enc.encode(value),b=>String.fromCharCode(b)).join(''));
const fold=value=>value.match(/.{1,76}/g)?.join('\r\n')||'';
export async function sendRequestEmail(row,{from,password,to,connect=()=>Deno.connectTls({hostname:'smtp.mail.ru',port:465})}){
 if(!emailConfigured({from,password,to}))throw Error('Email not configured');
 const id=String(row.request_id||'');
 if(!/^[a-f0-9-]{36}$/i.test(id)||!Number.isSafeInteger(Number(row.number)))throw Error('Invalid request');
 const url='https://innaodincova-finpro.github.io/studkab/reestr.html#request='+encodeURIComponent(id);
 const subject='Новая заявка №'+row.number+' в STUDKAB';
 const body='Опубликована заявка №'+row.number+'. Откройте её в реестре после входа: '+url;
 const message='From: STUDKAB <'+from+'>\r\nTo: <'+to+'>\r\nSubject: =?UTF-8?B?'+b64(subject)+'?=\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n'+fold(b64(body))+'\r\n.\r\n';
 let conn,deadlineTimer;
 try{
  let connectTimer;
  const opening=connect();
  try{conn=await Promise.race([opening,new Promise((_,reject)=>{connectTimer=setTimeout(()=>reject(Error('SMTP connect timeout')),10000);})]);}
  finally{clearTimeout(connectTimer);}
  deadlineTimer=setTimeout(()=>{try{conn?.close();}catch{}},10000);
  let buffer='';
  const write=async value=>{
   const bytes=enc.encode(value);
   for(let at=0;at<bytes.length;){const n=await conn.write(bytes.subarray(at));if(!n)throw Error('SMTP write failed');at+=n;}
  };
  const response=async()=>{
   let code;
   for(let count=0;count<32;count++){
    while(!buffer.includes('\n')){
     const bytes=new Uint8Array(2048),n=await conn.read(bytes);
     if(n===null)throw Error('SMTP closed');
     buffer+=dec.decode(bytes.subarray(0,n));
     if(buffer.length>8192)throw Error('SMTP response too long');
    }
    const end=buffer.indexOf('\n'),line=buffer.slice(0,end).replace(/\r$/,'');buffer=buffer.slice(end+1);
    if(!/^\d{3}[ -]/.test(line))throw Error('SMTP response invalid');
    if(code&&line.slice(0,3)!==code)throw Error('SMTP response mismatch');
    code=line.slice(0,3);
    if(line[3]===' ')return Number(code);
   }
   throw Error('SMTP response too long');
  };
  const step=async(command,expected)=>{
   if(command)await write(command+'\r\n');
   const code=await response();
   if(!expected.includes(code)){
    if(code>=400&&code<500)return {status:'pending'};
    if(code>=500)return {status:'failed'};
    throw Error('SMTP unexpected response');
   }
   return null;
  };
  let outcome=await step(null,[220]);if(outcome)return outcome;
  outcome=await step('EHLO studkab.local',[250]);if(outcome)return outcome;
  outcome=await step('AUTH LOGIN',[334]);if(outcome)return outcome;
  outcome=await step(b64(from),[334]);if(outcome)return outcome;
  outcome=await step(b64(password),[235]);if(outcome)return outcome;
  outcome=await step('MAIL FROM:<'+from+'>',[250]);if(outcome)return outcome;
  outcome=await step('RCPT TO:<'+to+'>',[250,251]);if(outcome)return outcome;
  outcome=await step('DATA',[354]);if(outcome)return outcome;
  await write(message);
  const final=await response();
  if(final!==250)return {status:'unknown'};
  try{await write('QUIT\r\n');}catch{}
  return {status:'accepted'};
 }catch{
  return {status:'unknown'};
 }finally{
  clearTimeout(deadlineTimer);
  try{conn?.close();}catch{}
 }
}
