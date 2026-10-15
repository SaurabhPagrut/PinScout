/*
 * Recorder page script. Runs INSIDE the store's page (MAIN world).
 *
 * It is injected in two ways, by the side panel's "Help add a new store":
 *   - immediately, into the page that is already open, and
 *   - as a registered content script at document_start, so that after a reload or
 *     navigation it is running BEFORE the store's own code (which also means the
 *     store cannot have grabbed the original fetch/XHR first).
 *
 * State lives in sessionStorage (per tab, per site), so records survive reloads.
 * It only does anything while a recording is active, and it switches itself off
 * after 10 minutes.
 *
 * What it keeps:
 *   records    requests / form posts that involve the pincode (or values learned from
 *              them, see below), with method, URL, headers, body and a response snippet
 *   activity   one line per request of ANY kind (method, status, URL) - shows what the
 *              store does even when nothing carried the pincode
 *   hints      localStorage / sessionStorage / cookie writes that involve the pincode
 *   resources  URLs seen by the browser's resource timing that carry the pincode; flagged
 *              when the hooks did not see them
 *   pageLoads  each page load during the recording
 *   steps      what the user did in the page (clicks, typing, Enter, submits) as compact
 *              element descriptions, so a store can be driven through its own UI later
 *   stateHints where in the page's JavaScript state the values used in the requests live
 *              (paths only), for stores whose request needs product data from the page
 *
 * Chains: many stores turn the pincode into lat/lng or a place id and use only those
 * afterwards. Numbers and ids found in matching traffic are learned as extra markers so
 * later requests are captured too.
 *
 * Privacy: values of anything named like a cookie / token / csrf / session / secret /
 * key / authorization / signature, or like personal data (address, name, phone, e-mail,
 * user / device id), are replaced with "[masked]", including whole nested objects. On top
 * of that, e-mails, Indian mobile numbers, JWTs and long opaque tokens are replaced
 * wherever they appear ([email], [phone], [jwt], [token]), and text inside address /
 * account / profile areas of the page is not recorded. `masked` in the output counts
 * what was replaced. Masking is best effort: skim the output before sharing it.
 */
