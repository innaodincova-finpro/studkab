/* Помощник для работы без сети.
   Правило простое: страницы всегда берём из сети, если она есть.
   Сохранённая копия — только запасной вариант, когда сети нет.
   Поэтому обновление приложения никогда не «застревает». */

const CACHE = "studkab-v12";
const SHELL = [
  "./",
  "./push.js?v=1",
  "./index.html",
  "./reestr.html",
  "./manifest-kabinet.webmanifest",
  "./manifest-reestr.webmanifest",
  "./oblako.js?v=10",
  "./cloud-ui.js?v=1",
  "./oblako-config.js"
];

self.addEventListener("install", (e) => {
  self.skipWaiting();                       // новая версия вступает сразу
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      Promise.all(SHELL.map((u) => c.add(u).catch(() => null)))
    )
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => /^studkab-v[0-9]+$/.test(k) && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())     // берём управление без перезагрузки
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // чужие адреса не трогаем

  const isPage = req.mode === "navigate" ||
                 (req.headers.get("accept") || "").includes("text/html");

  // Only this worker's cache may supply an application response.
  const cachePromise = caches.open(CACHE);
  const remember = (res) => {
    if (res.ok) {
      const copy = res.clone();
      e.waitUntil(cachePromise.then(c => c.put(req, copy)).catch(() => {}));
    }
    return res;
  };
  const unavailable = () => new Response('Нет соединения. Подключитесь к интернету и откройте страницу снова.', {
    status: 503, headers: {'Content-Type': 'text/plain; charset=utf-8'}
  });

  if (isPage) {
    const fallback = async () => {
      const cache = await cachePromise;
      const exact = await cache.match(req);
      if (exact?.ok) return exact;
      const scope = new URL(self.registration.scope);
      // Query parameters do not turn the registry into the cabinet.
      const relative = url.pathname.slice(scope.pathname.length);
      if (url.pathname.startsWith(scope.pathname) && ['', 'index.html', 'reestr.html'].includes(relative)) {
        const saved = await cache.match(new URL(relative || 'index.html', scope).href);
        if (saved?.ok) return saved;
      }
    };
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) return remember(res);
        // Do not hide permission errors or missing pages behind a stale copy.
        if (res.status >= 500) return await fallback() || res;
        return res;
      } catch {
        return await fallback() || unavailable();
      }
    })());
    return;
  }

  // Refresh assets without replacing a good copy with an HTTP error.
  const fresh = fetch(req).then(remember);
  e.waitUntil(fresh.catch(() => {}));
  e.respondWith((async () => {
    const cached = await (await cachePromise).match(req);
    if (cached?.ok) return cached;
    try { return await fresh; } catch { return unavailable(); }
  })());
});

self.addEventListener('push', event => {
 event.waitUntil((async()=>{
  let data;try{data=event.data.json();}catch{return;}
  if(!data || Date.now()>Number(data.expiresAt))return;
  await self.registration.showNotification('Кабинет студента', {
   body:String(data.body||'Откройте кабинет, чтобы посмотреть напоминание.').slice(0,250),
   tag:String(data.tag||'studkab').slice(0,250),data:{url:new URL('./',self.registration.scope).href}
  });
 })());
});
self.addEventListener('notificationclick', event => {
 event.notification.close();
 event.waitUntil((async()=>{
  const url=new URL('./',self.registration.scope).href;
  const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  const existing=windows.find(w=>w.url===url || w.url===url+'index.html');
  if(existing)return existing.focus();
  return self.clients.openWindow(url);
 })());
});
