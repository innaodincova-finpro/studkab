import {currentAttachments} from './current-attachments.mjs';

// Inventory clearly enumerated clauses without treating extraction as an
// interpretation of applicability. Each entry remains unverified until the
// complete source context has been checked. Never silently truncate a list.
export function inventoryExplicitClauses(passport,attachments){
 if(passport.status&&passport.status!=='draft')return passport;
 const leaves=currentAttachments(attachments).filter(a=>['assignment','methodology'].includes(a.category)&&typeof a.extracted_text==='string');
 const active=new Set(leaves.map(a=>a.id));
 const items=passport.items.filter(i=>!/^REQ_[a-f0-9]{32}_\d+$/u.test(i.id)||active.has(i.source_attachment_id));
 const normalized=text=>String(text).replace(/\s+/gu,' ').trim().toLowerCase();
 const seen=new Set(items.map(i=>i.source_attachment_id+'\n'+normalized(i.text)));
 let changed=items.length!==passport.items.length;
 for(const row of leaves){
  const lines=row.extracted_text.replace(/\r/g,'').split('\n');
  for(let n=0;n<lines.length;n++){
   const line=lines[n].trim(),match=/^(?:\d{1,2}(?:\.\d{1,2}){0,2}[.)]?|[•*–-])\s+(.+)$/u.exec(line);
   // Explicit commands often state a separate operation without saying
   // "necessary" or "required". Keep each as an unverified source-bound item.
   const imperative=/^(?:рассчита(?:ть|йте)|вычисли(?:ть|те)|определи(?:ть|те)|построи(?:ть|те)|сопостави(?:ть|те)|проанализирова(?:ть|йте))(?=\s|[:—–-])/iu;
   const clause=(match?.[1]||(/^(?:в\s+работе\s+необходимо|работа\s+должна|документ\s+должен|отч[её]т\s+должен|необходимо|требуется|следует|обязательно)(?=\s|[:—–-])/iu.test(line)||imperative.test(line)?line:'')).trim();
   if(!clause)continue;
   if(clause.length<20||clause.length>1000||!/должн|необходим|требует|обязател|не менее|не более|следует|включа|содерж|представ|оформ|указа|рассчита(?:ть|йте)|вычисли(?:ть|те)|определи(?:ть|те)|построи(?:ть|те)|сопостави(?:ть|те)|проанализирова(?:ть|йте)/iu.test(clause))continue;
   const normalized=clause.replace(/\s+/gu,' ').toLowerCase();
   const key=row.id+'\n'+normalized;
   if(seen.has(key)||items.some(i=>i.source_attachment_id===row.id&&String(i.text).replace(/\s+/gu,' ').trim().toLowerCase().includes(normalized)))continue;
   const id='REQ_'+row.id.replace(/-/g,'').toLowerCase()+'_'+(n+1);
   if(items.some(i=>i.id===id))continue;
   if(items.length>=100)throw Error('Слишком много пунктов в материалах. Нужен разбор условий по частям');
   items.push({id,category:'method',required:true,text:clause,
    source:`${row.file_name||'Приложение'}, строка извлечённого текста ${n+1}`.slice(0,1000),
    source_attachment_id:row.id,verified:false,answer_ids:[]});
   seen.add(key);changed=true;
  }
 }
 return changed?{...passport,items}:passport;
}


// Source-bound coverage is rechecked from the current files, independently of
// the IDs assigned by the draft builder. A similar clause in another source,
// an optional item or an unverified interpretation cannot cover this clause.
export function missingExplicitClauses(items,attachments){
 const clauses=inventoryExplicitClauses({status:'draft',items:[]},attachments).items;
 const normalize=text=>String(text||'').replace(/\s+/gu,' ').trim().toLowerCase();
 return clauses.filter(clause=>!items.some(item=>item.source_attachment_id===clause.source_attachment_id&&
  item.required===true&&item.verified===true&&normalize(item.text).includes(normalize(clause.text))));
}
