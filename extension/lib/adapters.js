/*
 * Adapter core: turns "a store" into "something the scanner can call".
 *
 * A store adapter lives in lib/stores/<id>.js and registers itself:
 *
 *   Adapters.register({
 *     id: "flipkart",                 // must match an entry in data/stores.json
 *     pageCheck: async (pincode) => …  // runs INSIDE the store's page (see below)
 *   });
 *
 * pageCheck runs in the page (MAIN world), so it uses the visitor's own
 * cookies and headers. It must be fully self-contained (Chrome serializes it)
 * and return one of:
 *
 *   { ok: true,  serviceable: boolean, soldOut?: boolean, soldOutEverywhere?: boolean, stock?: string, title?: string, eta?: string }
 *   { ok: false, httpStatus?: number, error?: string, preview?: string }
 *
 * Everything else is shared here: finding the right adapter for a tab,
 * running the function, and the standard verdicts, including stopping a scan
 * when a store starts throttling (HTTP 401/403/429).
 *
 * Optional per-adapter hooks:
 *   begin(tabId) -> state    called before a scan
 *   end(tabId, state)        called after it (e.g. restore a saved delivery location)
 *   check(tabId, pincode)    replace the default flow entirely
 */
(function (root) {
  const impl = new Map();
  const FATAL = new Set([401, 403, 429]);

  async function runInPage(tabId, func, args = []) {
    const out = await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", args, func });
    return out?.[0]?.result;
  }

  function interpret(store, pincode, raw) {
    if (!raw) return { status: "error", pincode, message: "No response from the page." };
    if (!raw.ok) {
      const code = raw.httpStatus;
      const fatal = FATAL.has(code);
      return {
        status: "error", pincode, httpStatus: code, fatal,
        message: fatal
          ? `${store.name} answered HTTP ${code} (throttling or blocking). Stopped to protect your session; try again later.`
          : `HTTP ${code ?? "?"}: ${raw.error || raw.preview || "request failed"}`.trim(),
      };
    }
    const available = raw.serviceable === true && !raw.soldOut;
    return {
      status: available ? "available" : "unavailable",
      pincode, title: raw.title || "", stock: raw.stock || "", sla: raw.eta || "",
      // The adapter knows the item has no stock anywhere (not just here): the scanner stops early.
      soldOutEverywhere: raw.soldOutEverywhere === true,
    };
  }

  function register(def) {
    if (!def || !def.id) throw new Error("An adapter needs an id.");
    if (typeof def.check !== "function" && typeof def.pageCheck !== "function") {
      throw new Error(`Adapter "${def.id}" needs pageCheck() or check().`);
    }
    impl.set(def.id, def);
  }

  // Store entry + adapter, or null when the URL isn't a store we can check yet.
  function forUrl(url) {
    const store = root.Stores.forUrl(url);
    const a = store && impl.get(store.id);
    if (!a) return null;
    return {
      ...store,
      begin: a.begin, end: a.end,
      async check(tabId, pincode) {
        if (a.check) return a.check(tabId, pincode);
        try {
          return interpret(store, pincode, await runInPage(tabId, a.pageCheck, [pincode]));
        } catch (e) {
          return { status: "error", pincode, message: e?.message || String(e) };
        }
      },
    };
  }

  const implemented = () => root.Stores.all().filter((s) => impl.has(s.id));

  root.Adapters = { register, forUrl, implemented, interpret, runInPage };
})(typeof self !== "undefined" ? self : this);
