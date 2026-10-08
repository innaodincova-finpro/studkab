/* UX-R06: one history for browser and application Back, scoped to this account. */
(function(global){
 'use strict';
 global.StudNavigation={create:function(options){
  var owner=null,current=null,depth=0,token=null,restoring=false;
  function position(){var p=document.getElementById('page');return {page:p?p.scrollTop:0,window:global.scrollY||0};}
  function entry(route,scroll){return {app:options.app,owner:owner,token:token,depth:depth,route:route,scroll:scroll};}
  function state(value){return Object.assign({},history.state||{},{studkabNavigation:value});}
  function same(a,b){return a&&b&&a.tab===b.tab&&a.open===b.open&&a.ref===b.ref;}
  function sync(){
   var nextOwner=options.owner(),route=options.read();
   if(owner!==nextOwner){
    owner=nextOwner;token=String(Date.now())+Math.random();depth=0;current=route;
    history.replaceState(state(entry(route,{page:0,window:0})), '');return;
   }
   if(restoring){current=route;return;}
   if(!same(current,route)){
    history.replaceState(state(entry(current,position())), '');
    depth++;current=route;history.pushState(state(entry(route,{page:0,window:0})), '');
   }else current=route;
  }
  function rememberPosition(){
   var h=history.state&&history.state.studkabNavigation;
   if(!restoring&&h&&h.app===options.app&&h.token===token&&h.owner===options.owner())history.replaceState(state(entry(current,position())), '');
  }
  global.addEventListener('scroll',rememberPosition,true);
  function back(fallback){if(depth>0){rememberPosition();history.back();}else fallback();}
  global.addEventListener('popstate',function(event){
   var h=event.state&&event.state.studkabNavigation;
   if(!h||h.app!==options.app)return;
   if(h.owner!==options.owner()||h.token!==token){
    depth=0;history.replaceState(state(entry(options.read(),position())), '');return;
   }
   depth=h.depth;restoring=true;
   try{options.write(h.route);options.render();current=options.read();var p=document.getElementById('page');if(p)p.scrollTop=h.scroll.page||0;global.scrollTo(0,h.scroll.window||0);}
   finally{restoring=false;}
  });
  return {sync:sync,back:back};
 }};
})(window);
