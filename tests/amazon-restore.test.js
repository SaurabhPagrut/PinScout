// The Amazon adapter changes the visitor's delivery pincode on every check, so it saves the original before a scan
// (begin), puts it back after (end), and keeps it in chrome.storage until it has been put back: a scan cut short by
// closing the panel is restored the next time the panel opens. Here the adapter runs in a sandbox with a stand-in
// chrome.* whose "page" is a fake Amazon session; the page's own requests are covered by the adapter's notes.
const { test, assert } = require("./check.js");
const fs = require("fs"), path = require("path"), vm = require("vm");
const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const KEY = "amazonPendingRestore";

/* a fresh panel: the shared libs and amazon.js, with chrome.storage carried over from `stored` */
function panel({ stored = {}, zip = "400001", tabs = [{ id: 7, url: "https://www.amazon.in/dp/B0TEST" }], failSet = false } = {}) {
  const store = { ...stored }, session = { zip }, calls = [];
  const chrome = {
    storage: { local: {
      get: async (k) => (k in store ? { [k]: store[k] } : {}),
      set: async (o) => Object.assign(store, o),
      remove: async (k) => { delete store[k]; },
    } },
    tabs: {
      get: async (id) => { const t = tabs.find((t) => t.id === id); if (!t) throw new Error("No tab"); return t; },
      query: async () => tabs,
    },
    /* the page: amazonReadZip reads the session's pincode; amazonPageCheck(zip, true) sets it */
    scripting: { executeScript: async ({ target, func, args }) => {
      calls.push({ tab: target.tabId, fn: func.name, args });
      if (func.name === "amazonReadZip") return [{ result: { zip: session.zip } }];
      if (func.name === "amazonPageCheck" && args[1] === true) {
        if (failSet) return [{ result: { ok: false, httpStatus: 503 } }];
        session.zip = args[0]; return [{ result: { ok: true } }];
      }
      return [{ result: { ok: true, serviceable: false } }];
    } },
  };
  const ctx = { console, URL, Promise, setTimeout, chrome };
  ctx.self = ctx; vm.createContext(ctx);
  for (const f of ["extension/lib/stores.js", "extension/lib/adapters.js", "extension/lib/stores/amazon.js"]) vm.runInContext(read(f), ctx, { filename: f });
  ctx.Stores.load(JSON.parse(read("extension/data/stores.json")));
  const a = ctx.Adapters.forUrl("https://www.amazon.in/dp/B0TEST");
  return { a, store, session, calls, idle: () => new Promise((r) => setTimeout(r, 10)) };
}

test("begin saves the visitor's pincode, end puts it back and forgets it", async () => {
  const p = panel(); await p.idle();
  const s = await p.a.begin(7);
  assert.equal(s.originalZip, "400001"); assert.deepEqual({ ...p.store[KEY] }, { zip: "400001", tabId: 7 });
  p.session.zip = "560001";                                   // what a check leaves behind
  await p.a.end(7, s);
  assert.equal(p.session.zip, "400001"); assert.equal(KEY in p.store, false);
});
test("a restore that fails keeps the pincode for later", async () => {
  const p = panel({ failSet: true }); await p.idle();
  const s = await p.a.begin(7); p.session.zip = "560001";
  await p.a.end(7, s);
  assert.equal(p.store[KEY].zip, "400001");
});
test("a scan cut short (panel closed) is restored when the panel opens again", async () => {
  const p = panel({ stored: { [KEY]: { zip: "400001", tabId: 7 } }, zip: "560001" }); await p.idle();
  assert.equal(p.session.zip, "400001"); assert.equal(KEY in p.store, false);
});
test("the restore on opening tries another Amazon tab when the scanned one is gone", async () => {
  const p = panel({ stored: { [KEY]: { zip: "400001", tabId: 99 } }, zip: "560001", tabs: [{ id: 8, url: "https://www.amazon.in/s?k=x" }] }); await p.idle();
  assert.equal(p.session.zip, "400001"); assert.equal(p.calls[0].tab, 8);
});
test("with no Amazon tab open, the pincode waits for next time", async () => {
  const p = panel({ stored: { [KEY]: { zip: "400001", tabId: 99 } }, tabs: [] }); await p.idle();
  assert.equal(p.store[KEY].zip, "400001");
});
test("a new scan before the restore keeps the original pincode, not the scanned one in the page", async () => {
  const p = panel({ stored: { [KEY]: { zip: "400001", tabId: 99 } }, zip: "560001", tabs: [] }); await p.idle();
  const s = await p.a.begin(7);
  assert.equal(s.originalZip, "400001"); assert.equal(p.calls.some((c) => c.fn === "amazonReadZip"), false);
  await p.a.end(7, s);
  assert.equal(p.session.zip, "400001"); assert.equal(KEY in p.store, false);
});
