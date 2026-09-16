import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
// C-053: подписи значков на экране телефона помещаются целиком (iPhone показывает около 12 знаков).
for(const [page,manifest] of [['reestr.html','manifest-reestr.webmanifest'],['index.html','manifest-kabinet.webmanifest']]){
 test('C-053: короткое название значка '+page,async()=>{
  const html=await readFile(page,'utf8');
  const title=html.match(/<meta name="apple-mobile-web-app-title" content="([^"]*)">/)[1];
  const short=JSON.parse(await readFile(manifest,'utf8')).short_name;
  assert.ok([...title].length<=12,title);
  assert.ok([...short].length<=12,short);
  assert.equal(title,short);
 });
}
test('C-053: реестр подписан «Заявки»',async()=>{
 assert.match(await readFile('reestr.html','utf8'),/<meta name="apple-mobile-web-app-title" content="Заявки">/);
 const m=JSON.parse(await readFile('manifest-reestr.webmanifest','utf8'));
 assert.equal(m.short_name,'Заявки');assert.equal(m.name,'Заявки студентов');
});
