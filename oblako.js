/* ==================================================================
   ОБЛАКО: вход по коду на почту и хранение записей в базе.

   Как устроено:
   — записи по-прежнему живут в памяти устройства и работают без входа;
   — если человек вошёл, те же записи отправляются в базу;
   — при открытии на другом устройстве записи забираются оттуда;
   — если на двух устройствах поменяли одно и то же, приложение
     не затирает молча, а спрашивает, какую версию оставить.

   Приложение подключает файл так:
     window.OBLAKO_CONFIG = { url: "...", key: "..." };   (oblako-config.js)
     <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
     <script src="oblako.js"></script>
   ================================================================== */
(function (global) {
  "use strict";

  var Oblako = {
    ready: false,          // библиотека и настройки на месте
    mode: "local",         // local | cloud
    email: "",
    rev: 0,                // номер версии, полученный из базы
    busy: false,
    lastSync: null,
    lastError: "",
    app: "",
  };

  var client = null;
  var opts = null;         // { app, getData, setData, onChange }
  var pushTimer = null;
  var pending = false;
  var writable = false;
  var inFlight = false;
  var conflictRev = null;
  var userId = "";
  var epoch = 0;
  Oblako.accept = function () { writable = true; conflictRev = null; Oblako.lastError = ""; notify(); };
  Oblako.pause = function () { writable = false; clearTimeout(pushTimer); pending = false; };
  function useUser(user) {
    var id = user ? user.id : "";
    if (id === userId) return;
    Oblako.pause(); epoch++; userId = id;
    Oblako.rev = 0; Oblako.lastSync = null; conflictRev = null;
    Oblako.mode = id ? "cloud" : "local";
    if (opts && opts.switchUser) opts.switchUser(id);
  }
  function cleanData(data) {
    var copy = JSON.parse(JSON.stringify(data));
    if (copy.settings) { delete copy.settings.proxyToken; delete copy.settings.dsKey; }
    return copy;
  }

  /* ---------- запуск ---------- */
  Oblako.init = function (o) {
    opts = o;
    Oblako.app = o.app;
    var cfg = global.OBLAKO_CONFIG;
    if (!cfg || !cfg.url || !cfg.key) { Oblako.ready = false; notify(); return Promise.resolve(); }
    if (!global.supabase || !global.supabase.createClient) { Oblako.ready = false; notify(); return Promise.resolve(); }

    client = global.supabase.createClient(cfg.url, cfg.key, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: "oblako-" + o.app }
    });
    Oblako.ready = true;
    client.auth.onAuthStateChange(function (event, session) {
      if (event === "SIGNED_OUT") { useUser(null); Oblako.email = ""; notify(); }
      else if (session && userId && session.user.id !== userId) {
        useUser(session.user); Oblako.email = session.user.email || "";
        if (opts.onAccountChange) setTimeout(opts.onAccountChange, 0);
      }
    });

    return client.auth.getSession().then(function (r) {
      var s = r && r.data && r.data.session;
      if (s && s.user) {
        useUser(s.user);
        Oblako.mode = "cloud";
        Oblako.email = s.user.email || "";
        notify();
        return;
      }
      notify();
    }).catch(function (e) { fail(e); });
  };

  /* ---------- вход ---------- */
  Oblako.sendCode = function (email) {
    if (!client) return Promise.reject(new Error("Облако не настроено"));
    email = String(email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return Promise.reject(new Error("Проверьте адрес почты"));
    Oblako.busy = true; notify();
    return client.auth.signInWithOtp({ email: email, options: { shouldCreateUser: true } })
      .then(function (r) {
        Oblako.busy = false; notify();
        if (r.error) throw new Error(humanAuth(r.error));
        return true;
      })
      .catch(function (e) { Oblako.busy = false; notify(); throw new Error(humanAuth(e)); });
  };

  Oblako.verifyCode = function (email, code) {
    if (!client) return Promise.reject(new Error("Облако не настроено"));
    email = String(email || "").trim().toLowerCase();
    code = String(code || "").replace(/\s+/g, "");
    if (!/^\d{6}$/.test(code)) return Promise.reject(new Error("Код — шесть цифр из письма"));
    Oblako.busy = true; notify();
    return client.auth.verifyOtp({ email: email, token: code, type: "email" })
      .then(function (r) {
        Oblako.busy = false;
        if (r.error) { notify(); throw new Error(humanAuth(r.error)); }
        useUser(r.data.user);
        Oblako.mode = "cloud";
        Oblako.email = (r.data && r.data.user && r.data.user.email) || email;
        notify();
        return { status: "signed-in" };
      })
      .catch(function (e) { Oblako.busy = false; notify(); throw new Error(humanAuth(e)); });
  };

  Oblako.signOut = function () {
    if (!client) return Promise.resolve();
    if (inFlight) return Promise.reject(new Error("Дождитесь завершения сохранения"));
    Oblako.pause();
    return client.auth.signOut({ scope: "local" }).then(function (r) {
      if (r.error) throw r.error;
      useUser(null);
      Oblako.mode = "local"; Oblako.email = ""; Oblako.rev = 0; Oblako.lastSync = null;
      notify();
    });
  };

  /* ---------- чтение из базы ---------- */
  /* Возвращает: {status:"empty"|"loaded"|"choose", remote, remoteAt} */
  Oblako.pull = function (o) {
    o = o || {};
    if (!client || Oblako.mode !== "cloud") return Promise.resolve({ status: "offline" });
    if (inFlight) return Promise.resolve({ status: "busy" });
    Oblako.pause();
    var requestEpoch = epoch;
    Oblako.busy = true; notify();
    return client.from("app_data").select("data,rev,updated_at").eq("app", Oblako.app).eq("user_id", userId).maybeSingle()
      .then(function (r) {
        Oblako.busy = false;
        if (r.error) { fail(r.error); return { status: "error", error: Oblako.lastError }; }
        if (requestEpoch !== epoch) return { status: "stale" };
        Oblako.lastError = "";
        if (!r.data) {                       // в базе пусто
          Oblako.rev = 0; notify();
          return { status: "empty" };
        }
        Oblako.rev = r.data.rev || 0;
        Oblako.lastSync = new Date();
        notify();
        return { status: "loaded", remote: r.data.data, remoteAt: r.data.updated_at, rev: Oblako.rev };
      })
      .catch(function (e) { Oblako.busy = false; fail(e); return { status: "error", error: Oblako.lastError }; });
  };

  /* ---------- запись в базу ---------- */
  /* Explicit overwrite still compares the version presented to the user. */
  Oblako.push = function (data, force) {
    if (!client || Oblako.mode !== "cloud") return Promise.resolve({ status: "offline" });
    if (inFlight) return Promise.resolve({ status: "busy" });
    if (!writable && !(force && conflictRev !== null)) {
      return Promise.resolve({ status: "blocked", error: "Сначала загрузите и выберите записи из базы" });
    }
    var expectedRev = force && conflictRev !== null ? conflictRev : Oblako.rev;
    var requestEpoch = epoch;
    inFlight = true;
    Oblako.busy = true; notify();
    return client.rpc("save_app_data_v2", {
      p_app: Oblako.app,
      p_data: cleanData(data),
      p_rev: expectedRev
    }).then(function (r) {
      inFlight = false;
      if (requestEpoch !== epoch) return { status: "stale" };
      Oblako.busy = false;
      if (r.error) { fail(r.error); return { status: "error", error: Oblako.lastError }; }
      var row = Array.isArray(r.data) ? r.data[0] : r.data;
      if (!row) { notify(); return { status: "error", error: "Пустой ответ базы" }; }
      if (row.conflict) {
        writable = false; conflictRev = row.rev;
        Oblako.lastError = "Есть изменения на другом устройстве — выберите версию"; notify();
        return { status: "conflict", rev: row.rev, updated_at: row.updated_at };
      }
      if (row.ok !== true || !Number.isSafeInteger(row.rev) || row.rev < 1) {
        fail(new Error("База не подтвердила сохранение"));
        return { status: "error", error: Oblako.lastError };
      }
      writable = true; conflictRev = null;
      Oblako.rev = row.rev;
      Oblako.lastSync = new Date();
      Oblako.lastError = "";
      notify();
      return { status: "ok", rev: row.rev };
    }).catch(function (e) { inFlight = false; Oblako.busy = false; fail(e); return { status: "error", error: Oblako.lastError }; });
  };

  /* Приложение зовёт это после каждой записи в память устройства.
     Отправка идёт не сразу, а через полторы секунды после последнего изменения. */
  Oblako.touch = function () {
    if (Oblako.mode !== "cloud") return;
    pending = true;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(flush, 1500);
  };

  function flush() {
    if (inFlight || !writable || !pending || Oblako.mode !== "cloud" || !opts || !opts.getData) return;
    pending = false;
    Oblako.push(opts.getData()).then(function (res) {
      if (res.status === "conflict" && opts.onConflict) opts.onConflict(res);
      else if (res.status !== "ok") pending = true;   // попробуем в следующий раз
      if (pending && res.status === "ok") { clearTimeout(pushTimer); pushTimer = setTimeout(flush, 1500); }
    });
  }

  /* сеть вернулась — досылаем */
  global.addEventListener("online", function () { if (pending) flush(); });
  /* уходим со страницы — не теряем последние секунды работы */
  global.addEventListener("pagehide", function () { if (pending) flush(); });

  /* ---------- служебное ---------- */
  function notify() { if (opts && opts.onChange) { try { opts.onChange(Oblako); } catch (e) {} } }

  function fail(e) {
    Oblako.lastError = human(e);
    notify();
  }

  function human(e) {
    var m = (e && (e.message || e.error_description || e.msg)) || String(e || "");
    if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return "Нет связи с базой — запишем, когда появится сеть";
    if (/JWT|token is expired|invalid claim/i.test(m)) return "Вход устарел — войдите заново";
    if (/row-level security|permission denied/i.test(m)) return "Нет доступа к этим записям";
    if (/relation .* does not exist|function .* does not exist/i.test(m)) return "База не настроена: выполните baza.sql";
    return m || "Неизвестная ошибка";
  }

  function humanAuth(e) {
    var m = (e && (e.message || e.error_description)) || String(e || "");
    if (/Invalid login credentials|Token has expired or is invalid|invalid otp/i.test(m)) return "Код неверный или устарел — запросите новый";
    if (/Email rate limit|over_email_send_rate_limit|too many requests/i.test(m)) return "Слишком часто. Подождите минуту и попробуйте снова";
    if (/Signups not allowed|signup_disabled/i.test(m)) return "Регистрация закрыта в настройках базы";
    if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return "Нет связи — проверьте интернет";
    return m || "Не получилось";
  }

  Oblako.statusText = function () {
    if (!Oblako.ready) return "не подключено";
    if (Oblako.mode !== "cloud") return "только на этом устройстве";
    if (Oblako.lastError) return Oblako.lastError;
    if (Oblako.busy) return "синхронизация…";
    if (!writable) return "нужно загрузить и выбрать записи";
    if (pending) return "есть несохранённые изменения";
    if (Oblako.lastSync) {
      var d = Oblako.lastSync;
      return "сохранено в базе " + pad(d.getHours()) + ":" + pad(d.getMinutes());
    }
    return "вошли";
  };
  function pad(n) { return n < 10 ? "0" + n : "" + n; }

  global.Oblako = Oblako;
})(window);
