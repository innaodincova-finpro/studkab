const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('reestr.html','utf8');
const code=html.slice(html.indexOf('function askAI('),html.indexOf('function aiErrorText('));

test('every legacy browser AI call fails before fetch',async()=>{
 let paid=0;
 const context={Promise,Error,fetch:async()=>{paid++;return Response.json({text:'should not happen'})}};
 vm.createContext(context);vm.runInContext(code,context);
 await assert.rejects(context.askAI('deepseek','private','private'),/DIRECT_AI_DISABLED/);
 assert.equal(paid,0);
});

test('provider check reads server capabilities without a paid AI call',()=>{
 const handler=html.slice(html.indexOf('if (act === "pv-test")'),html.indexOf('if (act === "copy-prompt")'));
 assert.match(handler,/generationApi\(\{action:'capabilities'\}\)/);
 assert.doesNotMatch(handler,/askAI\(/);
});

test('all remaining legacy call sites are protected by the fail-closed function',()=>{
 assert.match(code,/return Promise\.reject\(new Error\("DIRECT_AI_DISABLED"\)\)/);
 assert.ok((html.match(/askAI\(/g)||[]).length>1);
});

test('C-051: the registry neither asks for nor keeps the proxy password',()=>{
 assert.doesNotMatch(html,/id="pxTok"|<label>Пароль посредника/);
 assert.doesNotMatch(html,/stg\.proxyToken\s*=|proxyToken\s*=\s*keepToken|next\.settings\.proxyToken\s*=/);
 assert.match(html,/delete D\.settings\.proxyToken; delete D\.settings\.proxyUrl;/);
});
