// Internal service only. Caller must authenticate and authorize the executor.
// Transport is injected; no credentials or arbitrary message body come from the browser.
export function invitationMailer({from,transport,createLink,render}) {
 return async function sendInvitation(email) {
  if(typeof email!=='string'||email.length>254||!/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(email))return {status:'invalid_email'};
  email=email.trim().toLowerCase();
  if(!transport||!from)return {status:'not_configured'};
  const link=await createLink(email,false);
  const text=render(email,link.url,link.existing?'existing':'new');
  try {
   const result=await transport.sendMail({from:{name:'Кабинет студента',address:from},to:[{address:email}],subject:'Приглашение в «Кабинет студента»',text,disableFileAccess:true,disableUrlAccess:true});
   const accepted=(result.accepted||[]).map(x=>String(typeof x==='string'?x:x.address).toLowerCase());
   if(!accepted.includes(email))return {status:'rejected'};
   // SMTP acceptance does not prove delivery or a student's first login.
   return {status:'accepted'};
  }catch(e){
   // No automatic retry: an interrupted response can follow successful acceptance.
   if(e.code==='EAUTH')return {status:'sender_auth_failed'};
   if(e.code==='EENVELOPE')return {status:'rejected'};
   return {status:'unknown'};
  }
 };
}
