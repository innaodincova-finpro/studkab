/* Test-only SDK adapter, served only by Vite. No production credentials or requests. */
(function(){
 window.confirm=()=>true;
 const initial=sessionStorage.getItem('qa-user')||'';
 const state=window.QA={user:initial,failRead:false,failWrite:false,writes:[],rows:JSON.parse(sessionStorage.getItem('qa-rows')||'{}'),callbacks:[]};
 const current=()=>state.user?{id:state.user,email:state.user+'@example.test'}:null;
 state.switchUser=id=>{state.user=id;sessionStorage.setItem('qa-user',id);state.callbacks.forEach(fn=>fn(id?'SIGNED_IN':'SIGNED_OUT',id?{user:current()}:null));};
 const chain={select(){return this},eq(key,val){this[key]=val;return this},maybeSingle:async function(){return state.failRead?{error:{message:'NetworkError'}}:{data:state.rows[state.user+':'+this.app]||null}}};
 window.supabase={createClient:()=>({auth:{onAuthStateChange(fn){state.callbacks.push(fn);return {data:{subscription:{unsubscribe(){}}}}},getSession:async()=>({data:{session:current()?{user:current()}:null}}),signOut:async()=>{state.switchUser('');return {}},signInWithOtp:async()=>({}),verifyOtp:async()=>({data:{user:current()}})},from:()=>Object.create(chain),rpc:async(name,args)=>{
  state.writes.push(JSON.parse(JSON.stringify(args)));
  if(state.failWrite)return {error:{message:'Test write rejected'}};
  const key=state.user+':'+args.p_app,row=state.rows[key];
  if((row?row.rev:0)!==args.p_rev)return {data:{ok:false,conflict:true,rev:row?row.rev:0}};
  const rev=(row?row.rev:0)+1;state.rows[key]={data:args.p_data,rev,updated_at:new Date().toISOString()};sessionStorage.setItem('qa-rows',JSON.stringify(state.rows));
  return {data:{ok:true,rev}};
 }})};
})();
