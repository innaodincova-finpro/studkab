/* Помощник для работы без сети.
   Правило простое: страницы всегда берём из сети, если она есть.
   Сохранённая копия — только запасной вариант, когда сети нет.
   Поэтому обновление приложения никогда не «застревает». */

const CACHE = "studkab-v7";
const SHELL = [
  "./",
  "./push.js?v=1",
  "./index.html",
  "./email.js?v=1",
  "./reestr.html",
  "./manifest-kabinet.webmanifest",
  "./manifest-reestr.webmanifest",
  "./oblako.js?v=7",
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

  if (isPage) {
    /* страницы: сначала сеть, копия — только если сети нет */
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match("./index.html")))
    );
    return;
  }

  /* картинки и описания: сначала копия, потом тихо обновляем */
  e.respondWith(
    caches.match(req).then((cached) => {
      const fresh = fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => cached);
      return cached || fresh;
    })
  );
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
