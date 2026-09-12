// Посредник реестра. Секреты задаются только в Cloudflare Variables and Secrets.
// Существующие имена: PROXY_TOKEN, DEEPSEEK_KEY, OPENAI_KEY, ANTHROPIC_KEY,
// YANDEX_KEY, YANDEX_FOLDER, GIGACHAT_AUTH. ALLOWED_ORIGIN сохраняет прежний смысл.
// Лимиты — символы JS, не токены модели. Превышение отклоняется, текст не обрезается.
const MAX_CONTEXT = 180000;
const MAX_BODY = 1200000; // UTF-8 bytes; includes JSON escaping and Cyrillic.
const ALLOWED = {
  deepseek: ['deepseek-chat', 'deepseek-reasoner', 'deepseek-flash', 'deepseek-v4-pro'],
  openai: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1', 'gpt-4.1-mini'],
  anthropic: ['claude-sonnet-5', 'claude-haiku-4-5-20251001', 'claude-opus-5'],
  yandex: ['yandexgpt/latest', 'yandexgpt-lite/latest', 'yandexgpt/rc'],
  gigachat: ['GigaChat', 'GigaChat-Pro', 'GigaChat-Max'],
};
function modelAllowed(provider, model) {
  const list = ALLOWED[provider] || [];
  return list.includes(model) || (provider === 'yandex' && model.startsWith('gpt://') && list.some(m => model.endsWith('/' + m)));
}
const hits = new Map();
function allow(ip, max) {
  const now = Date.now(), minute = 60000;
  const arr = (hits.get(ip) || []).filter(t => now - t < minute);
  if (arr.length >= max) { hits.set(ip, arr); return false; }
  arr.push(now); hits.set(ip, arr);
  if (hits.size > 500) for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > minute) hits.delete(k);
  return true;
}
function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), {status, headers: {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers}});
}
async function readBody(request) {
  if (Number(request.headers.get('Content-Length')) > MAX_BODY) throw Error('TOO_BIG');
  if (!request.body) return '';
  const reader = request.body.getReader(), decoder = new TextDecoder();
  let size = 0, raw = '';
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY) { await reader.cancel(); throw Error('TOO_BIG'); }
      raw += decoder.decode(value, {stream: true});
    }
    return raw + decoder.decode();
  } finally { reader.releaseLock(); }
}
// Opt-in whitespace keeps JSON compatible with response.json() in older clients.
function heartbeatReply(run, cors) {
  const encoder = new TextEncoder();
  const abort = new AbortController();
  let timer, closed = false;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('\n'));
      timer = setInterval(() => { if (!closed) controller.enqueue(encoder.encode('\n')); }, 10000);
      Promise.resolve().then(() => run(abort.signal)).then(value => {
        if (!closed) { controller.enqueue(encoder.encode(JSON.stringify(value))); controller.close(); }
      }).catch(() => {
        if (!closed) { controller.enqueue(encoder.encode('{"error":"UPSTREAM:proxy"}')); controller.close(); }
      }).finally(() => { closed = true; clearInterval(timer); });
    },
    cancel() { closed = true; clearInterval(timer); abort.abort(); }
  });
  return new Response(body, {headers: {...cors, 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'X-Proxy-Version':'heartbeat-v1'}});
}
function safeError(e, provider) {
  const message = String(e?.message || '');
  return /^(NOKEY|AUTH|PAY|RATE|HTTP|EMPTY|INCOMPLETE|TIMEOUT|UPSTREAM):[a-z-]+(?::[0-9]{3})?$/.test(message) ? message : 'UPSTREAM:' + provider;
}
// Технические подробности отказа. Только числа и короткие метки поставщика:
// ни текста запроса, ни ответа модели, ни ключей здесь быть не может.
const REASON = /^[a-zA-Z0-9_\-.]{1,40}$/;
function safeDetail(e) {
  const d = e && e.detail;
  if (!d || typeof d !== 'object') return null;
  const out = {};
  if (typeof d.reason === 'string' && REASON.test(d.reason)) out.reason = d.reason;
  if (typeof d.model === 'string' && REASON.test(d.model)) out.model = d.model;
  if (typeof d.request_id === 'string' && REASON.test(d.request_id)) out.request_id = d.request_id;
  for (const k of ['prompt_tokens', 'completion_tokens', 'limit_tokens']) {
    if (Number.isFinite(d[k])) out[k] = Math.round(d[k]);
  }
  return Object.keys(out).length ? out : null;
}
function errorBody(e, provider) {
  const body = {error: safeError(e, provider)};
  const detail = safeDetail(e);
  if (detail) body.detail = detail;
  return body;
}
export default {
  async fetch(request, env) {
    const cors = {
      'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Proxy-Token',
      'Access-Control-Max-Age': '86400',
    };
    if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers: cors});
    if (request.method !== 'POST') return json({error: 'POST only'}, 405, cors);
    if (!env.PROXY_TOKEN) return json({error: 'NOTOKEN_SERVER'}, 500, cors);
    if (request.headers.get('X-Proxy-Token') !== env.PROXY_TOKEN) return json({error: 'TOKEN'}, 401, cors);
    const ip = request.headers.get('CF-Connecting-IP') || '?';
    if (!allow(ip, Number(env.RATE_MAX) || 20)) return json({error: 'RATE:proxy'}, 429, cors);
    let raw, body;
    try { raw = await readBody(request); }
    catch (e) { return json({error: e.message === 'TOO_BIG' ? 'TOO_BIG' : 'BAD_REQUEST'}, 413, cors); }
    try { body = JSON.parse(raw); } catch { return json({error: 'BAD_JSON'}, 400, cors); }
    if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.system !== 'string' || typeof body.user !== 'string') return json({error: 'BAD_REQUEST'}, 400, cors);
    if (body.system.length + body.user.length > MAX_CONTEXT) return json({error: 'CONTEXT_TOO_BIG', max_characters: MAX_CONTEXT}, 413, cors);
    const provider = String(body.provider || 'deepseek');
    if (!Object.hasOwn(ALLOWED, provider)) return json({error: 'UNKNOWN_PROVIDER:' + provider}, 400, cors);
    const model = String(body.model || '').trim();
    if (model && !modelAllowed(provider, model)) return json({error: 'UNKNOWN_MODEL:' + provider}, 400, cors);
    const configuredLimit = Number(env.MAX_TOKENS);
    const tokenLimit = Number.isFinite(configuredLimit) && configuredLimit >= 100 ? Math.min(Math.floor(configuredLimit), 8000) : 8000;
    const requestedTokens = Number(body.max_tokens);
    const q = {
      provider, model, system: body.system, user: body.user,
      max_tokens: Number.isFinite(requestedTokens) && requestedTokens > 0 ? Math.min(Math.max(Math.floor(requestedTokens), 100), tokenLimit) : tokenLimit,
      temperature: typeof body.temperature === 'number' && Number.isFinite(body.temperature) ? Math.min(Math.max(body.temperature, 0), 1.5) : 0.7,
    };
    const clientId = typeof body.client_request_id === 'string' && /^[a-f0-9-]{36}$/i.test(body.client_request_id) ? body.client_request_id : null;
    const correlated = value => clientId ? {...value, client_request_id: clientId} : value;
    if (body.keepalive === true) return heartbeatReply(async signal => {
      q.signal = signal;
      try { return correlated(await ask(q, env)); }
      catch (e) { return correlated(errorBody(e, provider)); }
    }, cors);
    try { return json(correlated(await ask(q, env)), 200, cors); }
    catch (e) {
      // Не отправлять клиенту произвольные ответы поставщика, URL или секреты.
      return json(correlated(errorBody(e, provider)), 502, cors);
    }
  },
};
function statusError(r, who) {
  if (r.status === 401 || r.status === 403) return Error('AUTH:' + who);
  if (r.status === 402) return Error('PAY:' + who);
  if (r.status === 429) return Error('RATE:' + who);
  return Error('HTTP:' + who + ':' + r.status);
}
async function post(url, headers, body, who, signal) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (signal?.aborted) cancel();
  signal?.addEventListener('abort', cancel, {once:true});
  const timer = setTimeout(cancel, 180000);
  try {
    const r = await fetch(url, {method: 'POST', headers, body, signal: controller.signal});
    if (!r.ok) throw statusError(r, who);
    return await r.json();
  } catch (e) {
    if (controller.signal.aborted) throw Error('TIMEOUT:' + who);
    throw e;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
}
function complete(reason, expected, who, detail) {
  if (expected.includes(reason)) return;
  const e = Error('INCOMPLETE:' + who);
  // Ради этого всё и делается: «length» означает упёрлись в предел ответа,
  // «insufficient_system_resource» — поставщик не смог, и это разные беды.
  e.detail = Object.assign({reason: typeof reason === 'string' ? reason : 'unknown'}, detail || {});
  throw e;
}
function result(text, tokens, provider, model, detail) {
  if (typeof text !== 'string' || !text.trim()) {
    const e = Error('EMPTY:' + provider);
    if (detail) e.detail = detail;
    throw e;
  }
  const out = {text: text.trim(), tokens: Number(tokens) || 0, provider, model, complete: true};
  // Подробности удачного ответа тоже нужны: по ним видно, насколько близко
  // подошли к пределу, и что менять до того, как оборвётся.
  const safe = safeDetail({detail});
  if (safe) out.detail = safe;
  return out;
}
async function ask(q, env) {
  switch (q.provider) {
    case 'deepseek': return openaiLike('https://api.deepseek.com/chat/completions', env.DEEPSEEK_KEY, q.model || 'deepseek-chat', q, 'deepseek');
    case 'openai': return openaiLike('https://api.openai.com/v1/chat/completions', env.OPENAI_KEY, q.model || 'gpt-4o-mini', q, 'openai');
    case 'anthropic': return anthropic(env.ANTHROPIC_KEY, q.model || 'claude-sonnet-5', q);
    case 'yandex': return yandex(env.YANDEX_KEY, env.YANDEX_FOLDER, q.model || 'yandexgpt/latest', q);
    case 'gigachat': return gigachat(env.GIGACHAT_AUTH, q.model || 'GigaChat', q);
  }
}
async function openaiLike(url, key, model, q, who) {
  if (!key) throw Error('NOKEY:' + who);
  const j = await post(url, {'Content-Type':'application/json', Authorization:'Bearer ' + key}, JSON.stringify({...(who === 'deepseek' && model === 'deepseek-flash' ? {thinking:{type:'disabled'}} : {}), model, messages:[{role:'system', content:q.system},{role:'user', content:q.user}], temperature:q.temperature, max_tokens:q.max_tokens}), who, q.signal);
  const u = j.usage || {};
  const info = {model, request_id: j?.id, limit_tokens: q.max_tokens, prompt_tokens: u.prompt_tokens, completion_tokens: u.completion_tokens};
  complete(j?.choices?.[0]?.finish_reason, ['stop'], who, info);
  return result(j?.choices?.[0]?.message?.content, (u.prompt_tokens || 0) + (u.completion_tokens || 0), who, model, Object.assign({reason: j?.choices?.[0]?.finish_reason}, info));
}
async function anthropic(key, model, q) {
  if (!key) throw Error('NOKEY:anthropic');
  const j = await post('https://api.anthropic.com/v1/messages', {'Content-Type':'application/json','x-api-key':key,'anthropic-version':'2023-06-01'}, JSON.stringify({model, max_tokens:q.max_tokens, temperature:q.temperature, system:q.system, messages:[{role:'user',content:q.user}]}), 'anthropic', q.signal);
  const u = j.usage || {};
  const info = {model, request_id: j?.id, limit_tokens: q.max_tokens, prompt_tokens: u.input_tokens, completion_tokens: u.output_tokens};
  complete(j.stop_reason, ['end_turn', 'stop_sequence'], 'anthropic', info);
  const text = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
  return result(text, (u.input_tokens || 0) + (u.output_tokens || 0), 'anthropic', model, Object.assign({reason: j.stop_reason}, info));
}
async function yandex(key, folder, model, q) {
  if (!key || !folder) throw Error('NOKEY:yandex');
  const modelUri = model.startsWith('gpt://') ? model : 'gpt://' + folder + '/' + model;
  const j = await post('https://llm.api.cloud.yandex.net/foundationModels/v1/completion', {'Content-Type':'application/json',Authorization:'Api-Key ' + key,'x-folder-id':folder}, JSON.stringify({modelUri,completionOptions:{stream:false,temperature:q.temperature,maxTokens:String(q.max_tokens)},messages:[{role:'system',text:q.system},{role:'user',text:q.user}]}), 'yandex', q.signal);
  const yu = j?.result?.usage || {};
  const yinfo = {limit_tokens: q.max_tokens, prompt_tokens: Number(yu.inputTextTokens), completion_tokens: Number(yu.completionTokens)};
  complete(j?.result?.alternatives?.[0]?.status, ['ALTERNATIVE_STATUS_FINAL'], 'yandex', yinfo);
  return result(j?.result?.alternatives?.[0]?.message?.text, yu.totalTokens, 'yandex', modelUri, Object.assign({reason: j?.result?.alternatives?.[0]?.status}, yinfo));
}
let gigaToken = null, gigaExpires = 0;
async function gigachat(auth, model, q) {
  if (!auth) throw Error('NOKEY:gigachat');
  if (!gigaToken || Date.now() > gigaExpires - 60000) {
    const tj = await post('https://ngw.devices.sberbank.ru:9443/api/v2/oauth', {Authorization:'Basic ' + auth, RqUID:crypto.randomUUID(), 'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'}, 'scope=GIGACHAT_API_PERS', 'gigachat-oauth', q.signal);
    if (!tj.access_token) throw Error('AUTH:gigachat-oauth');
    gigaToken = tj.access_token; gigaExpires = Number(tj.expires_at) || (Date.now() + 25 * 60 * 1000);
  }
  const j = await post('https://gigachat.devices.sberbank.ru/api/v1/chat/completions', {'Content-Type':'application/json',Authorization:'Bearer ' + gigaToken,Accept:'application/json'}, JSON.stringify({model,messages:[{role:'system',content:q.system},{role:'user',content:q.user}],temperature:q.temperature,max_tokens:q.max_tokens}), 'gigachat', q.signal);
  const gu = j.usage || {};
  const ginfo = {model, limit_tokens: q.max_tokens, prompt_tokens: gu.prompt_tokens, completion_tokens: gu.completion_tokens};
  complete(j?.choices?.[0]?.finish_reason, ['stop'], 'gigachat', ginfo);
  return result(j?.choices?.[0]?.message?.content, gu.total_tokens, 'gigachat', model, Object.assign({reason: j?.choices?.[0]?.finish_reason}, ginfo));
}
