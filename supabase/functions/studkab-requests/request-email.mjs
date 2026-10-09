const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const enc=new TextEncoder(),dec=new TextDecoder();
export function requestEmailSettings(cfg,{host,port,username,password,from}={}){
 return {host,port:Number(port),username,password,from,to:cfg?.notification_email};
}
export function emailConfigured({host,port,username,password,from,to}){
 return Boolean(/^[a-z0-9.-]+$/i.test(host||'')&&Number.isInteger(port)&&port>0&&port<65536&&
  username&&password&&EMAIL.test(from||'')&&EMAIL.test(to||''));
}
const b64=value=>btoa(Array.from(enc.encode(value),b=>String.fromCharCode(b)).join(''));
const fold=value=>value.match(/.{1,76}/g)?.join('\r\n')||'';
export async function sendRequestEmail(row,settings){
 const id=String(row.request_id||'');
 if(!/^[a-f0-9-]{36}$/i.test(id)||!Number.isSafeInteger(Number(row.number)))throw Error('Invalid request');
 const url='https://innaodincova-finpro.github.io/studkab/reestr.html#request='+encodeURIComponent(id);
 return sendSmtpMessage({subject:'Новая заявка №'+row.number+' в STUDKAB',body:'Опубликована заявка №'+row.number+'. Откройте её в реестре после входа: '+url},settings);
}
export function processNotificationMessage(event){
 const id=String(event.requestId||'');
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)||!Number.isSafeInteger(Number(event.number)))throw Error('Invalid event');
 const descriptions={file_prepared:'Файл подготовлен. Проверьте работу.',problem:'Подготовка работы требует внимания.',question:'В заявке есть новый вопрос.',answer:'Студент ответил на вопрос.',delivered:'Работа готова. Скачайте файл в кабинете.',handed:'Студент отметил работу как сданную.',rework:'Студент вернул работу на доработку.'};
 const body=descriptions[event.kind];if(!body)throw Error('Invalid event kind');
 const page=['question','delivered'].includes(event.kind)?'index.html':'reestr.html';
 return {title:'Заявка №'+event.number,subject:'Заявка №'+event.number+' — STUDKAB',body,url:'https://innaodincova-finpro.github.io/studkab/'+page+'#request='+encodeURIComponent(id)};
}
export async function sendProcessEmail(event,settings){
 const message=processNotificationMessage(event);
 return sendSmtpMessage({subject:message.subject,body:message.body+' Откройте заявку после входа: '+message.url},settings);
}
async function sendSmtpMessage({subject,body},{host,port,username,password,from,to,connect=()=>port===587?Deno.connect({hostname:host,port}):Deno.connectTls({hostname:host,port}),startTls=conn=>Deno.startTls(conn,{hostname:host})}){
 if(!emailConfigured({host,port,username,password,from,to}))throw Error('Email not configured');
 const message='From: STUDKAB <'+from+'>\r\nTo: <'+to+'>\r\nSubject: =?UTF-8?B?'+b64(subject)+'?=\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n'+fold(b64(body))+'\r\n.\r\n';
 let conn,deadlineTimer,expired=false,dataStarted=false;
 const closed=new WeakSet();
 const close=socket=>{if(!socket||closed.has(socket))return;closed.add(socket);try{socket.close();}catch{}};
 let timeoutReject;
 const timeout=new Promise((_,reject)=>{timeoutReject=reject;});
 // One deadline covers connection, TLS negotiation and the SMTP exchange.
 // A late-opened connection must be closed too, without sending credentials.
 const bounded=promise=>Promise.race([promise,timeout]);
 try{
  deadlineTimer=setTimeout(()=>{expired=true;close(conn);timeoutReject(Error('SMTP timeout'));},10000);
  conn=await bounded(Promise.resolve().then(connect).then(opened=>{if(expired){close(opened);throw Error('SMTP timeout');}return opened;}));
  let buffer='';
  let responseLines=[];
  const write=async value=>{
   const bytes=enc.encode(value);
   for(let at=0;at<bytes.length;){const n=await bounded(conn.write(bytes.subarray(at)));if(!Number.isInteger(n)||n<1||n>bytes.length-at)throw Error('SMTP write failed');at+=n;}
  };
  const response=async()=>{
   let code;responseLines=[];
   for(let count=0;count<32;count++){
    while(!buffer.includes('\n')){
     const bytes=new Uint8Array(2048),n=await bounded(conn.read(bytes));
     if(!Number.isInteger(n)||n<1||n>bytes.length)throw Error('SMTP closed');
     buffer+=dec.decode(bytes.subarray(0,n));
     if(buffer.length>8192)throw Error('SMTP response too long');
    }
    const end=buffer.indexOf('\n'),line=buffer.slice(0,end).replace(/\r$/,'');buffer=buffer.slice(end+1);
    if(!/^\d{3}[ -]/.test(line))throw Error('SMTP response invalid');
    if(code&&line.slice(0,3)!==code)throw Error('SMTP response mismatch');
    code=line.slice(0,3);responseLines.push(line.slice(4));
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
  if(port===587){
   // RFC 3207: never authenticate on the plaintext connection. Require the
   // upgrade and repeat EHLO using only the new, certificate-verified channel.
   if(!responseLines.some(line=>/^STARTTLS(?:\s|$)/i.test(line)))return {status:'failed'};
   outcome=await step('STARTTLS',[220]);if(outcome)return outcome;
   if(buffer)throw Error('SMTP unexpected plaintext after STARTTLS');
   conn=await bounded(Promise.resolve().then(()=>startTls(conn)).then(upgraded=>{if(expired){close(upgraded);throw Error('SMTP timeout');}return upgraded;}));
   buffer='';
   outcome=await step('EHLO studkab.local',[250]);if(outcome)return outcome;
  }
  outcome=await step('AUTH LOGIN',[334]);if(outcome)return outcome;
  outcome=await step(b64(username),[334]);if(outcome)return outcome;
  outcome=await step(b64(password),[235]);if(outcome)return outcome;
  outcome=await step('MAIL FROM:<'+from+'>',[250]);if(outcome)return outcome;
  outcome=await step('RCPT TO:<'+to+'>',[250,251]);if(outcome)return outcome;
  outcome=await step('DATA',[354]);if(outcome)return outcome;
  dataStarted=true;
  await write(message);
  const final=await response();
  if(final!==250)return {status:'unknown'};
  try{await write('QUIT\r\n');}catch{}
  return {status:'accepted'};
 }catch{
  return {status:dataStarted?'unknown':'pending'};
 }finally{
  clearTimeout(deadlineTimer);
  close(conn);
 }
}
