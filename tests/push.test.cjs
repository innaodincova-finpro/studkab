const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const modulePromise=import('data:text/javascript;base64,'+fs.readFileSync('supabase/functions/studkab-push/schedule.js').toString('base64'));
const data={settings:{warnDays:3},works:[{id:'a',deadline:'2026-09-20',status:'draft'}]};
test('deadline three days before at 10 local, not UTC',async()=>{const {dueEvents}=await modulePromise;assert.equal(dueEvents(data,'Europe/Moscow',Date.parse('2026-09-17T06:59Z')).length,0);assert.equal(dueEvents(data,'Europe/Moscow',Date.parse('2026-09-17T07:00Z')).length,1);assert.equal(dueEvents(data,'America/New_York',Date.parse('2026-09-17T07:00Z')).length,0);});
test('no completed, deleted or moved deadline; no overdue catch-up',async()=>{const {dueEvents:f}=await modulePromise;const now=Date.parse('2026-09-17T07:00Z');for(const works of [[],[{...data.works[0],status:'accepted'}],[{...data.works[0],status:'graded'}],[{...data.works[0],deadline:'2026-09-21'}]])assert.equal(f({...data,works},'Europe/Moscow',now).length,0);assert.equal(f(data,'Europe/Moscow',Date.parse('2026-09-17T09:00Z')).length,0);});
test('month boundaries and configurable warning',async()=>{const {dueEvents:f}=await modulePromise;assert.equal(f({settings:{warnDays:3},works:[{id:'b',deadline:'2027-01-02'}]},'UTC',Date.parse('2026-12-30T10:00Z')).length,1);assert.equal(f({...data,settings:{warnDays:2}},'UTC',Date.parse('2026-09-18T10:00Z')).length,1);});
test('delivery key stable for retries; endpoint SSRF blocked',async()=>{const {dueEvents:f,validSubscription:v}=await modulePromise;assert.equal(f(data,'UTC',Date.parse('2026-09-17T10:00Z'))[0].key,f(data,'UTC',Date.parse('2026-09-17T10:01Z'))[0].key);const keys={p256dh:'a'.repeat(87),auth:'b'.repeat(22)};for(const endpoint of ['https://127.0.0.1/a','https://fcm.googleapis.com.attacker.test/a','http://fcm.googleapis.com/a','https://user:pass@fcm.googleapis.com/a'])assert.equal(v({endpoint,keys}),false);assert.equal(v({endpoint:'https://fcm.googleapis.com/send/abc',keys}),true);});
test('class reminder 30 minutes before start in device time; once window; not after start; only pairs',async()=>{const {dueEvents:f}=await modulePromise;
 const d={events:[{id:'p1',kind:'cls',title:'История России — практическое занятие',date:'2026-10-10',time:'09:00',src:'vuz'},{id:'m1',kind:'meet',title:'Встреча',date:'2026-10-10',time:'09:00'}]};
 const at=t=>f(d,'Europe/Moscow',Date.parse(t));
 assert.equal(at('2026-10-10T05:29Z').length,0); // 08:29 МСК — рано
 const r=at('2026-10-10T05:30Z');assert.equal(r.length,1);assert.equal(r[0].key,'class:p1:2026-10-10:09:00');
 assert.equal(r[0].body,'Через 30 мин, в 09:00: История России — практическое занятие.');
 assert.equal(at('2026-10-10T05:50Z')[0].key,'class:p1:2026-10-10:09:00'); // задержка — тот же ключ, одна доставка
 assert.equal(at('2026-10-10T06:00Z').length,0); // пара началась
 assert.equal(f(d,'Asia/Novosibirsk',Date.parse('2026-10-10T05:30Z')).length,0); // другой часовой пояс устройства
 assert.equal(f({events:[{id:'x',kind:'cls',date:'2026-10-10'}]},'Europe/Moscow',Date.parse('2026-10-10T05:30Z')).length,0); // без времени
});
