// Посредник реестра. Секреты задаются только в Cloudflare Variables and Secrets.
// Существующие имена: PROXY_TOKEN, DEEPSEEK_KEY, OPENAI_KEY, ANTHROPIC_KEY,
// YANDEX_KEY, YANDEX_FOLDER, GIGACHAT_AUTH. ALLOWED_ORIGIN сохраняет прежний смысл.
// Лимиты — символы JS, не токены модели. Превышение отклоняется, текст не обрезается.
const MAX_CONTEXT = 180000;
const MAX_BODY = 1200000; // UTF-8 bytes; includes JSON escaping and Cyrillic.
const ALLOWED = {
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
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
    try { return json(await ask(q, env), 200, cors); }
    catch (e) {
      // Не отправлять клиенту произвольные ответы поставщика, URL или секреты.
      const message = String(e?.message || '');
      const safe = /^(NOKEY|AUTH|PAY|RATE|HTTP|EMPTY|INCOMPLETE|TIMEOUT|UPSTREAM):[a-z-]+(?::[0-9]{3})?$/.test(message) ? message : 'UPSTREAM:' + provider;
      return json({error: safe}, 502, cors);
    }
  },
};
function statusError(r, who) {
  if (r.status === 401 || r.status === 403) return Error('AUTH:' + who);
  if (r.status === 402) return Error('PAY:' + who);
  if (r.status === 429) return Error('RATE:' + who);
  return Error('HTTP:' + who + ':' + r.status);
}
async function post(url, headers, body, who) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180000);
  try {
    const r = await fetch(url, {method: 'POST', headers, body, signal: controller.signal});
    if (!r.ok) throw statusError(r, who);
    return await r.json();
  } catch (e) {
    if (controller.signal.aborted) throw Error('TIMEOUT:' + who);
    throw e;
  } finally { clearTimeout(timer); }
}
function complete(reason, expected, who) {
  if (!expected.includes(reason)) throw Error('INCOMPLETE:' + who);
}
function result(text, tokens, provider, model) {
  if (typeof text !== 'string' || !text.trim()) throw Error('EMPTY:' + provider);
  return {text: text.trim(), tokens: Number(tokens) || 0, provider, model, complete: true};
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
  const j = await post(url, {'Content-Type':'application/json', Authorization:'Bearer ' + key}, JSON.stringify({model, messages:[{role:'system', content:q.system},{role:'user', content:q.user}], temperature:q.temperature, max_tokens:q.max_tokens}), who);
  complete(j?.choices?.[0]?.finish_reason, ['stop'], who);
  const u = j.usage || {};
  return result(j?.choices?.[0]?.message?.content, (u.prompt_tokens || 0) + (u.completion_tokens || 0), who, model);
}
async function anthropic(key, model, q) {
  if (!key) throw Error('NOKEY:anthropic');
  const j = await post('https://api.anthropic.com/v1/messages', {'Content-Type':'application/json','x-api-key':key,'anthropic-version':'2023-06-01'}, JSON.stringify({model, max_tokens:q.max_tokens, temperature:q.temperature, system:q.system, messages:[{role:'user',content:q.user}]}), 'anthropic');
  complete(j.stop_reason, ['end_turn', 'stop_sequence'], 'anthropic');
  const text = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
  const u = j.usage || {};
  return result(text, (u.input_tokens || 0) + (u.output_tokens || 0), 'anthropic', model);
}
async function yandex(key, folder, model, q) {
  if (!key || !folder) throw Error('NOKEY:yandex');
  const modelUri = model.startsWith('gpt://') ? model : 'gpt://' + folder + '/' + model;
  const j = await post('https://llm.api.cloud.yandex.net/foundationModels/v1/completion', {'Content-Type':'application/json',Authorization:'Api-Key ' + key,'x-folder-id':folder}, JSON.stringify({modelUri,completionOptions:{stream:false,temperature:q.temperature,maxTokens:String(q.max_tokens)},messages:[{role:'system',text:q.system},{role:'user',text:q.user}]}), 'yandex');
  complete(j?.result?.alternatives?.[0]?.status, ['ALTERNATIVE_STATUS_FINAL'], 'yandex');
  return result(j?.result?.alternatives?.[0]?.message?.text, j?.result?.usage?.totalTokens, 'yandex', modelUri);
}
let gigaToken = null, gigaExpires = 0;
async function gigachat(auth, model, q) {
  if (!auth) throw Error('NOKEY:gigachat');
  if (!gigaToken || Date.now() > gigaExpires - 60000) {
    const tj = await post('https://ngw.devices.sberbank.ru:9443/api/v2/oauth', {Authorization:'Basic ' + auth, RqUID:crypto.randomUUID(), 'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'}, 'scope=GIGACHAT_API_PERS', 'gigachat-oauth');
    if (!tj.access_token) throw Error('AUTH:gigachat-oauth');
    gigaToken = tj.access_token; gigaExpires = Number(tj.expires_at) || (Date.now() + 25 * 60 * 1000);
  }
  const j = await post('https://gigachat.devices.sberbank.ru/api/v1/chat/completions', {'Content-Type':'application/json',Authorization:'Bearer ' + gigaToken,Accept:'application/json'}, JSON.stringify({model,messages:[{role:'system',content:q.system},{role:'user',content:q.user}],temperature:q.temperature,max_tokens:q.max_tokens}), 'gigachat');
  complete(j?.choices?.[0]?.finish_reason, ['stop'], 'gigachat');
  return result(j?.choices?.[0]?.message?.content, j.usage?.total_tokens, 'gigachat', model);
}
