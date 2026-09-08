export const BOT = 'Studkab_Requests_bot';
export const WEBHOOK = 'https://dcpthwmuiodrjepifzsd.supabase.co/functions/v1/studkab-telegram/webhook';
const enc = new TextEncoder();
const hex = bytes => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
export async function digest(value) {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(value)));
}
export async function webhookSecret(token) {
  const key = await crypto.subtle.importKey('raw', enc.encode(token), {name:'HMAC', hash:'SHA-256'}, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode('studkab-telegram-webhook-v1')));
}
function equal(a, b) {
  if (typeof a !== 'string' || a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}
const json = (data, status=200) => new Response(JSON.stringify(data), {status, headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
export function handler({token, db, telegram, now=()=>Date.now()}) {
  return async req => {
    try {
      if (req.method !== 'POST') return json({error:'Method not allowed'},405);
      const path = new URL(req.url).pathname;
      if (!token) return json({error:'Bot secret missing'},503);
      if (path.endsWith('/setup')) {
        const code = (req.headers.get('authorization') || '').replace(/^Bearer /,'');
        if (!/^[a-f0-9]{64}$/.test(code)) return json({error:'Unauthorized'},401);
        const row = await db.get();
        if (!row || row.installed || Date.parse(row.expires_at) <= now() || !equal(await digest(code), row.setup_hash)) return json({error:'Unauthorized'},401);
        const me = await telegram('getMe',{});
        if (me.username !== BOT) return json({error:'Unexpected bot identity'},409);
        const previous = await telegram('getWebhookInfo',{});
        if (previous.url && previous.url !== WEBHOOK) return json({error:'Bot already used by another webhook'},409);
        await telegram('setWebhook',{url:WEBHOOK, secret_token:await webhookSecret(token), allowed_updates:['message'], max_connections:1});
        await db.install(row.setup_hash);
        return json({installed:true, bot:me.username});
      }
      if (!path.endsWith('/webhook')) return json({error:'Not found'},404);
      if (!equal(req.headers.get('x-telegram-bot-api-secret-token'), await webhookSecret(token))) return json({error:'Unauthorized'},401);
      const text = await req.text();
      if (text.length > 65536) return json({error:'Payload too large'},413);
      let update;
      try { update = JSON.parse(text); } catch { return json({error:'Invalid JSON'},400); }
      const m = update?.message;
      if (!m || m.chat?.type !== 'private' || !Number.isSafeInteger(m.chat.id) || m.chat.id <= 0 || m.from?.id !== m.chat.id || m.from?.is_bot) return json({ok:true});
      const command = typeof m.text === 'string' && m.text.match(/^\/start(?:@Studkab_Requests_bot)?(?:\s+(bind_[A-Za-z0-9_-]{43}))?\s*$/i);
      if (!command) return json({ok:true});
      const row = await db.get();
      if (!row?.installed) return json({error:'Setup incomplete'},503);
      let bound = false;
      if (command[1] && Date.parse(row.expires_at) > now() && equal(await digest(command[1]),row.owner_hash)) {
        // Atomic compare-and-set: never replace an existing recipient, even with the same link.
        bound = String(row.owner_chat_id) === String(m.chat.id) || await db.bind(row.owner_hash,m.chat.id,new Date(now()).toISOString());
      }
      const message = bound
        ? 'Ваш Telegram привязан как получатель заявок. Уведомления о новых заявках будут приходить сюда. Личные контакты студентам не показываются.'
        : 'Кабинет студента — заявки. Заявки отправляются из кабинета студента. Переписка с исполнителем через бота пока не подключена.';
      await telegram('sendMessage',{chat_id:m.chat.id,text:message});
      return json({ok:true});
    } catch {
      // Do not leak Telegram URLs (which contain the token), request bodies or database errors.
      return json({error:'Service temporarily unavailable'},503);
    }
  };
}
