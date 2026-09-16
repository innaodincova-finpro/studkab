// Посредник серверной очереди STUDKAB. Секреты задаются только в Cloudflare
// Variables and Secrets: PROXY_TOKEN, DEEPSEEK_KEY. ALLOWED_ORIGIN сохраняет прежний смысл.
// Ключи других поставщиков (OPENAI_KEY, ANTHROPIC_KEY, YANDEX_*, GIGACHAT_AUTH)
// кодом больше не читаются; их можно удалить в Cloudflare.
// Лимиты — символы JS, не токены модели. Превышение отклоняется, текст не обрезается.
const MAX_CONTEXT = 180000;
const MAX_BODY = 1200000; // UTF-8 bytes; includes JSON escaping and Cyrillic.
// C-051: посредник обслуживает только серверную очередь STUDKAB. Разрешены один
// поставщик и одна модель, по которой сервер рассчитывает резерв бюджета.
// Прочие поставщики отклоняются до обращения к платной модели.
const ALLOWED = {
  deepseek: ['deepseek-flash'],
};
const SITE_ORIGIN = 'https://innaodincova-finpro.github.io';
const MAX_OUTPUT = 4000; // совпадает с MAX_OUTPUT_TOKENS серверного резерва
function modelAllowed(provider, model) {
  return (ALLOWED[provider] || []).includes(model);
}
// Сравнение без раннего выхода: время ответа не подсказывает пароль.
function sameSecret(given, expected) {
  if (typeof given !== 'string' || typeof expected !== 'string') return false;
  const a = new TextEncoder().encode(given), b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) diff |= (a[i] ?? 0) ^ b[i];
  return diff === 0;
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
    // C-051: запись секрета через API Cloudflare удалила текстовую переменную
    // ALLOWED_ORIGIN, и посредник перестал отвечать. Без переменной используется
    // адрес сайта приложения; открытый доступ для любых сайтов по-прежнему запрещён.
    const configuredOrigin = String(env.ALLOWED_ORIGIN || '').trim();
    const allowedOrigin = configuredOrigin && configuredOrigin !== '*' ? configuredOrigin : SITE_ORIGIN;
    const cors = {
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Proxy-Token',
      'Access-Control-Max-Age': '86400',
    };
    if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers: cors});
    if (request.method !== 'POST') return json({error: 'POST only'}, 405, cors);
    if (!env.PROXY_TOKEN) return json({error: 'NOTOKEN_SERVER'}, 500, cors);
    if (!sameSecret(request.headers.get('X-Proxy-Token'), env.PROXY_TOKEN)) return json({error: 'TOKEN'}, 401, cors);
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
    if (!modelAllowed(provider, model)) return json({error: 'UNKNOWN_MODEL:' + provider}, 400, cors);
    const configuredLimit = Number(env.MAX_TOKENS);
    const tokenLimit = Number.isFinite(configuredLimit) && configuredLimit >= 100 ? Math.min(Math.floor(configuredLimit), MAX_OUTPUT) : MAX_OUTPUT;
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
  return openaiLike('https://api.deepseek.com/chat/completions', env.DEEPSEEK_KEY, q.model, q, 'deepseek');
}
async function openaiLike(url, key, model, q, who) {
  if (!key) throw Error('NOKEY:' + who);
  const j = await post(url, {'Content-Type':'application/json', Authorization:'Bearer ' + key}, JSON.stringify({thinking:{type:'disabled'}, model, messages:[{role:'system', content:q.system},{role:'user', content:q.user}], temperature:q.temperature, max_tokens:q.max_tokens}), who, q.signal);
  const u = j.usage || {};
  const info = {model, request_id: j?.id, limit_tokens: q.max_tokens, prompt_tokens: u.prompt_tokens, completion_tokens: u.completion_tokens};
  complete(j?.choices?.[0]?.finish_reason, ['stop'], who, info);
  return result(j?.choices?.[0]?.message?.content, (u.prompt_tokens || 0) + (u.completion_tokens || 0), who, model, Object.assign({reason: j?.choices?.[0]?.finish_reason}, info));
}
