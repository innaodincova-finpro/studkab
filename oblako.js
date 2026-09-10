/* ==================================================================
   ОБЛАКО: вход через Google или пароль приложения и хранение записей в базе.

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
    lastLoaded: null,
    lastSaved: null,
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
  var userId = null;
  var epoch = 0;
  var identityReady = false;
  Oblako.accept = function (data) { if (data) remember(data); writable = true; conflictRev = null; Oblako.lastError = ""; notify(); };
  Oblako.pause = function () { writable = false; clearTimeout(pushTimer); pending = false; };
  function useUser(user) {
    var id = user ? user.id : "";
    if (id === userId) return;
    Oblako.pause(); epoch++; userId = id;
    Oblako.rev = 0; Oblako.lastSync = null; Oblako.lastLoaded = null; Oblako.lastSaved = null; Oblako.lastError = ""; conflictRev = null;
    Oblako.mode = id ? "cloud" : "local";
    identityReady = false;
    if (opts && opts.switchUser) opts.switchUser(id);
    identityReady = !!id;
  }
  function cleanData(data) {
    var copy = JSON.parse(JSON.stringify(data));
    if (copy.settings) { delete copy.settings.proxyToken; delete copy.settings.dsKey; }
    return copy;
  }

  // A per-account baseline detects unsent changes even after closing the app.
  function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") {
      var out = {}; Object.keys(value).sort().forEach(function(k){out[k]=canonical(value[k]);}); return out;
    }
    return value;
  }
  Oblako.snapshot = function(data){ return JSON.stringify(canonical(cleanData(data))); };
  function baselineKey(){return "oblako-baseline:" + Oblako.app + ":" + userId;}
  function remember(data){try { global.localStorage.setItem(baselineKey(), Oblako.snapshot(data)); } catch(e) { /* Reconcile conservatively if unavailable. */ }}
  Oblako.baseline = function(){try{return global.localStorage.getItem(baselineKey());}catch(e){return null;}};
  Oblako.canSync = function(){return writable;};
  Oblako.identity = function(){return epoch;};
  Oblako.hasPending = function(){return pending || inFlight;};
  Oblako.retry = function(){return flush();};

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
      else if (event === "SIGNED_IN" && session && session.user.id !== userId) {
        setTimeout(function () {
          if (session.user.id === userId) return;
          useUser(session.user); Oblako.email = session.user.email || "";
          if (opts.onAccountChange) opts.onAccountChange();
        }, 0);
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
      useUser(null);
      notify();
    }).catch(function (e) { fail(e); });
  };

  /* ---------- вход ---------- */
  Oblako.signInGoogle = function () {
    if (!client) return Promise.reject(new Error("Облако не настроено"));
    if (Oblako.busy || inFlight) return Promise.reject(new Error("Дождитесь завершения текущей операции"));
    var target = new URL(Oblako.app === "reestr" ? "reestr.html" : "./", global.location.href);
    target.search = ""; target.hash = "";
    Oblako.busy = true; notify();
    return Promise.resolve().then(function () {
      return client.auth.signInWithOAuth({ provider: "google", options: { redirectTo: target.href } });
    }).then(function (r) {
      if (r.error) throw r.error;
      Oblako.busy = false; notify();
      return true;
    }).catch(function (e) {
      Oblako.busy = false; notify();
      throw new Error(humanAuth(e));
    });
  };

  Oblako.signInPassword = async function(email, password) {
    if (!client || Oblako.busy || inFlight) throw new Error("Дождитесь завершения текущей операции");
    email = String(email || "").trim().toLowerCase();
    if (!email || !password) throw new Error("Введите почту и пароль приложения");
    Oblako.busy = true; notify();
    try {
      var r = await client.auth.signInWithPassword({email:email, password:password});
      if (r.error) throw new Error("Не удалось войти. Проверьте почту и пароль приложения. Для первого входа нужна персональная ссылка.");
      var changed = userId !== r.data.user.id;
      useUser(r.data.user); Oblako.email = r.data.user.email || email;
      Oblako.busy = false;
      if (changed && opts.onAccountChange) await opts.onAccountChange();
      return true;
    } finally { Oblako.busy = false; notify(); }
  };

  function passwordFailure(e) {
    var code=String(e && e.code || ''), status=Number(e && e.status || 0);
    var messages={
      save_not_confirmed:'Сервис не подтвердил сохранение пароля. Не выходите из аккаунта. Повторите попытку позже.',
      same_password:'Этот пароль уже установлен. Чтобы изменить его, введите другой пароль.',
      weak_password:'Сервис отклонил пароль как недостаточно надёжный. Используйте более длинный пароль с заглавными и строчными буквами, цифрами и символами.',
      reauthentication_needed:'Для смены пароля нужно заново подтвердить вход в аккаунт. После подтверждения повторите смену пароля.',
      session_not_found:'Сеанс входа больше не действует. Для смены пароля потребуется повторный вход.',
      refresh_token_not_found:'Сеанс входа больше не действует. Для смены пароля потребуется повторный вход.',
      bad_jwt:'Сервис не подтвердил сеанс входа. Для смены пароля потребуется повторный вход.',
      over_request_rate_limit:'Слишком много попыток. Подождите несколько минут перед следующей попыткой.'
    };
    if(messages[code])return messages[code];
    if(status===429)return 'Слишком много попыток. Подождите несколько минут перед следующей попыткой.';
    if(e && (e.name==='AuthRetryableFetchError' || e.name==='TypeError'))return 'Не удалось получить ответ сервиса. Проверьте интернет. Сохранение пароля не подтверждено.';
    var safeCode=/^[a-z_]{1,64}$/.test(code)?code:'unknown';
    return 'Не удалось сохранить пароль: сервис отклонил запрос. Код ошибки: '+safeCode+(status?' (HTTP '+status+')':'')+'. Сообщите исполнителю этот код. Пароль присылать не нужно.';
  }

  Oblako.setPassword = async function(password) {
    if (!client || !userId || Oblako.busy || inFlight) throw new Error("Сначала войдите и дождитесь сохранения");
    if (password.length < 8) throw new Error("Пароль должен содержать не менее 8 символов");
    Oblako.busy = true; notify();
    try {
      var expected=userId, expectedEpoch=epoch;
      var current=await client.auth.getSession();
      if(current.error) throw current.error;
      if(!current.data || !current.data.session || current.data.session.user.id!==expected || epoch!==expectedEpoch) throw {code:"session_not_found"};
      var r = await client.auth.updateUser({password:password});
      if(r.error) throw r.error;
      if(epoch!==expectedEpoch || userId!==expected) throw {code:"session_not_found"};
      if(!r.data || !r.data.user || r.data.user.id!==expected) throw {code:"save_not_confirmed"};
    } catch(e) { throw new Error(passwordFailure(e)); }
    finally { Oblako.busy = false; notify(); }
  };

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

  Oblako.pushRequest = async function (body) {
    if (!client || !userId || Oblako.app !== "kabinet") throw new Error("Сначала войдите в аккаунт");
    var expected = userId;
    var r = await client.auth.getSession();
    var session = r.data && r.data.session;
    if (!session || session.user.id !== expected) throw new Error("Войдите в кабинет заново");
    var res = await fetch(global.OBLAKO_CONFIG.url + "/functions/v1/studkab-push", {
      method:"POST", headers:{"Content-Type":"application/json", Authorization:"Bearer " + session.access_token},
      body:JSON.stringify(body), signal:AbortSignal.timeout(15000)
    });
    var data = await res.json();
    if (!res.ok) throw new Error(data.error || "Не удалось подключить уведомления");
    if (userId !== expected) throw new Error("Аккаунт изменился. Повторите действие");
    return data;
  };

  Oblako.requestApi = async function(body) {
    if (!client || !userId) throw new Error("Сначала войдите в аккаунт");
    var expected = userId, expectedEpoch = epoch;
    var r = await client.auth.getSession(), session = r.data && r.data.session;
    if (!session || session.user.id !== expected || epoch !== expectedEpoch) throw new Error("Войдите заново");
    var res = await fetch(global.OBLAKO_CONFIG.url + "/functions/v1/studkab-requests", {
      method:"POST", headers:{"Content-Type":"application/json",Authorization:"Bearer " + session.access_token},
      body:JSON.stringify(body),signal:AbortSignal.timeout(20000)
    });
    var data = await res.json();
    if (epoch !== expectedEpoch || userId !== expected) throw new Error("Аккаунт изменился. Повторите действие");
    if (!res.ok) throw new Error(data.error || "Не удалось передать заявку");
    return data;
  };

  Oblako.workflowApi = async function(body) {
    if (!client || !userId) throw new Error("Сначала войдите в аккаунт");
    var expected = userId, expectedEpoch = epoch;
    var r = await client.auth.getSession(), session = r.data && r.data.session;
    if (!session || session.user.id !== expected || epoch !== expectedEpoch) throw new Error("Войдите заново");
    var res = await fetch(global.OBLAKO_CONFIG.url + "/functions/v1/studkab-workflow", {
      method:"POST", headers:{"Content-Type":"application/json",Authorization:"Bearer " + session.access_token},
      body:JSON.stringify(body), signal:AbortSignal.timeout(25000)
    });
    var data = await res.json().catch(function(){ return {}; });
    if (epoch !== expectedEpoch || userId !== expected) throw new Error("Аккаунт изменился. Повторите действие");
    if (!res.ok) { var error = new Error(data.error || "Не удалось получить состояние заявки"); error.status = res.status; throw error; }
    return data.result;
  };

  Oblako.workflowUpload = async function(path, file) {
    if (!client || !userId) throw new Error("Сначала войдите в аккаунт");
    var expected = userId, expectedEpoch = epoch;
    var r = await client.storage.from("studkab-private").upload(path, file, {upsert:false,contentType:file.type || "application/octet-stream"});
    if (epoch !== expectedEpoch || userId !== expected) throw new Error("Аккаунт изменился. Повторите действие");
    if (r.error) throw new Error("Файл не загрузился. Исходный файл остался на устройстве.");
    return r.data;
  };

  Oblako.workflowDownload = async function(path) {
    if (!client || !userId) throw new Error("Сначала войдите в аккаунт");
    var expected = userId, expectedEpoch = epoch;
    var r = await client.storage.from("studkab-private").download(path);
    if (epoch !== expectedEpoch || userId !== expected) throw new Error("Аккаунт изменился. Повторите действие");
    if (r.error || !r.data) throw new Error("Не удалось скачать проверенный документ");
    return r.data;
  };

  Oblako.signOut = function () {
    if (!client) return Promise.resolve();
    if (inFlight) return Promise.reject(new Error("Дождитесь завершения сохранения"));
    Oblako.pause();
    return Promise.resolve().then(function(){ return global.StudPush ? global.StudPush.disable() : null; }).then(function(){ return client.auth.signOut({ scope: "local" }); }).then(function (r) {
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
    if (!client || Oblako.mode !== "cloud" || !identityReady) return Promise.resolve({ status: "offline" });
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
        Oblako.lastLoaded = new Date();
        notify();
        return { status: "loaded", remote: r.data.data, remoteAt: r.data.updated_at, rev: Oblako.rev };
      })
      .catch(function (e) { Oblako.busy = false; fail(e); return { status: "error", error: Oblako.lastError }; });
  };

  /* ---------- запись в базу ---------- */
  /* Explicit overwrite still compares the version presented to the user. */
  Oblako.push = function (data, force) {
    if (!client || Oblako.mode !== "cloud" || !identityReady) return Promise.resolve({ status: "offline" });
    if (inFlight) return Promise.resolve({ status: "busy" });
    if (!writable && !(force && conflictRev !== null)) {
      return Promise.resolve({ status: "blocked", error: "Сначала загрузите и выберите записи из базы" });
    }
    var expectedRev = force && conflictRev !== null ? conflictRev : Oblako.rev;
    var requestEpoch = epoch;
    var sentData = cleanData(data);
    inFlight = true;
    Oblako.busy = true; notify();
    return client.rpc("save_app_data_v2", {
      p_app: Oblako.app,
      p_data: sentData,
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
      Oblako.lastSync = new Date(); Oblako.lastSaved = Oblako.lastSync;
      remember(sentData);
      Oblako.lastError = "";
      notify();
      return { status: "ok", rev: row.rev };
    }).catch(function (e) { inFlight = false; Oblako.busy = false; fail(e); return { status: "error", error: Oblako.lastError }; });
  };

  /* Приложение зовёт это после каждой записи в память устройства.
     Отправка идёт не сразу, а через полторы секунды после последнего изменения. */
  Oblako.touch = function () {
    if (Oblako.mode !== "cloud") return;
    pending = true; notify();
    clearTimeout(pushTimer);
    pushTimer = setTimeout(flush, 1500);
  };

  function flush() {
    if (inFlight || !writable || !pending || Oblako.mode !== "cloud" || !opts || !opts.getData) return;
    pending = false;
    return Oblako.push(opts.getData()).then(function (res) {
      if (res.status === "conflict" && opts.onConflict) opts.onConflict(res);
      else if (res.status !== "ok") pending = true;   // попробуем в следующий раз
      if (pending && res.status === "ok") { clearTimeout(pushTimer); pushTimer = setTimeout(flush, 1500); }
      notify(); return res;
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
    if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return "Нет связи с облаком. Записи на устройстве сохранены; повторите синхронизацию после подключения";
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
    if (!Oblako.ready) return "Облако временно недоступно. Записи сохраняются на устройстве";
    if (Oblako.mode !== "cloud") return "Записи сохраняются в этом браузере. Войдите, чтобы пользоваться ими на других устройствах";
    if (Oblako.busy) return "Проверяем облачные записи… Дождитесь завершения";
    if (Oblako.lastError) return Oblako.lastError;
    if (!writable) return "Нужно проверить записи перед автоматическим сохранением";
    if (pending) return "На устройстве сохранено. Ожидается отправка в облако";
    if (Oblako.lastSaved) return "Изменения сохранены в облаке в " + clock(Oblako.lastSaved);
    if (Oblako.lastLoaded) return "Записи загружены из облака в " + clock(Oblako.lastLoaded);
    return "Облако готово. Новые записи будут сохраняться автоматически";
  };
  function clock(d){return pad(d.getHours()) + ":" + pad(d.getMinutes());}
  function pad(n) { return n < 10 ? "0" + n : "" + n; }

  global.Oblako = Oblako;
})(window);
