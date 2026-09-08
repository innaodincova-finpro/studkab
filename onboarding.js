/* Shared first-entry controls. Invitations stay only in the open dialog. */
(function(global){
 'use strict';
 function passwordField(id,label,autocomplete){
  return '<div class="fld"><label for="'+id+'">'+label+'</label><div style="display:flex;gap:8px;align-items:center"><input style="min-width:0;flex:1;width:100%" id="'+id+'" type="password" autocomplete="'+autocomplete+'" '+(autocomplete==='new-password'?'minlength="8" ':'')+'required><button type="button" class="chip" style="width:auto;margin:0;min-height:44px;flex-shrink:0" data-password-toggle="'+id+'" aria-controls="'+id+'" aria-label="Показать пароль: '+label+'" aria-pressed="false">Показать</button></div></div>';
 }
 document.addEventListener('click',function(e){
  var b=e.target.closest('[data-password-toggle]');if(!b)return;
  var field=document.getElementById(b.dataset.passwordToggle);if(!field)return;
  var show=field.type==='password';field.type=show?'text':'password';
  b.textContent=show?'Скрыть':'Показать';b.setAttribute('aria-pressed',String(show));
  var label=document.querySelector('label[for="'+field.id+'"]');
  b.setAttribute('aria-label',(show?'Скрыть':'Показать')+' пароль: '+(label?label.textContent:''));
 });
 function passwordError(first,repeat){
  if(first.length<8)return 'Пароль должен содержать не менее 8 символов.';
  if(first!==repeat)return 'Пароли не совпадают. Проверьте ввод.';
  return '';
 }
 function invitationMessage(email,url,kind){
  var home='https://innaodincova-finpro.github.io/studkab/';
  var intro=kind==='recovery'?'Восстановление доступа к «Кабинету студента».':'Здравствуйте! Приглашаю вас в «Кабинет студента» — здесь можно вести учебные работы и отправлять мне заявки на подготовку черновика.';
  var start=kind==='existing'?
   '1. Войдите в кабинет\n'+home+'\nОткройте «Профиль» → «Хранение записей». Войдите через Google с этой почтой или по почте и паролю приложения. Если вы пользуетесь «Точкой дня» с этой почтой, пароль тот же. Новый аккаунт создавать не нужно. Если не получается войти — напишите мне.':
   '1. '+(kind==='recovery'?'Восстановите доступ':'Откройте личную ссылку')+'\n'+url+'\n'+(kind==='recovery'?'Задайте новый':'Придумайте')+' пароль приложения — не менее 8 символов. Кнопка «Показать» позволяет проверить ввод. Повторите пароль и нажмите «Сохранить пароль и открыть приложение». Пароль от почтового ящика вводить не нужно; сообщать мне пароль тоже не нужно.\n'+(kind==='recovery'?'Если с этой почтой вы пользуетесь «Точкой дня», её пароль также изменится.\n':'')+'Если ссылка истекла или не открывается, напишите мне.';
  return intro+'\n\nВаша почта для входа: '+email+'\n\n'+start+
   '\n\n2. Добавьте ярлык, если вам удобно\nНа iPhone откройте в Safari обычный адрес кабинета:\n'+home+'\nНажмите «Поделиться» → «На экран Домой» → «Добавить». Для ярлыка используйте этот адрес, а не личную ссылку первого входа. Если после открытия ярлыка потребуется вход, используйте указанную выше почту и пароль приложения. На компьютере можно работать по тому же адресу в браузере.'+
   '\n\n3. Начните работу\nВ «Профиле» заполните «Данные студента». В разделе «Работы» нажмите «Новая работа», укажите тему и срок. Для заказа черновика откройте работу → «Отправить заявку», заполните условия и контакт → «Отправить заявку исполнителю». Дождитесь подтверждения с номером заявки. Пересылать заявку через бота не требуется.'+
   '\n\n4. Проверьте сохранение\nИзменения сохраняются автоматически. После важных правок откройте «Профиль» → «Хранение записей» и дождитесь подтверждения «Изменения сохранены в облаке». Если указана ошибка, следуйте подсказке на экране. Записи без входа доступны только на том устройстве, где вы их создали.'+
   '\n\nСохраните это сообщение. '+(kind==='existing'?'':'Личная ссылка предназначена только вам — не пересылайте её другим. ')+'Если нужна помощь, напишите мне, на каком шаге возник вопрос. Не присылайте пароль или снимок личной ссылки.\n\nИнна';
 }
 global.Onboarding={passwordField:passwordField,passwordError:passwordError,invitationMessage:invitationMessage};
})(window);
