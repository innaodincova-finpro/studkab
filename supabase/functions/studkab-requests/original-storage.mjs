// INTAKE-01: storage only; do not extract or discard unreadable originals here.
export async function saveOriginal({base,key,path,type,bytes,hash,fetcher=fetch}){
 const url=base+'/storage/v1/object/studkab-intake-materials/'+path;
 const headers={apikey:key,Authorization:'Bearer '+key};
 let uploaded;
 try{uploaded=await fetcher(url,{method:'POST',headers:{...headers,'Content-Type':type,'x-upsert':'false'},body:bytes,signal:AbortSignal.timeout(30000)});}catch{}
 if(uploaded?.ok)return;
 // This path is permanently reserved for this hash. Never overwrite it.
 // Verify existing bytes after a collision or a lost successful response.
 let existing;try{existing=await fetcher(url,{headers,signal:AbortSignal.timeout(10000)});}catch{throw Error('Storage unavailable');}
 if(!existing.ok)throw Error('Storage unavailable');
 const advertised=Number(existing.headers.get('content-length'));
 if(advertised&&advertised!==bytes.length)throw Error('Storage mismatch');
 const saved=new Uint8Array(await existing.arrayBuffer());
 if(saved.length!==bytes.length||saved.length>5242880)throw Error('Storage mismatch');
 const actual=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',saved))).map(x=>x.toString(16).padStart(2,'0')).join('');
 if(actual!==hash)throw Error('Storage mismatch');
}
