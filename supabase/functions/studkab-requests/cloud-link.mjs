// ROUTE-03, R3-B: ссылка на папку в облаке.
// Проверяем, что ссылка открывается без входа, и для Яндекс Диска копируем файлы папки в заявку
// по одному (каждый файл проходит те же проверки, что и загрузка из кабинета).
// Запросы идут только на перечисленные облака; адрес скачивания берём из ответа Яндекс Диска
// и принимаем только на доменах Яндекса.
export const CLOUD_LINK=/^https:\/\/(disk\.yandex\.(ru|com|by|kz)|yadi\.sk|disk\.360\.yandex\.ru|drive\.google\.com|docs\.google\.com|cloud\.mail\.ru)\/[^\s<>"]+$/;
const YANDEX=/^https:\/\/(disk\.yandex\.(ru|com|by|kz)|yadi\.sk|disk\.360\.yandex\.ru)\//;
const API='https://cloud-api.yandex.net/v1/disk/public/resources';
const MAX=5242880,LIST=100;
export function cloudService(link){
 if(typeof link!=='string'||link.length>500||!CLOUD_LINK.test(link))return null;
 if(YANDEX.test(link))return 'yandex';
 if(/^https:\/\/(drive|docs)\.google\.com\//.test(link))return 'google';
 return 'mailru';
}
function timeout(ms){return AbortSignal.timeout(ms);}
async function yandexMeta(link,fetcher){
 const r=await fetcher(API+'?public_key='+encodeURIComponent(link)+'&limit='+LIST+'&preview_size=S',{headers:{Accept:'application/json'},redirect:'error',signal:timeout(10000)});
 if(r.status===404)return {state:'missing'};
 if(r.status===403||r.status===401)return {state:'closed'};
 if(!r.ok)return {state:'unknown'};
 return {state:'open',meta:await r.json()};
}
// Файлы папки (верхний уровень) или один файл по ссылке на файл.
export function yandexFiles(meta){
 if(meta?.type==='file')return [{name:String(meta.name||''),path:'',size:Number(meta.size)||0,mime:String(meta.mime_type||'')}];
 const items=meta?._embedded?.items||[];
 return items.filter(i=>i&&i.type==='file').map(i=>({name:String(i.name||''),path:String(i.path||'/'+i.name),size:Number(i.size)||0,mime:String(i.mime_type||'')}));
}
export async function checkCloudLink(link,{fetcher=fetch}={}){
 const service=cloudService(link);
 if(!service)return {state:'invalid'};
 try{
  if(service==='yandex'){
   const m=await yandexMeta(link,fetcher);
   if(m.state!=='open')return {state:m.state,service};
   const files=yandexFiles(m.meta),folders=(m.meta?._embedded?.items||[]).filter(i=>i&&i.type==='dir').length;
   return {state:'open',service,files:files.map(f=>({name:f.name,path:f.path,size:f.size})),folders,more:(m.meta?._embedded?.total||0)>LIST};
  }
  // Google Диск и Облако Mail.ru: только проверка, что страница открывается без входа.
  const r=await fetcher(link,{method:'GET',redirect:'manual',signal:timeout(10000)});
  if(r.status===404)return {state:'missing',service};
  if(r.status>=300&&r.status<400){const to=r.headers.get('location')||'';return {state:/accounts\.google\.com|login|auth/i.test(to)?'closed':'unknown',service};}
  if(r.status===401||r.status===403)return {state:'closed',service};
  return {state:r.ok?'open':'unknown',service};
 }catch{return {state:'unknown',service};}
}
// Скачивает один файл папки Яндекс Диска. Возвращает {name,bytes} или бросает понятную ошибку.
export async function downloadYandexFile(link,path,{fetcher=fetch}={}){
 if(cloudService(link)!=='yandex')throw Error('Копия делается только для Яндекс Диска');
 if(typeof path!=='string'||path.length>500)throw Error('Неверный файл папки');
 const m=await yandexMeta(link,fetcher);
 if(m.state!=='open')throw Error(m.state==='closed'?'Ссылка закрыта':m.state==='missing'?'Папка не найдена':'Облако не ответило, повторите позже');
 const file=yandexFiles(m.meta).find(f=>f.path===path);
 if(!file)throw Error('Файл в папке не найден');
 if(!file.size||file.size>MAX)throw Error(file.name+': файл больше 5 МБ — исполнитель скачает его по ссылке');
 const r=await fetcher(API+'/download?public_key='+encodeURIComponent(link)+(path?'&path='+encodeURIComponent(path):''),{headers:{Accept:'application/json'},redirect:'error',signal:timeout(10000)});
 if(!r.ok)throw Error('Облако не выдало файл, повторите позже');
 const href=String((await r.json()).href||'');
 let url;try{url=new URL(href);}catch{throw Error('Облако не выдало файл, повторите позже');}
 const allowed=h=>/(^|\.)yandex\.(net|ru|com)$/.test(h);
 if(url.protocol!=='https:'||!allowed(url.hostname))throw Error('Облако выдало неподходящий адрес файла');
 const d=await fetcher(url.href,{redirect:'follow',signal:timeout(30000)});
 if(!d.ok||!allowed(new URL(d.url||url.href).hostname))throw Error('Файл не скачался, повторите позже');
 const declared=Number(d.headers.get('content-length')||0);if(declared>MAX)throw Error(file.name+': файл больше 5 МБ');
 const reader=d.body.getReader(),parts=[];let size=0;
 for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX){await reader.cancel();throw Error(file.name+': файл больше 5 МБ');}parts.push(value);}
 const bytes=new Uint8Array(size);let at=0;for(const p of parts){bytes.set(p,at);at+=p.length;}
 return {name:file.name,bytes};
}
