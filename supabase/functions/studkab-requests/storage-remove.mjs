// Удаление файла из хранилища. Если файла уже нет, хранилище отвечает кодом 400
// с пометкой «не найден» (statusCode "404") — это не сбой: цель удаления уже достигнута.
export async function removeStorageObject(fetchFn,base,key,bucket,path){
 const r=await fetchFn(base+'/storage/v1/object/'+bucket+'/'+path,{method:'DELETE',headers:{apikey:key,Authorization:'Bearer '+key},signal:AbortSignal.timeout(10000)});
 if(r.ok||r.status===404)return;
 let body=null;try{body=await r.json();}catch{}
 if(r.status===400&&body&&(String(body.statusCode)==='404'||body.error==='not_found'))return;
 throw Error('Storage cleanup unavailable');
}
