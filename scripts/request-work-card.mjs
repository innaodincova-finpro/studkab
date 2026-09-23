// Pure administrative preparation: no network, storage, submission or reassignment.
// SQL validates the addressed transfer and appends this card atomically under cloud CAS.
const fields={topic:'t',student:'n',group:'g',deadline:'dl',requirements:'rq'};
const formatFields={workType:'k',discipline:'d',univ:'u',faculty:'fc',kafedra:'kf',city:'ct',program:'pr',form:'fo',course:'co',supervisor:'s'};
const formatValues={mTop:'mt',mRight:'mr',mBottom:'mb',mLeft:'ml',font:'fn',size:'sz',spacing:'sp',indent:'ind'};
const chapters=['introduction','chapter1','chapter2','chapter3','conclusion','references','appendices'];
export function requestWorkCard(request,workId,{attachmentCount}={}){
 const p=request?.payload;
 if(!p||p.v!==1||!/^w[A-Za-z0-9_-]{1,99}$/.test(workId||'')||workId===p.id||workId===request.id)throw Error('Invalid independent work identifier');
 if(!/^[a-f0-9-]{36}$/i.test(request.id||'')||!Number.isSafeInteger(request.number)||request.number<1||request.client_id!==p.id)throw Error('Invalid request binding');
 if(typeof request.created_at!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(request.created_at)||!Number.isFinite(Date.parse(request.created_at)))throw Error('Missing request creation date');
 if(!Number.isSafeInteger(attachmentCount)||attachmentCount<0)throw Error('Provide verified attachment count');
 const work={id:workId,created:request.created_at.slice(0,10),status:'draft',format:{org:'',year:'',titlePageNum:false,toc:true},structure:Object.fromEntries(chapters.map(id=>[id,{text:'',status:'draft'}])),tasks:[]};
 function string(key){if(typeof p[key]!=='string')throw Error('Missing payload field '+key);return p[key];}
 for(const [key,source] of Object.entries(fields))work[key]=string(source);
 for(const [key,source] of Object.entries(formatFields))work.format[key]=string(source);
 for(const [key,source] of Object.entries(formatValues)){
  const value=p.fm?.[source];
  if(source==='fn'?typeof value!=='string':typeof value!=='number'||!Number.isFinite(value))throw Error('Missing exact format field '+source);
  work.format[key]=value;
 }
 work.req={id:string('id'),serverId:request.id,number:request.number,contact:string('cn'),org:string('org'),notes:string('mn'),sent:work.created,sentBy:'direct',attachments:attachmentCount,filesPending:false,pendingFiles:[],preserveSubmittedFields:true};
 return work;
}
export function appendRequestWorkCard(data,card){
 if(!data||!Array.isArray(data.works)||!card?.req?.serverId)throw Error('Invalid cabinet');
 if(data.works.some(w=>w.id===card.id||w.req?.id===card.req.id||w.req?.serverId===card.req.serverId))throw Error('Existing work or request binding');
 return {...structuredClone(data),works:[...structuredClone(data.works),structuredClone(card)]};
}
