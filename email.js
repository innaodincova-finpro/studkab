(function(global){
 'use strict';
 // Switch on only after SMTP, both OTP templates and real deliveries pass acceptance.
 const enabled=()=>global.OBLAKO_CONFIG?.emailEnabled===true;
 function mountLogin(w){
  if(!enabled())return;
  const form=document.createElement('form');
  form.innerHTML='<p class="hint">Или войдите по коду из письма — Google-аккаунт не нужен.</p><div class="fld"><label for="loginEmail">Почта</label><input id="loginEmail" type="email" autocomplete="email" required maxlength="254"></div><div class="fld" data-code-field hidden><label for="loginCode">Код из письма</label><input id="loginCode" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6"></div><div class="rowbtns"><button type="submit" class="btn">Получить код</button><button type="button" class="btn ghost" data-resend hidden>Отправить снова</button></div><p class="hint" data-email-message role="status" aria-live="polite"></p>';
  w.querySelector('.sheet-in').appendChild(form);
  const email=form.querySelector('#loginEmail'),code=form.querySelector('#loginCode'),submit=form.querySelector('[type=submit]'),resend=form.querySelector('[data-resend]'),msg=form.querySelector('[data-email-message]');
  let sentEmail='',nextSend=0,busy=false;
  email.addEventListener('input',()=>{if(busy)return;sentEmail='';code.value='';code.required=false;form.querySelector('[data-code-field]').hidden=true;resend.hidden=true;submit.textContent='Получить код';});
  async function run(send){
   if(busy||!form.reportValidity())return;
   busy=true;email.readOnly=true;submit.disabled=true;resend.disabled=true;
   const google=w.querySelector('[data-google]');google.disabled=true;
   try{
    if(send){
     if(Date.now()<nextSend)throw new Error('Повторная отправка доступна через '+Math.ceil((nextSend-Date.now())/1000)+' сек.');
     const address=email.value.trim().toLowerCase();
     await Oblako.sendCode(address);sentEmail=address;nextSend=Date.now()+60000;
     form.querySelector('[data-code-field]').hidden=false;code.required=true;resend.hidden=false;submit.textContent='Войти';
     msg.textContent='Код запрошен для '+address+'. Проверьте входящие и «Спам». Введите код из последнего письма.';code.focus();
    }else{
     await Oblako.verifyCode(sentEmail,code.value);code.value='';w.remove();
    }
   }catch(e){msg.textContent=e.message||'Не удалось выполнить вход. Повторите позже.';}
   finally{busy=false;email.readOnly=false;submit.disabled=false;resend.disabled=false;google.disabled=false;}
  }
  form.addEventListener('submit',ev=>{ev.preventDefault();run(!sentEmail);});
  resend.addEventListener('click',()=>{code.required=false;run(true).finally(()=>{code.required=!!sentEmail;});});
 }
 function profileSection(section){
  if(!enabled())return '';
  return section('Напоминания на почту','<p class="hint">Письма приходят на подтверждённую почту входа. Можно включить вместе с уведомлениями телефона. За число дней из настроек, в 10:00 по часовому поясу при подключении.</p><div class="chips"><button class="chip" data-email-action="enable">Включить письма</button><button class="chip" data-email-action="test">Проверочное письмо</button><button class="chip" data-email-action="status">Проверить состояние</button><button class="chip" data-email-action="disable">Отключить письма</button></div><p id="email-status" class="hint" role="status" aria-live="polite">Письма включаются для аккаунта и продолжают приходить после выхода. Отключить их можно здесь.</p>');
 }
 let busy=false;
 document.addEventListener('click',async ev=>{
  const button=ev.target.closest('[data-email-action]');if(!button||busy||!enabled())return;
  const el=document.getElementById('email-status');busy=true;button.disabled=true;
  try{
   const action=button.dataset.emailAction;
   const result=await Oblako.emailRequest({action,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone});
   if(action==='test')el.textContent='Проверочное письмо запланировано. Проверьте почту через 1–2 минуты, включая «Спам».';
   else el.textContent=result.enabled?'Письма включены: '+result.email+' ('+result.timezone+'). '+(result.lastError||''):'Письма отключены.';
  }catch(e){el.textContent=e.message||'Не удалось изменить настройки писем.';}
  finally{busy=false;button.disabled=false;}
 });
 global.StudEmail={mountLogin,profileSection};
})(window);
