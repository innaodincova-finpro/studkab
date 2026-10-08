// CAL-IMPORT-01: synthetic accounts and fixtures, never a live student account.
const {test,expect}=require('@playwright/test');
const xlsx=require('../fixtures/calendar-xlsx.cjs');
const sample='Практическое занятие по дисциплине Предмет проверки  08.10.2026 14:20 — 15:40';
const action='Дата\tВремя\tДисциплина\tДействие\tЧто сделать\tКод работы\n2026-10-10\t09:00–10:00\tПредмет проверки\tСдача\tОтправить решение\tР01';
async function open(page){await page.locator('#fab').click();await page.locator('[data-pick="study"]').click();await expect(page.locator('#calendarText')).toBeVisible();}
async function check(page,text){await page.locator('#calendarText').fill(text);await page.locator('[data-check]').click();await expect(page.getByRole('heading',{name:'Проверьте учебный график'})).toBeVisible();}
test.beforeEach(async({page})=>{
 await page.clock.setFixedTime(new Date('2026-10-08T10:00:00'));
 await page.setViewportSize({width:390,height:844});
 await page.goto('http://127.0.0.1:4173/index.html');
 await page.evaluate(()=>QA.switchUser('calendar-import-synthetic'));
 await expect.poll(()=>page.evaluate(()=>Oblako.canSync()&&!Oblako.busy)).toBe(true);
 await page.evaluate(()=>{D.events=[{id:'own',kind:'other',title:'Личное событие',date:'2026-10-10',time:'12:00',note:'Сохранить'}];D.works=[{id:'prepared',topic:'Подготовленная работа',status:'draft',deadline:'2026-10-10'}];save();tab='cal';calMode='month';calCursor='2026-10-01';render();});
});
test('preview is read-only, back preserves input, cancel leaves the calendar unchanged',async({page})=>{
 const before=await page.evaluate(()=>JSON.stringify(D));
 await open(page);await check(page,sample);expect(await page.evaluate(()=>JSON.stringify(D))).toBe(before);
 await page.locator('[data-back]').click();await expect(page.locator('#calendarText')).toHaveValue(sample);
 await page.locator('.sheet [data-x]').click();expect(await page.evaluate(()=>JSON.stringify(D))).toBe(before);
});
test('an existing Moodle webinar lecture is skipped when the source calls it a lecture',async({page})=>{
 await page.evaluate(()=>{D.events.push({id:'vuz-lecture',kind:'cls',src:'vuz',title:'Предмет проверки — лекция (вебинар)',date:'2026-10-08',time:'14:20',note:'до 15:40 · Преподаватель · группа Т-1'});save();});
 const before=await page.evaluate(()=>JSON.stringify(D.events));
 await open(page);await check(page,'Лекция по дисциплине Предмет проверки 08.10.2026 14:20 — 15:40');
 await expect(page.locator('.sheet')).toContainText('Новых: 0 · Уже есть: 1');
 await page.locator('.sheet [data-x]').last().click();expect(await page.evaluate(()=>JSON.stringify(D.events))).toBe(before);
});
test('selected classes and actions persist, repeat creates zero copies and never changes prepared-work status',async({page})=>{
 await open(page);await check(page,sample+'\nЛабораторная работа по дисциплине Предмет проверки  08.10.2026 16:10 — 17:30');
 await page.locator('[data-add="1"]').uncheck();await page.locator('[data-commit]').click();
 expect(await page.evaluate(()=>D.events.length)).toBe(2);
 await open(page);await check(page,sample);await expect(page.locator('.sheet')).toContainText('Новых: 0 · Уже есть: 1');await page.locator('.sheet [data-x]').last().click();
 await open(page);await check(page,action);await page.locator('[data-commit]').click();
 const result=await page.evaluate(()=>({events:D.events,stored:JSON.parse(localStorage.getItem(KEY)).events,work:D.works[0]}));
 expect(result.events).toEqual(result.stored);expect(result.events).toHaveLength(3);expect(result.events[0].title).toBe('Личное событие');expect(result.work.status).toBe('draft');
 expect(result.events[2]).toMatchObject({time:'09:00',endTime:'10:00',recordType:'Сдача',planOnly:true});
});
test('compressed Excel is read in the browser; mobile and desktop preview stay within the screen',async({page})=>{
 await open(page);await page.locator('#calendarFile').setInputFiles({name:'synthetic.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:xlsx()});
 await page.locator('[data-check]').click();await expect(page.getByRole('heading',{name:'Проверьте учебный график'})).toBeVisible();
 await expect(page.locator('[data-records]')).toContainText('Предмет проверки — лекция');
 for(const width of [390,1440]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await expect(page.locator('[data-commit]')).toBeVisible();await page.screenshot({path:'test-results/calendar-import-'+width+'.png'});}
 await page.locator('[data-commit]').click();expect(await page.evaluate(()=>D.events.length)).toBe(2);
});
test('storage failure is explicit, does not mutate data or undo history, and can be retried',async({page})=>{
 await open(page);await check(page,sample);
 const before=await page.evaluate(()=>({data:JSON.stringify(D),undo:undoStack.length}));
 await page.evaluate(()=>{window.calOriginalSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k===KEY)throw new DOMException('full','QuotaExceededError');return window.calOriginalSet.call(this,k,v);};});
 await page.locator('[data-commit]').click();await expect(page.locator('[data-result]')).toContainText('Записи не добавлены');
 expect(await page.evaluate(()=>({data:JSON.stringify(D),undo:undoStack.length}))).toEqual(before);
 await page.evaluate(()=>{Storage.prototype.setItem=window.calOriginalSet;});
 await page.locator('[data-commit]').click();expect(await page.evaluate(()=>D.events.length)).toBe(2);
});
test('calendar mutation after preview refuses stale save; account change closes the dialog',async({page})=>{
 await open(page);await check(page,sample);
 await page.evaluate(()=>{D.events.push({id:'late',kind:'other',title:'Добавлено позже',date:'2026-10-11',time:'12:00'});save();});
 await page.locator('[data-commit]').click();await expect(page.locator('[data-result]')).toContainText('Календарь изменился');expect(await page.evaluate(()=>D.events.length)).toBe(2);
 await page.evaluate(()=>QA.switchUser('calendar-import-other-synthetic'));await expect(page.locator('[data-calendar-import]')).toHaveCount(0);
});
test('broken text and corrupt Excel show errors with a usable exit and no writes',async({page})=>{
 await open(page);await check(page,sample+'\nНеизвестная строка');await expect(page.locator('[data-commit]')).toBeDisabled();await expect(page.locator('.sheet')).toContainText('Строка не распознана');
 await page.locator('[data-back]').click();await page.locator('#calendarText').fill('');
 await page.locator('#calendarFile').setInputFiles({name:'broken.xlsx',mimeType:'application/octet-stream',buffer:Buffer.from('not an xlsx')});
 await page.locator('[data-check]').click();await expect(page.locator('[data-result]')).toContainText('Excel');
 await page.locator('[data-clear-file]').click();await page.locator('.sheet [data-x]').click();expect(await page.evaluate(()=>D.events.length)).toBe(1);
});
