const uuid='[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
export async function studyDialog(update,{db,telegram,chatId}){
 const call=payload=>db.action({p_chat:chatId,p_action:payload.action,p_request:payload.request||null,p_proposal:payload.proposal||null,p_text:payload.text||null,p_key:Number.isSafeInteger(update.update_id)?'telegram:'+update.update_id:null,p_reply:payload.reply||null});
 const say=(text,reply_markup)=>telegram('sendMessage',{chat_id:chatId,text,...(reply_markup?{reply_markup}:{})});
 const callback=update.callback_query;
 let command;
 if(callback){
  command=typeof callback.data==='string'&&callback.data.match(new RegExp('^(study|publish|edit|return):('+uuid+')$','i'));
  if(!command){await telegram('answerCallbackQuery',{callback_query_id:callback.id,text:'Откройте заявку заново'});return;}
 }else command=typeof update.message?.text==='string'&&update.message.text.match(new RegExp('^/study(?:@Studkab_Requests_bot)?\\s+('+uuid+')\\s*$','i'));
 const mode=callback?command[1]:'study',id=callback?command[2]:command?.[1];
 let result;
 if(command){result=await call({action:mode,request:mode==='study'?id:null,proposal:mode==='study'?null:id});}
 else if(update.message?.voice){await say('Голос ещё не включён: сначала должны быть заданы распознавание, бюджет и срок хранения записи. Сообщение не отправлено помощнику.');return;}
 else if(typeof update.message?.text==='string'){
  const parent=update.message.reply_to_message;
  if(!Number.isSafeInteger(parent?.message_id)||parent.from?.is_bot!==true||parent.from?.username!=='Studkab_Requests_bot'){
   await say('Откройте нужную заявку кнопкой в уведомлении или реестре и ответьте на сообщение бота. Так комментарий попадёт в правильную заявку.');return;
  }
  if(!Number.isSafeInteger(update.update_id)||!update.message.text.trim()||update.message.text.length>2000){await say('Сообщение не сохранено: проверьте длину текста.');return;}
  result=await call({action:'reply',reply:parent.message_id,text:update.message.text.trim()});
 }else return;
 if(callback)await telegram('answerCallbackQuery',{callback_query_id:callback.id,text:result?.ok?'Решение сохранено':result?.requestId?'Заявка открыта':'Действие не подтверждено'});
 if(result?.forbidden)return;
 if(result?.stale||result?.limited||result?.invalid||result?.conflict){await say('Действие не сохранено. Заявка изменилась, текст не подходит или достигнут предел изучения. Откройте её заново.');return;}
 if(result?.ok){await say(result.mode==='comment'?'Комментарий сохранён приватно. Повторное изучение выполнится в пределах разрешённого бюджета.':'Решение сохранено. Веб-реестр показывает ту же версию вопроса.');return;}
 if(!result?.requestId)return;
 const q=result.proposals?.find(q=>q.state==='pending'&&q.analysis_id===result.analysisId);
 if(mode==='edit'||mode==='return'){
  const sent=await say(mode==='edit'?'Напишите точный текст вопроса, который нужно отправить студенту.':'Напишите замечание для повторного изучения (от 10 знаков).',{force_reply:true,input_field_placeholder:mode==='edit'?'Точный вопрос студенту':'Замечание помощнику'});
  await db.context({p_chat:chatId,p_message:sent.message_id,p_request:result.requestId,p_manifest:result.manifest,p_mode:mode,p_proposal:id});return;
 }
 await say('Заявка №'+result.number+'. '+(result.state==='done'?'Изучение завершено.':'Изучение ещё не завершено.')+(q?'\n\n'+q.question+'\n\nПочему нужен вопрос: '+q.reason.slice(0,1000):'\nОжидающих решения вопросов по текущему изучению нет.'),{inline_keyboard:[...(q?[[{text:'Утвердить и отправить',callback_data:'publish:'+q.id}],[{text:'Изменить и отправить',callback_data:'edit:'+q.id},{text:'Вернуть на изучение',callback_data:'return:'+q.id}]]:[]),[{text:'Обновить',callback_data:'study:'+result.requestId},{text:'Открыть в реестре',url:'https://innaodincova-finpro.github.io/studkab/reestr.html#request='+result.requestId}]]});
 const latest=result.dialog?.filter(m=>m.kind==='assistant').at(-1);
 if(latest)await say('Заключение помощника:\n'+latest.body.slice(0,3500)+'\nПолные основания сохранены в реестре.');
 const sent=await say('Ответьте на это сообщение, чтобы оставить приватный комментарий помощнику по заявке №'+result.number+' (до 1000 знаков).',{force_reply:true,input_field_placeholder:'Приватный комментарий помощнику'});
 await db.context({p_chat:chatId,p_message:sent.message_id,p_request:result.requestId,p_manifest:result.manifest,p_mode:'comment',p_proposal:null});
}
