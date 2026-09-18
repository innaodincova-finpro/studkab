(function(root,factory){
 if(typeof module==='object'&&module.exports)module.exports=factory();
 else root.RequestWorkflow=factory();
})(typeof self!=='undefined'?self:this,function(){
 'use strict';
 var steps=[
  {key:'intake',label:'Заявка и материалы'},
  {key:'passport',label:'Паспорт требований'},
  {key:'preparation',label:'Подготовка документа'},
  {key:'quality',label:'Проверка качества'},
  {key:'delivery',label:'Word и передача'}
 ];
 function result(step,key,title,copy,action,label,blocker,complete){
  return {step:step,key:key,title:title,copy:copy,action:action,label:label,blocker:blocker||'',complete:!!complete,steps:steps};
 }
 function derive(f){
  f=f||{};
  if(f.cancelled)return result(0,'cancelled','Заявка отменена','Работа по заявке прекращена.','','','Возобновите заявку только после подтверждения причины.');
  if(f.delivered)return result(5,'delivered','Результат передан','Студенту доступна проверенная версия Word.','','','',true);
  if(!f.hasPassport)return result(1,'intake','Проверьте комплект заявки','Проверьте тему, срок, требования и приложенные материалы.','passport-load','Проверить комплект');
  if(f.passportUnresolved)return result(2,'passport','Нужно уточнить требования','В паспорте остались обязательные сведения без точного ответа.','passport-edit','Уточнить требования',f.passportBlocker||'Заполните обязательные требования.');
  if(!f.passportApproved)return result(2,'passport','Паспорт готов к утверждению','Проверьте зафиксированные требования перед подготовкой документа.','passport-approve','Утвердить паспорт');
  if(!f.hasDocument)return result(3,'preparation',f.hasServerJob?'Подготовка сохранена':'Требования утверждены',f.hasServerJob?'Откройте документ: сохранённая серверная подготовка продолжится с текущего состояния.':'Проверьте стоимость и начните подготовку документа.','doc-open',f.hasServerJob?'Продолжить подготовку':'Начать подготовку');
  if(!f.automaticReviewCurrent)return result(4,'quality','Документ требует проверки','Текст сохранён. Проверьте комплектность, структуру, источники, расчёты и замечания.','doc-open','Проверить готовность документа');
  return result(5,'delivery','Нужна итоговая проверка Word','Автоматические замечания просмотрены. Проверьте точный Word и каждый критерий перед передачей.','deliver-result','Провести итоговую проверку');
 }
 return {steps:steps,derive:derive};
});
