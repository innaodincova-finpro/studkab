import { handler } from './handler.mjs';

const token = Deno.env.get('STUDKAB_TELEGRAM_BOT_TOKEN');
const base = Deno.env.get('SUPABASE_URL');
const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
async function rest(query: string, method='GET', body?: unknown) {
  const response = await fetch(`${base}/rest/v1/studkab_telegram_setup?${query}`, {
    method,
    headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json',Prefer:'return=representation'},
    body:body === undefined ? undefined : JSON.stringify(body),
    signal:AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error('Database unavailable');
  return await response.json();
}
const db = {
  async get() { return (await rest('id=eq.true&select=*'))[0]; },
  async install(hash: string) { await rest(`id=eq.true&setup_hash=eq.${hash}`, 'PATCH', {installed:true}); },
  async bind(hash: string, chatId: number, timestamp: string) {
    return (await rest(`id=eq.true&owner_hash=eq.${hash}&owner_chat_id=is.null&expires_at=gt.${encodeURIComponent(timestamp)}`, 'PATCH', {owner_chat_id:chatId,bound_at:timestamp})).length === 1;
  }
};
async function telegram(method: string, payload: unknown) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(10000)
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error('Telegram unavailable');
  return result.result;
}
Deno.serve(handler({token,db,telegram}));
