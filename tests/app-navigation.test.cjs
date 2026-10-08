const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function fixture(){
 let route={tab:'list',open:null},owner='account-a',page={scrollTop:0},renders=0,listeners={},entries=[{state:null}],at=0;
 const w={scrollY:0,addEventListener:(k,f)=>listeners[k]=f,scrollTo:(x,y)=>w.scrollY=y};
 const history={get state(){return entries[at].state;},replaceState(s){entries[at]={state:s};},pushState(s){entries.splice(at+1);entries.push({state:s});at++;},back(){if(at){at--;listeners.popstate({state:entries[at].state});}},forward(){if(at+1<entries.length){at++;listeners.popstate({state:entries[at].state});}}};
 vm.runInNewContext(fs.readFileSync('app-navigation.js','utf8'),{window:w,history,document:{getElementById:()=>page},Math,Date});
 const nav=w.StudNavigation.create({app:'test',owner:()=>owner,read:()=>route,write:r=>route=r,render:()=>{nav.sync();page.scrollTop=0;w.scrollY=0;renders++;}});
 nav.sync();return {nav,history,page,w,route:()=>route,renders:()=>renders,setOwner:v=>owner=v,go(r){route=r;nav.sync();page.scrollTop=0;w.scrollY=0;},size:()=>entries.length};
}
test('Back and Forward restore the route and both scroll positions',()=>{
 const f=fixture();f.page.scrollTop=120;f.w.scrollY=250;f.go({tab:'list',open:'request-1'});f.page.scrollTop=90;
 f.nav.back(()=>assert.fail('unexpected fallback'));assert.deepEqual(f.route(),{tab:'list',open:null});assert.equal(f.page.scrollTop,120);assert.equal(f.w.scrollY,250);
 f.history.forward();assert.equal(f.route().open,'request-1');assert.equal(f.page.scrollTop,90);
});
test('refresh and typing a filter do not create navigation entries',()=>{
 const f=fixture();f.go({tab:'list',open:null,query:'a'});f.go({tab:'list',open:null,query:'ab'});assert.equal(f.size(),1);
 f.go({tab:'list',open:'request-1'});f.history.back();assert.equal(f.route().query,'ab');
});
test('old account history never reopens private request',()=>{
 const f=fixture();f.go({tab:'list',open:'private-a'});f.go({tab:'more',open:null});f.setOwner('account-b');f.go({tab:'list',open:null});
 f.history.back();assert.deepEqual(f.route(),{tab:'list',open:null});assert.equal(f.renders(),0);
 let fallback=0;f.nav.back(()=>fallback++);assert.equal(fallback,1);
});
