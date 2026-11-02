// The sandbox store page for adapter fixtures, shared by tests/adapters.test.js and tools/make-fixture.js: the real
// lib/stores.js, lib/adapters.js and lib/stores/<id>.js run in a fresh page whose fetch() answers from the fixture's
// "responses" in order, and check() returns the verdict that reaches the scanner (Adapters.forUrl(url).check → interpret).
const fs = require("fs"), path = require("path"), vm = require("vm");
const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const SHARED = ["extension/lib/stores.js", "extension/lib/adapters.js"].map((f) => [f, read(f)]);
const STORES = JSON.parse(read("extension/data/stores.json"));

function page(fx, storeId) {
  const queue = [...fx.responses], requests = [];
  const ctx = {
    console, URL, URLSearchParams, JSON, Promise, setTimeout, clearTimeout, TextEncoder, TextDecoder,
    navigator: { userAgent: "Mozilla/5.0 (PinScout fixture test)" },
    location: new URL(fx.url),
    document: {
      title: fx.title || "", cookie: fx.cookie || "",
      querySelector: (sel) => sel === "h1" && fx.h1 ? { textContent: fx.h1, innerText: fx.h1 } : null,
      querySelectorAll: () => [],
    },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    async fetch(input, init = {}) {
      const u = new URL(typeof input === "string" ? input : input.url, fx.url), body = init.body == null ? "" : String(init.body);
      requests.push({ host: u.hostname, path: u.pathname, method: (init.method || "GET").toUpperCase(), body });
      const r = queue.shift();
      if (!r) throw new Error(`unexpected request ${u.hostname}${u.pathname} (no response left in the fixture)`);
      if (r.host && r.host !== u.hostname) throw new Error(`request went to ${u.hostname}, the fixture expected ${r.host}`);
      if (r.path && r.path !== u.pathname) throw new Error(`request went to ${u.pathname}, the fixture expected ${r.path}`);
      const text = r.text !== undefined ? r.text : JSON.stringify(r.json);
      return { status: r.status, ok: r.status >= 200 && r.status < 300, headers: { get: () => null }, url: u.href,
        text: async () => text, json: async () => JSON.parse(text) };
    },
  };
  ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
  /* executeScript runs the adapter's page function inside this page, as Chrome does in the MAIN world */
  ctx.chrome = { scripting: { executeScript: async ({ func, args }) => [{ result: await func(...(args || [])) }] } };
  vm.createContext(ctx);
  for (const [f, src] of SHARED) vm.runInContext(src, ctx, { filename: f });
  ctx.Stores.load(STORES);
  const file = `extension/lib/stores/${storeId}.js`;
  vm.runInContext(read(file), ctx, { filename: file });
  return { ctx, requests, left: queue };
}

/* the verdict for a fixture, with the requests the adapter made and the responses it never asked for */
async function check(fx, storeId) {
  const { ctx, requests, left } = page(fx, storeId);
  const a = ctx.Adapters.forUrl(fx.url);
  if (!a) throw new Error(`no adapter for ${fx.url}`);
  if (a.id !== storeId) throw new Error(`${fx.url} is handled by ${a.id}, not ${storeId}`);
  return { verdict: await a.check(7, fx.pincode), requests, left };
}

module.exports = { check };
