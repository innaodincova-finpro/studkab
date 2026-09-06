/* Помощник для работы без сети.
   Правило простое: страницы всегда берём из сети, если она есть.
   Сохранённая копия — только запасной вариант, когда сети нет.
   Поэтому обновление приложения никогда не «застревает». */

const CACHE = "studkab-v3";
const SHELL = [
  "./",
  "./index.html",
  "./reestr.html",
  "./manifest-kabinet.webmanifest",
  "./manifest-reestr.webmanifest",
  "./oblako.js",
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
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
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