(function () {
  "use strict";
  var KEY = "__pinscout_rec_v1";
  if (window.__pinscoutRecorder) return;

  var STG = typeof Storage !== "undefined" ? Storage.prototype : null;
  if (!STG) return;
  var origGet = STG.getItem, origSet = STG.setItem, origRemove = STG.removeItem;

  var state;
  try { state = JSON.parse(origGet.call(window.sessionStorage, KEY) || "null"); } catch (e) { state = null; }
  if (!state || !state.active) return;

  var MAX_AGE_MS = 10 * 60 * 1000;
  if (Date.now() - state.startedAt > MAX_AGE_MS) {
    try { origRemove.call(window.sessionStorage, KEY); } catch (e) { /* ignore */ }
    return;
  }

  var MAX_RECORDS = 40, MAX_ACTIVITY = 150, MAX_HINTS = 30, MAX_RESOURCES = 40, MAX_LEARNED = 8;
  var MAX_RESP = 3000, MAX_BODY = 4000, MAX_READ = 2 * 1024 * 1024, MAX_STEPS = 80;
  // Analytics / tracking calls would fill the activity log with noise.
  var NOISE = /(newrelic|awswaf|sentry|google-analytics|googletagmanager|doubleclick|googlesyndication|facebook\.|clarity\.ms|hotjar|segment\.|mixpanel|amplitude|analytics\.|\/ingest|track-web|unagi|\/telemetry|\/events?(\?|$)|\/gen_204)/i;

  // Secrets (tokens, cookies, keys, signatures) and personal data (addresses, names, phone, e-mail).
  // A key is masked when it contains one of these words anywhere...
  var SENSITIVE = "cookie|authoriz|auth|token|csrf|xsrf|session|secret|key|signature|nonce|password|passwd|jwt|otp";
  var PERSONAL = "address\\w*|landmark|owner\\w*|contact\\w*|phone\\w*|mobile\\w*|e-?mail|customer_?name|full_?name|first_?name|last_?name|" +
    "user[_-]?name|display[_-]?name|nick[_-]?name|recipient\\w*|receiver[_-]?name|user[_-]?id|customer[_-]?id|device[_-]?id|" +
    "delivery\\w*line\\d*|street|locality|building|house[_-]?no|flat[_-]?no|gstin|birth";
  var MASKED = SENSITIVE + "|" + PERSONAL;
  var keyRe = new RegExp(MASKED, "i");
  // ...or when it is exactly one of these short names (too short to match safely inside other words).
  var shortKeyRe = /^(sid|sig|uid|name|dob|pan|line_?\d|addr\d*)$/i;
  function sensitiveKey(k) { k = String(k); return keyRe.test(k) || shortKeyRe.test(k); }

  // Regex fallbacks for text that is not parseable JSON or a form body.
  var jsonKeyRe = new RegExp('("[^"]*(?:' + MASKED + ')[^"]*"\\s*:\\s*")((?:[^"\\\\]|\\\\.)*)(")', "gi");
  var jsonNumRe = new RegExp('("[^"]*(?:' + MASKED + ')[^"]*"\\s*:\\s*)(-?\\d+(?:\\.\\d+)?)', "gi");
  var jsKeyRe = new RegExp("((?:^|[{,\\s])'?[\\w$-]*(?:" + MASKED + ")[\\w$-]*'?\\s*:\\s*)('(?:[^'\\\\]|\\\\.)*'|[^,}\\s\"']+)", "gi");
  var formRe = new RegExp('([?&;]?[^=&\\s"]*(?:' + MASKED + ')[^=&\\s"]*=)[^&\\s"]*', "gi");
  var metaRe = /(<meta[^>]*(?:csrf|token|nonce)[^>]*content=")[^"]*(")/gi;
  var longAttrRe = /(content=")[A-Za-z0-9+\/=_-]{40,}(")/g;

  // Value-based scrubbers: catch personal data and secrets whatever key (if any) they sit under.
  var emailRe = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
  var phoneRe = /(?<![\d.])(?:\+?91[\s-]?|0)?[6-9]\d{9}(?![\d.])/g;               // Indian mobile numbers
  var jwtRe = /eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g;
  var opaqueRe = /[A-Za-z0-9+\/=_]{32,}/g;                                        // long tokens; no hyphens, so slugs survive
  var scrubbed = { email: 0, phone: 0, token: 0 };
  function scrub(s) {
    return String(s)
      .replace(jwtRe, function () { scrubbed.token++; return "[jwt]"; })
      .replace(emailRe, function () { scrubbed.email++; return "[email]"; })
      .replace(phoneRe, function () { scrubbed.phone++; return "[phone]"; })
      .replace(opaqueRe, function (m) {
        if (!/\d/.test(m) || !/[A-Za-z]/.test(m)) return m;
        // A run of lowercase path segments ("in/api/service/application/v1") is a URL path, not a
        // token: base64 tokens that contain "/" also mix in capitals, "+" or "=".
        if (m.indexOf("/") !== -1 && /^[a-z0-9_]*(\/[a-z0-9_]*)+$/.test(m)) return m;
        scrubbed.token++; return "[token]";
      });
  }

  state.records = state.records || [];
  state.activity = state.activity || [];
  state.hints = state.hints || [];
  state.resources = state.resources || [];
  state.pages = state.pages || [];
  state.steps = state.steps || [];
  state.markers = state.markers && state.markers.length ? state.markers : [];

  // ---- helpers ------------------------------------------------------------
  function mask(s) {
    return scrub(String(s).replace(jsonKeyRe, "$1[masked]$3").replace(jsonNumRe, '$1"[masked]"').replace(jsKeyRe, "$1'[masked]'")
      .replace(formRe, "$1[masked]").replace(metaRe, "$1[masked]$2").replace(longAttrRe, "$1[masked]$2"));
  }
  function decode(s) { try { return decodeURIComponent(String(s).replace(/\+/g, " ")); } catch (e) { return String(s); } }
  // a=1&b=2 bodies: mask by key, scrub values (left encoded unless something had to be replaced).
  function maskForm(t) {
    return t.split("&").map(function (p) {
      var i = p.indexOf("="); if (i < 0) return scrub(p);
      var k = p.slice(0, i), v = p.slice(i + 1);
      var dk = decode(k);                                      // also a[address][line1] style keys
      if (sensitiveKey(dk) || sensitiveKey(dk.replace(/\]$/, "").split(/[\[.]/).pop())) return k + "=[masked]";
      var dv = decode(v), sv = mask(dv);
      return k + "=" + (sv === dv ? v : sv);
    }).join("&");
  }
  // Masks and shrinks a request/response body. JSON is masked structurally: a sensitive key's whole
  // value goes, whether it is a string, number, object or array. Long strings and arrays are cut.
  function clean(text) {
    var t = String(text), c = t.trim().charAt(0);
    if (c !== "{" && c !== "[") return /^[^\s{}\[\]<>"]+=[^\s]*$/.test(t.trim()) ? maskForm(t.trim()) : mask(t);
    var v; try { v = JSON.parse(t); } catch (e) { return mask(t); }
    function walk(x, d) {
      if (x === null || typeof x !== "object") {
        if (typeof x === "string") { x = scrub(x); return x.length > 60 ? x.slice(0, 40) + "…(" + x.length + " chars)" : x; }
        if (typeof x === "number" && scrub(String(x)) !== String(x)) return "[phone]";
        return x;
      }
      if (d > 8) return "…";
      if (Array.isArray(x)) {
        var out = x.slice(0, 3).map(function (i) { return walk(i, d + 1); });
        if (x.length > 3) out.push("…(+" + (x.length - 3) + " more)");
        return out;
      }
      var o = {};
      Object.keys(x).slice(0, 60).forEach(function (k) { o[k] = sensitiveKey(k) ? "[masked]" : walk(x[k], d + 1); });
      return o;
    }
    return JSON.stringify(walk(v, 0));
  }
  // Storage and cookie values are often URL-encoded JSON; decode first so the keys inside are seen.
  function cleanAny(v) { v = String(v); return /%[0-9A-F]{2}/i.test(v) && !/[{"]/.test(v) ? clean(decode(v)) : clean(v); }
  function clip(s, n) { s = String(s); return s.length > n ? s.slice(0, n) + "…[+" + (s.length - n) + " chars]" : s; }
  function maskParams(sp) {
    Array.from(sp.keys()).forEach(function (k) {
      var vals = sp.getAll(k);
      sp.delete(k);
      vals.forEach(function (v) { sp.append(k, sensitiveKey(k) ? "[masked]" : scrub(v)); });
    });
  }
  function maskUrl(u) {
    try {
      var url = new URL(u, location.href);
      maskParams(url.searchParams);
      url.pathname = url.pathname.split("/").map(function (seg) { var d = decode(seg), s = scrub(d); return s === d ? seg : encodeURIComponent(s); }).join("/");
      if (url.hash.length > 1) {
        var h = url.hash.slice(1);
        if (h.indexOf("=") !== -1) { var hp = new URLSearchParams(h); maskParams(hp); url.hash = hp.toString(); }
        else url.hash = scrub(h);
      }
      return url.toString();
    } catch (e) { return mask(u); }
  }
  function maskHeaders(h) {
    var out = {};
    Object.keys(h).forEach(function (k) { out[k] = sensitiveKey(k) ? "[masked]" : clip(mask(h[k]), 300); });
    return out;
  }
  function headersToObj(h) {
    var o = {};
    try {
      if (!h) return o;
      if (typeof h.forEach === "function" && !Array.isArray(h)) h.forEach(function (v, k) { o[k] = v; });
      else if (Array.isArray(h)) h.forEach(function (p) { o[p[0]] = p[1]; });
      else Object.keys(h).forEach(function (k) { o[k] = h[k]; });
    } catch (e) { /* ignore */ }
    return o;
  }
  function bodyToText(b) {
    try {
      if (b == null) return "";
      if (typeof b === "string") return b;
      if (typeof URLSearchParams !== "undefined" && b instanceof URLSearchParams) return b.toString();
      if (typeof FormData !== "undefined" && b instanceof FormData) {
        return Array.from(b.entries()).map(function (p) { return p[0] + "=" + (typeof p[1] === "string" ? p[1] : "[file]"); }).join("&");
      }
      return "[" + Object.prototype.toString.call(b) + "]";
    } catch (e) { return ""; }
  }
  var readable = function (ct) { return /json|text|html|xml|javascript/i.test(ct || ""); };
  var now = function () { return Date.now() - state.startedAt; };
  var hit = function (text) {
    if (!text) return false;
    text = String(text);
    for (var i = 0; i < state.markers.length; i++) if (text.indexOf(state.markers[i]) !== -1) return true;
    return false;
  };

  // ---- persistence ----------------------------------------------------------
  var saveTimer = 0;
  function save() { try { origSet.call(window.sessionStorage, KEY, JSON.stringify(state)); } catch (e) { /* quota */ } }
  function saveSoon() { if (!saveTimer) saveTimer = setTimeout(function () { saveTimer = 0; save(); }, 150); }
  function saveNow() { if (saveTimer) { clearTimeout(saveTimer); saveTimer = 0; } save(); }
  window.addEventListener("pagehide", saveNow);
  window.addEventListener("beforeunload", saveNow);
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") saveNow(); });

  // ---- learning markers (pincode -> lat/lng / place id -> ...) ----------------
  var numRe = /(?:lat(?:itude)?|lng|lon(?:gitude)?)["']?\s*[:=]\s*"?(-?\d{1,3}\.\d{4,})/gi;
  var idRe = /place_?id["']?\s*[:=]\s*"?([A-Za-z0-9_-]{15,})/gi;
  function learn(text) {
    var found = [], m;
    numRe.lastIndex = 0; idRe.lastIndex = 0;
    while ((m = numRe.exec(text))) found.push(m[1]);
    while ((m = idRe.exec(text))) found.push(m[1]);
    found.forEach(function (v) {
      if (state.markers.length - 1 < MAX_LEARNED && state.markers.indexOf(v) === -1) state.markers.push(v);
    });
  }

  // ---- recording ---------------------------------------------------------------
  function noteActivity(method, status, url) {
    if (NOISE.test(url)) return;
    var line = method + " " + status + " " + clip(maskUrl(url), 220);
    if (state.activity[state.activity.length - 1] === line) return;
    if (state.activity.length < MAX_ACTIVITY) { state.activity.push(line); saveSoon(); }
  }

  function keep(rec, url, bodyText, respText) {
    var joined = url + "\n" + bodyText + "\n" + (respText || "");
    if (!hit(joined) || state.records.length >= MAX_RECORDS) return;
    state.records.push({
      t: now(), kind: rec.kind, method: rec.method,
      url: maskUrl(url),
      requestHeaders: maskHeaders(rec.headers || {}),
      requestBody: clip(clean(bodyText), MAX_BODY),
      status: rec.status, contentType: rec.contentType || "",
      // HTML pages can contain saved addresses and names, so only their size is kept.
      response: respText == null ? "[not read]"
        : /html/i.test(rec.contentType || "") ? "[HTML, " + respText.length + " chars, omitted]"
        : clip(clean(respText), MAX_RESP),
    });
    learn(joined);
    saveSoon();
  }

  function addHint(kind, text) {
    if (state.hints.length >= MAX_HINTS) return;
    state.hints.push({ t: now(), kind: kind, text: clip(scrub(text), 300) });
    saveSoon();
  }

  var restore = [];

  // fetch
  var origFetch = window.fetch;
  if (typeof origFetch === "function") {
    window.fetch = async function (input, init) {
      var isReq = typeof Request !== "undefined" && input instanceof Request;
      var url = isReq ? input.url : String(input);
      var method = String((init && init.method) || (isReq ? input.method : "GET")).toUpperCase();
      var headers = Object.assign({}, isReq ? headersToObj(input.headers) : {}, headersToObj(init && init.headers));
      var bodyText = bodyToText(init && init.body);
      if (!bodyText && isReq) { try { bodyText = await input.clone().text(); } catch (e) { /* ignore */ } }
      var res;
      try { res = await origFetch.apply(this, arguments); }
      catch (err) { try { noteActivity(method, "ERR", url); } catch (e2) { /* ignore */ } throw err; }
      try {
        var ct = res.headers.get("content-type") || "";
        var len = Number(res.headers.get("content-length") || 0);
        var text = null;
        if (readable(ct) && len < MAX_READ) text = await res.clone().text();
        noteActivity(method, res.status, url);
        keep({ kind: "fetch", method: method, headers: headers, status: res.status, contentType: ct }, url, bodyText, text);
      } catch (e) { /* never break the page */ }
      return res;
    };
    restore.push(function () { window.fetch = origFetch; });
  }

  // XMLHttpRequest
  if (typeof XMLHttpRequest !== "undefined") {
    var XO = XMLHttpRequest.prototype;
    var origOpen = XO.open, origSend = XO.send, origSetHeader = XO.setRequestHeader;
    XO.open = function (method, url) { this.__ps = { method: String(method).toUpperCase(), url: String(url), headers: {} }; return origOpen.apply(this, arguments); };
    XO.setRequestHeader = function (k, v) { if (this.__ps) this.__ps.headers[k] = v; return origSetHeader.apply(this, arguments); };
    XO.send = function (body) {
      var meta = this.__ps, xhr = this;
      if (meta) {
        var bodyText = bodyToText(body);
        xhr.addEventListener("loadend", function () {
          try {
            var ct = xhr.getResponseHeader("content-type") || "";
            var text = null;
            if ((xhr.responseType === "" || xhr.responseType === "text") && readable(ct)) text = xhr.responseText;
            noteActivity(meta.method, xhr.status, meta.url);
            keep({ kind: "xhr", method: meta.method, headers: meta.headers, status: xhr.status, contentType: ct }, meta.url, bodyText, text);
          } catch (e) { /* never break the page */ }
        });
      }
      return origSend.apply(this, arguments);
    };
    restore.push(function () { XO.open = origOpen; XO.send = origSend; XO.setRequestHeader = origSetHeader; });
  }

  // form posts (these navigate the page, so fetch/XHR never see them)
  function onSubmit(e) {
    try {
      var f = e.target, pairs = [], any = hit(f.action);
      var fd = new FormData(f);
      fd.forEach(function (v, k) { var val = typeof v === "string" ? v : "[file]"; if (hit(val)) any = true; pairs.push(encodeURIComponent(k) + "=" + encodeURIComponent(val)); });
      if (any && state.records.length < MAX_RECORDS) {
        state.records.push({
          t: now(), kind: "form", method: String(f.method || "get").toUpperCase(), url: maskUrl(f.action || location.href),
          requestHeaders: {}, requestBody: clip(maskForm(pairs.join("&")), MAX_BODY), status: null, contentType: "",
          response: "[the page navigates; see pageLoads]",
        });
      }
      saveNow();
    } catch (err) { /* ignore */ }
  }
  document.addEventListener("submit", onSubmit, true);
  restore.push(function () { document.removeEventListener("submit", onSubmit, true); });

  // what the user does in the page (clicks, typing, Enter): compact element descriptions
  function selectorOf(el) {
    var parts = [];
    for (var n = 0; el && el.nodeType === 1 && n < 4; n++, el = el.parentElement) {
      var tag = String(el.tagName || "").toLowerCase();
      if (el.id && !/\d{4,}/.test(el.id)) { parts.unshift(tag + "#" + el.id); break; }
      var cls = String(typeof el.className === "string" ? el.className : "").split(/\s+/)
        .filter(function (c) { return c && c.length <= 30; }).slice(0, 2);
      parts.unshift(tag + (cls.length ? "." + cls.join(".") : ""));
    }
    return parts.join(" > ");
  }
  // Saved-address cards, account menus and profile widgets show names, addresses and phone numbers
  // as plain text, so their text is not recorded.
  var personalBoxRe = /address|account|profile|user|customer|contact/i;
  function inPersonalBox(el) {
    for (var n = 0; el && el.nodeType === 1 && n < 6; n++, el = el.parentElement) {
      var idc = String(el.id || "") + " " + String(typeof el.className === "string" ? el.className : "");
      if (personalBoxRe.test(idc)) return true;
    }
    return false;
  }
  function describe(el) {
    if (!el || el.nodeType !== 1) return null;
    var d = { tag: String(el.tagName || "").toLowerCase(), sel: selectorOf(el) }, personal = inPersonalBox(el);
    ["id", "name", "type", "placeholder", "role", "aria-label", "data-testid", "data-test", "data-qa", "href"].forEach(function (a) {
      var v = el.getAttribute && el.getAttribute(a);
      if (!v) return;
      if (a === "aria-label" && personal) v = "[" + v.length + " chars, personal area]";
      d[a] = clip(a === "href" ? maskUrl(v) : scrub(v), 80);
    });
    var tx = String(el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
    if (tx && tx.length <= 60) d.text = personal ? "[" + tx.length + " chars, personal area]" : scrub(tx);
    return d;
  }
  // A typed value is kept only when it is one of the watched values itself (the pincode, usually);
  // anything longer, such as a full address that ends in the pincode, is described, not copied.
  function valueOf(el) {
    var v = el && el.value;
    if (v == null || v === "") return "";
    if (el.type === "password") return "[hidden]";
    v = String(v);
    if (state.markers.indexOf(v.trim()) !== -1) return v.trim();
    return "[" + v.length + " chars" + (hit(v) ? ", contains the pincode" : "") + "]";
  }
  function addStep(ev, el, extra) {
    try {
      if (state.steps.length >= MAX_STEPS) return;
      var target = (ev === "click" && el.closest) ? (el.closest("button,a,input,select,textarea,label,[role=button],[role=option],[role=menuitem],li") || el) : el;
      var step = { t: now(), ev: ev, target: describe(target) };
      if (extra) Object.keys(extra).forEach(function (k) { step[k] = extra[k]; });
      var last = state.steps[state.steps.length - 1];
      if (ev === "input" && last && last.ev === "input" && last.target && step.target && last.target.sel === step.target.sel) {
        state.steps[state.steps.length - 1] = step;          // typing: keep only the latest state of the field
      } else {
        state.steps.push(step);
      }
      saveSoon();
    } catch (e) { /* ignore */ }
  }
  var onClick = function (e) { addStep("click", e.target); };
  var onInput = function (e) { addStep("input", e.target, { value: valueOf(e.target) }); };
  var onChange = function (e) { addStep("change", e.target, { value: valueOf(e.target) }); };
  var onKey = function (e) { if (e.key === "Enter") addStep("enter", e.target, { value: valueOf(e.target) }); };
  document.addEventListener("click", onClick, true);
  document.addEventListener("input", onInput, true);
  document.addEventListener("change", onChange, true);
  document.addEventListener("keydown", onKey, true);
  restore.push(function () {
    document.removeEventListener("click", onClick, true); document.removeEventListener("input", onInput, true);
    document.removeEventListener("change", onChange, true); document.removeEventListener("keydown", onKey, true);
  });

  // localStorage / sessionStorage writes that involve the pincode
  var storageKind = function (s) {
    try { if (s === window.localStorage) return "localStorage"; if (s === window.sessionStorage) return "sessionStorage"; } catch (e) { /* ignore */ }
    return "storage";
  };
  STG.setItem = function (k, v) {
    try {
      if (!(k === KEY && this === window.sessionStorage)) {
        var val = String(v);
        if (hit(k) || hit(val)) addHint("storage", storageKind(this) + ".setItem(" + k + ") = " + (sensitiveKey(k) ? "[masked]" : cleanAny(val)));
      }
    } catch (e) { /* ignore */ }
    return origSet.apply(this, arguments);
  };
  restore.push(function () { STG.setItem = origSet; });

  // cookie writes that involve the pincode
  try {
    var cookieDesc = typeof Document !== "undefined" ? Object.getOwnPropertyDescriptor(Document.prototype, "cookie") : null;
    if (cookieDesc && cookieDesc.configurable && cookieDesc.get && cookieDesc.set) {
      Object.defineProperty(document, "cookie", {
        configurable: true,
        get: function () { return cookieDesc.get.call(document); },
        set: function (v) {
          try {
            if (hit(v)) {
              var kv = String(v).split(";")[0], eq = kv.indexOf("="), ck = eq < 0 ? kv : kv.slice(0, eq).trim();
              addHint("cookie", ck + "=" + (eq < 0 ? "" : sensitiveKey(ck) ? "[masked]" : cleanAny(kv.slice(eq + 1))));
            }
          } catch (e) { /* ignore */ }
          return cookieDesc.set.call(document, v);
        },
      });
      restore.push(function () { try { delete document.cookie; } catch (e) { /* ignore */ } });
    }
  } catch (e) { /* ignore */ }

  // resource timing: sees URLs even if a store used a reference to fetch that we could not wrap
  var observer = null;
  try {
    if (typeof PerformanceObserver !== "undefined") {
      observer = new PerformanceObserver(function (list) {
        list.getEntries().forEach(function (e) {
          if (state.resources.length < MAX_RESOURCES && hit(e.name)) {
            state.resources.push({ t: now(), initiator: e.initiatorType, url: clip(maskUrl(e.name), 300) });
            saveSoon();
          }
        });
      });
      observer.observe({ type: "resource", buffered: true });
    }
  } catch (e) { observer = null; }

  // page loads
  var navType = "";
  try { var nav = performance.getEntriesByType("navigation")[0]; navType = nav ? nav.type : ""; } catch (e) { /* ignore */ }
  state.pages.push({ t: now(), url: location.origin + location.pathname, load: navType || "unknown" });
  saveNow();

  // ---- where do the values in the requests live in the page's state? -------------------
  // Some stores build their request from product data held in JavaScript (SKU ids, warehouses,
  // prices). This finds the paths of those values so an adapter knows where to read them.
  function locateState() {
    try {
      var targets = {}, count = 0;
      function leaf(v) {
        if (v === null || typeof v === "boolean" || count >= 30) return;
        if (typeof v === "object") { Object.keys(v).forEach(function (k) { leaf(v[k]); }); return; }
        var t = String(v);
        if (t.length < 4 || t.length > 40 || t === state.markers[0] || /^\d{13}$/.test(t) || /…/.test(t) || targets[t]) return;
        targets[t] = true; count++;
      }
      state.records.forEach(function (r) {
        if (r.kind === "form") return;
        try { leaf(JSON.parse(r.requestBody)); } catch (e) { /* not JSON */ }
      });
      if (!count) return [];

      var base = {};
      try {
        var f = document.createElement("iframe");
        document.body.appendChild(f);
        Object.keys(f.contentWindow).forEach(function (k) { base[k] = 1; });
        f.parentNode && f.parentNode.removeChild(f);
      } catch (e) { /* no baseline: walk everything */ }

      var hits = [], seen = new WeakSet(), nodes = 0, t0 = Date.now();
      function walk(v, path, depth) {
        if (hits.length >= 50 || nodes++ > 150000 || depth > 8 || v === null || v === undefined || Date.now() - t0 > 900) return;
        if (typeof v === "object") {
          if (typeof Node !== "undefined" && v instanceof Node) return;
          if (seen.has(v)) return;
          seen.add(v);
          var keys; try { keys = Object.keys(v); } catch (e) { return; }
          for (var i = 0; i < keys.length && i < 400; i++) {
            var c; try { c = v[keys[i]]; } catch (e) { continue; }
            walk(c, path + (Array.isArray(v) ? "[" + keys[i] + "]" : "." + keys[i]), depth + 1);
          }
        } else if (targets[String(v)]) {
          hits.push(path + " = " + String(v));
        }
      }
      Object.keys(window).forEach(function (k) { if (!base[k]) walk(window[k], "window." + k, 0); });
      try {
        Array.prototype.forEach.call(document.querySelectorAll("script"), function (sc, i) {
          var text = sc.textContent || "";
          if (text.length > 200) Object.keys(targets).some(function (tv) {
            if (hits.length < 50 && text.indexOf(tv) !== -1) { hits.push("<script #" + i + (sc.id ? " id=" + sc.id : "") + "> contains " + tv); return true; }
            return false;
          });
        });
      } catch (e) { /* ignore */ }
      return hits;
    } catch (e) { return []; }
  }

  // ---- finishing ----------------------------------------------------------------------
  function build() {
    var recorded = {};
    state.records.forEach(function (r) { recorded[r.url] = true; });
    var resources = state.resources.map(function (r) {
      var seen = recorded[r.url] === true;
      return { t: r.t, initiator: r.initiator, url: r.url, seenByHooks: seen };
    });
    var out = {
      store: location.hostname,
      page: location.origin + location.pathname,   // query string dropped on purpose
      marker: state.markers[0],
      // coordinates can be a saved home address: about 1 km is plenty to tell what was learned
      learnedMarkers: state.markers.slice(1).map(function (v) { return /^-?\d+\.\d+$/.test(v) ? Number(v).toFixed(2) : v; }),
      seconds: Math.round((Date.now() - state.startedAt) / 1000),
      count: state.records.length,
      records: state.records,
      hints: state.hints,
      pageLoads: state.pages,
      resources: resources,
      activity: state.activity,
      steps: state.steps,
      stateHints: locateState(),
    };
    return finalScrub(out);
  }

  // Last pass over everything that is handed back, then a count of what was masked so the panel can
  // tell the user what to look for when they skim it.
  function finalScrub(out) {
    function walk(x, k) {
      if (typeof x === "string") return k === "marker" ? x : scrub(x);
      if (Array.isArray(x)) return x.map(function (i) { return walk(i); });
      if (x && typeof x === "object") { var o = {}; Object.keys(x).forEach(function (kk) { o[kk] = walk(x[kk], kk); }); return o; }
      return x;
    }
    out = walk(out);
    var json = JSON.stringify(out), count = function (re) { return (json.match(re) || []).length; };
    out.masked = {
      secretsOrFields: count(/\[masked\]|%5Bmasked%5D/g), emails: count(/\[email\]|%5Bemail%5D/g),
      phones: count(/\[phone\]|%5Bphone%5D/g), tokens: count(/\[(?:jwt|token)\]|%5B(?:jwt|token)%5D/g),
    };
    return out;
  }

  window.__pinscoutRecorder = {
    stop: function () {
      restore.forEach(function (fn) { try { fn(); } catch (e) { /* ignore */ } });
      try { if (observer) observer.disconnect(); } catch (e) { /* ignore */ }
      window.removeEventListener("pagehide", saveNow);
      window.removeEventListener("beforeunload", saveNow);
      var out = build();
      try { origRemove.call(window.sessionStorage, KEY); } catch (e) { /* ignore */ }
      delete window.__pinscoutRecorder;
      return out;
    },
    // masking helpers, exposed for tools/test_recorder_mask.js
    _mask: { clean: clean, maskUrl: maskUrl, maskHeaders: maskHeaders, describe: describe, valueOf: valueOf, cleanAny: cleanAny, finalScrub: finalScrub },
  };
})();
