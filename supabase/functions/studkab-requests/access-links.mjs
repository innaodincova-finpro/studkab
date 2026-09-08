// Called only after the handler checks the executor account.
export async function accessLink({base,key,email,recovery=false,request=fetch}){
 const headers={apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'};
 let found=null;
 for(let page=1;page<=100;page++){
  const r=await request(base+'/auth/v1/admin/users?per_page=200&page='+page,{headers,signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw Error('Auth unavailable');
  const users=(await r.json()).users;if(!Array.isArray(users))throw Error('Invalid auth response');
  found=users.find(u=>String(u.email||'').toLowerCase()===email);
  if(found||users.length<200)break;
  if(page===100)throw Error('Account search limit');
 }
 if(recovery&&!found)return {missing:true};
 if(!recovery&&found&&(found.email_confirmed_at||found.last_sign_in_at))return {existing:true};
 const type=recovery?'recovery':'invite';
 const r=await request(base+'/auth/v1/admin/generate_link',{method:'POST',headers,body:JSON.stringify({type,email}),signal:AbortSignal.timeout(10000)});
 if(!r.ok)throw Error('Access link unavailable');
 const link=await r.json();if(!link.hashed_token||link.verification_type!==type)throw Error('Invalid access link');
 return {url:'https://innaodincova-finpro.github.io/studkab/activate.html#token='+encodeURIComponent(link.hashed_token)+'&email='+encodeURIComponent(email)+(recovery?'&type=recovery':'')};
}
