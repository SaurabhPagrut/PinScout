/*
 * Store catalogue: the one list of stores PinScout knows about, loaded from
 * data/stores.json. An entry needs { id, name, hosts: ["example.in"] }.
 * Whether a store can actually be checked depends on whether an adapter with
 * the same id is registered (see adapters.js and lib/stores/).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Stores = factory();
})(typeof self !== "undefined" ? self : this, function () {
  let stores = [];

  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  function load(list) {
    stores = list.map((s) => ({
      ...s,
      // "https://" + optional subdomains + one of the store's hosts, and nothing
      // sneaky after it (so amazon.in.evil.com and evilamazon.in never match).
      _re: new RegExp("^https?://([a-z0-9-]+\\.)*(" + s.hosts.map(esc).join("|") + ")(?::\\d+)?(/|$|\\?|#)", "i"),
    }));
    return stores;
  }

  const all = () => stores.slice();
  const byId = (id) => stores.find((s) => s.id === id) || null;
  const forUrl = (url) => (url ? stores.find((s) => s._re.test(url)) || null : null);
  const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } };
  // Chrome match patterns that cover a store (apex + subdomains)
  const originPatterns = (s) => s.hosts.map((h) => `https://*.${h}/*`);

  return { load, all, byId, forUrl, hostOf, originPatterns };
});
