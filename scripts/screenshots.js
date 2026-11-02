// The Chrome Web Store images, made from the real side panel: five 1280×800 screenshots and the two promo tiles, written
// to webstore/listing-images/. Each one is a page composed here (headline on the left, a pretend browser on the right)
// with the extension's own sidepanel.html in a frame, on a stand-in chrome.* (as in scripts/browse.js) whose store answers
// "not deliverable" until a chosen pincode: the scan, the results and the summary are the panel's own.
//   node scripts/screenshots.js                 all of them
//   node scripts/screenshots.js 1 5 marquee     some of them (a number, "marquee" or "small")
//   node scripts/screenshots.js --out .check/shots/store    somewhere else (to compare before replacing)
// The product and the results are an illustrative example (pincode 560001, Bengaluru); the store page is a neutral
// placeholder, so no store's branding appears in the listing. Run after any visible change to the panel.
// scripts/video.js and scripts/gif.js film the same page (stub, page and the example are exported).
const fs = require("fs"), path = require("path");
const { playwright, chrome, serve } = require("./browse.js");
const ROOT = path.join(__dirname, ".."), argv = process.argv.slice(2);
const outArg = argv.indexOf("--out"), OUT = outArg >= 0 ? path.resolve(argv[outArg + 1]) : path.join(ROOT, "webstore/listing-images");
const only = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--out");

const PRODUCT = "Noise-cancelling Wireless Headphones (Black)", HOME = "560001", FOUND = "560003", ETA = "Delivery by Fri, 10 Oct";
const STORE_URL = "https://www.flipkart.com/noise-cancelling-wireless-headphones/p/itm0000000000001?pid=ACCDEMO000000001";

/* the panel's chrome.*: a product tab, storage in memory, and a store that answers per pincode; pacing sped up
   For film (scripts/video.js, gif.js), cfg.virtual gives the panel a clock of its own: timers, animation frames,
   Date.now and performance.now stand still until the filming loop calls __tick(ms), so every frame is exact however
   long a frame takes to save (Playwright's fake clock doesn't reach into the panel's frame). cfg.pace: the panel's own
   pacing (1) or a part of it (0.5); cfg.answerMs: how long the store takes to answer; cfg.seed: a repeatable
   Math.random, so the scan's pauses are the same on every run. */
function stub(cfg) {
  if (!/sidepanel\.html/.test(location.pathname)) return;
  const tab = { id: 7, windowId: 1, index: 0, active: true, status: "complete", url: cfg.url, title: "Product page" }, store = {};
  const ev = () => ({ addListener() {}, removeListener() {}, hasListener: () => false });
  if (cfg.seed) {
    let a = cfg.seed;
    Math.random = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  /* the scan waits ~1 s between checks: 30 ms here, so a picture doesn't take minutes (the 20 s check timeout is kept) */
  const paced = (ms) => (ms >= 300 && ms <= 6000 ? (cfg.pace ? ms * cfg.pace : 30) : ms);
  if (cfg.virtual) {
    const realTimeout = window.setTimeout.bind(window), start = Date.parse("2026-10-08T10:00:00+05:30"), q = [];
    let now = 0, ids = 1;
    const add = (fn, ms, a, every) => { const id = ids++; q.push({ id, at: now + Math.max(0, +ms || 0), fn, a, every }); return id; };
    const clear = (id) => { const k = q.findIndex((x) => x.id === id); if (k >= 0) q.splice(k, 1); };
    window.setTimeout = (fn, ms, ...a) => add(fn, paced(+ms || 0), a);
    window.setInterval = (fn, ms, ...a) => add(fn, Math.max(1, +ms || 0), a, Math.max(1, +ms || 0));
    window.clearTimeout = window.clearInterval = clear;
    window.requestAnimationFrame = (fn) => add(() => fn(now), 16, []);
    window.cancelAnimationFrame = clear;
    performance.now = () => now;
    const RealDate = Date;
    window.Date = class extends RealDate { constructor(...a) { if (a.length) super(...a); else super(start + now); } static now() { return start + now; } };
    /* run every timer due in the next ms, in order, letting promises (and the store's answers) settle between them */
    window.__tick = async (ms) => {
      const end = now + ms;
      for (;;) {
        q.sort((x, y) => x.at - y.at || x.id - y.id);
        const t = q[0];
        if (!t || t.at > end) break;
        q.shift(); now = Math.max(now, t.at);
        if (t.every) { t.at += t.every; q.push(t); }
        try { t.fn(...t.a); } catch (e) { realTimeout(() => { throw e; }); }
        await new Promise((r) => realTimeout(r, 0));
      }
      now = end;
      await new Promise((r) => realTimeout(r, 0));
    };
  } else if (cfg.pace !== 1) { const st = window.setTimeout; window.setTimeout = (fn, ms, ...a) => st(fn, paced(ms), ...a); }
  let n = 0;
  const answer = (pin) => {
    n++;
    if (cfg.hangAt && n >= cfg.hangAt) return new Promise(() => {});           // "still checking" for a mid-scan picture
    const r = pin === cfg.found ? { ok: true, serviceable: true, title: cfg.product, eta: cfg.eta } : { ok: true, serviceable: false, title: cfg.product };
    return cfg.answerMs ? new Promise((res) => setTimeout(() => res(r), cfg.answerMs)) : r;
  };
  globalThis.chrome = {
    runtime: { getURL: (p) => "/extension/" + p.replace(/^\//, ""), id: "pinscout-stand-in", onMessage: ev() },
    tabs: { query: async () => [tab], get: async () => tab, getCurrent: async () => undefined, reload: async () => {}, onUpdated: ev(), onActivated: ev(), onRemoved: ev() },
    windows: { getCurrent: async () => ({ id: 1 }), onRemoved: ev() },
    storage: { local: { get: async (k) => typeof k === "string" ? (k in store ? { [k]: store[k] } : {}) : { ...store }, set: async (o) => { Object.assign(store, o); }, remove: async () => {} } },
    scripting: { executeScript: async ({ args }) => [{ result: await answer(args && args[0]) }], registerContentScripts: async () => {}, unregisterContentScripts: async () => {}, getRegisteredContentScripts: async () => [] },
    permissions: { request: async () => true, contains: async () => true },
    sidePanel: { close: async () => {} },
  };
}

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
/* "a *highlighted* part" → the yellow-to-teal words */
const head = (s) => esc(s).replace(/\*([^*]+)\*/g, '<span class="g">$1</span>');
function page({ w, h, eyebrow, title, body, steps, chips, url, base, win, big }) {
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&display=block" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0}
body{width:${w}px;height:${h}px;overflow:hidden;font-family:"Plus Jakarta Sans",system-ui,sans-serif;color:#fff;position:relative;
 background:radial-gradient(1200px 700px at -10% -20%,#7c3aed 0%,rgba(124,58,237,0) 55%),radial-gradient(700px 500px at 110% 110%,#0d9488 0%,rgba(13,148,136,0) 60%),linear-gradient(135deg,#3b1d8f,#24145e 45%,#1e1a52)}
body:before{content:"";position:absolute;inset:0;background-image:radial-gradient(rgba(255,255,255,.10) 1px,transparent 1.2px);background-size:24px 24px}
.ring{position:absolute;border:1.5px solid rgba(255,255,255,.10);border-radius:50%}
.left{position:absolute;left:${big ? 80 : 64}px;top:${big ? 72 : 70}px;width:${big ? 560 : 450}px}
.brand{display:flex;align-items:center;gap:12px;font-weight:700;font-size:24px}.brand img{width:44px;height:44px;border-radius:10px}
.eye{margin-top:${big ? 0 : 76}px;color:#5eead4;font-weight:700;letter-spacing:.12em;font-size:15px;text-transform:uppercase}
h1{margin-top:${eyebrow ? 12 : 44}px;font-size:${big ? 56 : 50}px;line-height:1.06;letter-spacing:-.02em;font-weight:800}
.g{background:linear-gradient(90deg,#fde68a,#5eead4);-webkit-background-clip:text;background-clip:text;color:transparent}
.body{margin-top:22px;font-size:${big ? 21 : 19}px;line-height:1.5;color:rgba(226,232,240,.88)}
.steps{margin-top:14px;display:grid;gap:12px}.steps div{display:flex;align-items:center;gap:14px;font-weight:600;font-size:17px}
.steps b{width:30px;height:30px;border-radius:50%;background:rgba(255,255,255,.12);display:grid;place-items:center;font-size:14px}
.chips{margin-top:26px;display:flex;flex-wrap:wrap;gap:8px}.chips span{border:1px solid rgba(255,255,255,.28);background:rgba(255,255,255,.10);border-radius:999px;padding:7px 14px;font-weight:600;font-size:16px}
.win{position:absolute;left:${win.x}px;top:${win.y}px;width:${win.w}px;height:${h - win.y + 20}px;background:#f3f4f7;border-radius:14px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.35)}
.bar{height:38px;background:#e9e9ef;display:flex;align-items:center;gap:8px;padding:0 14px}.bar i{width:11px;height:11px;border-radius:50%;display:block}
.url{margin-left:10px;flex:1;height:24px;border-radius:12px;background:#fff;color:#334155;font-size:13px;display:flex;align-items:center;padding:0 12px}
.site{position:absolute;left:22px;top:60px;height:400px;width:${win.w - 330 - 44}px}
.sk{background:#dfe1e8;border-radius:8px;position:absolute}.tag{position:absolute;border:2px dashed #b9bcc8;border-radius:8px;color:#9aa0ae;font-size:12.5px;font-weight:700;padding:4px 9px;line-height:1.2}
.panel{position:absolute;right:0;top:38px;width:330px;bottom:0;border-left:1px solid #dcdde5;overflow:hidden;background:#f6f6fc}
.panel iframe{border:0;width:412px;height:1000px;transform:scale(.8);transform-origin:0 0}
</style></head><body>
<div class="ring" style="left:-420px;top:-500px;width:1100px;height:1100px"></div>
<div class="left">
 <div class="brand"><img src="${base}/extension/icons/icon128.png" alt="">PinScout</div>
 ${eyebrow ? `<div class="eye">${esc(eyebrow)}</div>` : ""}
 <h1>${head(title)}</h1>
 <p class="body">${esc(body)}</p>
 ${steps ? `<div class="steps">${steps.map((s, i) => `<div><b>${i + 1}</b>${esc(s)}</div>`).join("")}</div>` : ""}
 ${chips ? `<div class="chips">${chips.map((c) => `<span>${esc(c)}</span>`).join("")}</div>` : ""}
</div>
<div class="win">
 <div class="bar"><i style="background:#ef5f57"></i><i style="background:#f4bd2f"></i><i style="background:#2ac940"></i><div class="url">${esc(url)}</div></div>
 <div class="site">
  <div class="sk" style="left:0;top:0;width:47%;height:250px"></div>
  <div class="sk" style="left:53%;top:0;width:42%;height:18px"></div><div class="sk" style="left:53%;top:28px;width:30%;height:18px"></div>
  <div class="sk" style="left:53%;top:68px;width:19%;height:28px"></div>
  <div class="sk" style="left:53%;top:118px;width:37%;height:14px"></div><div class="sk" style="left:53%;top:142px;width:33%;height:14px"></div>
  <div class="tag" style="left:53%;top:174px;width:47%">Not deliverable to ${HOME}</div>
  <div class="sk" style="left:53%;top:229px;width:22%;height:38px"></div><div class="sk" style="left:78%;top:229px;width:22%;height:38px"></div>
  <div class="sk" style="left:0;top:285px;width:47%;height:90px"></div><div class="sk" style="left:53%;top:285px;width:47%;height:90px"></div>
 </div>
 <div class="panel"><iframe src="${base}/extension/sidepanel.html"></iframe></div>
</div>
</body></html>`;
}

/* what the panel should be showing in each picture */
/* the nearby limit lives in the folded Settings, so it's set and announced the way a choice there would be */
const nearby = (f, cap) => f.evaluate((v) => { const s = document.getElementById("nearbyCap"); s.value = v; s.dispatchEvent(new Event("change", { bubbles: true })); }, cap);
const scan = (cap) => async (f) => { await nearby(f, cap); await f.fill("#pin", HOME); await f.click("#start"); };
const SHOTS = [
  { id: "1", file: "screenshot-1-find-where-it-is-available.png", w: 1280, h: 800, eyebrow: "Out of stock at your pincode?", title: "Find *where it isn’t.*",
    body: "PinScout checks your pincode, then nearby pincodes, your state and the rest of India, and stops at the nearest place it can be delivered.",
    steps: ["Open a product page", "Type your pincode", "Get the nearest deliverable pincode"], url: "product page on a supported store",
    set: scan("10"), until: (f) => f.waitForFunction(() => /Nearest place/.test(document.getElementById("summary").textContent), null, { timeout: 30000 }) },
  { id: "2", file: "screenshot-2-scans-for-you.png", w: 1280, h: 800, eyebrow: "No more trial and error", title: "Stop typing pincodes *one by one.*",
    body: "PinScout runs the store’s own delivery check for you, pincode after pincode, and shows every result live in the side panel while you keep browsing.",
    url: "product page on a supported store", hangAt: 6,
    set: scan("10"), until: (f) => f.waitForFunction(() => document.querySelectorAll("#log li:not(.tier)").length >= 5, null, { timeout: 30000 }) },
  { id: "3", file: "screenshot-3-choose-range.png", w: 1280, h: 800, eyebrow: "You choose the range", title: "Search as far as *you need.*",
    body: "Choose how far to search: just nearby, your whole state, or all of India, using India Post data for about 19,500 pincodes.",
    chips: ["Your pincode", "Nearby", "Your state", "All of India"], url: "product page on a supported store",
    set: async (f) => { await nearby(f, "10"); await f.fill("#pin", HOME); await f.dispatchEvent("#pin", "input"); await f.focus("#pin"); } },
  { id: "4", file: "screenshot-4-help-add-a-store.png", w: 1280, h: 800, eyebrow: "Your store missing?", title: "Teach PinScout *a new store.*",
    body: "Record how any shopping site checks delivery in a minute. Tokens and personal details are masked, and nothing is sent unless you email it yourself.",
    url: "product page on a store PinScout doesn’t support yet", tab: "https://www.newstore.in/p/12345",
    set: async (f) => {
      await nearby(f, "10"); await f.fill("#pin", HOME); await f.dispatchEvent("#pin", "input");
      await f.evaluate(() => { document.getElementById("recorder").open = true; });
      await f.fill("#recPin", "400001");
      /* an illustrative, already masked recording, shown the way the panel shows one after Stop & copy */
      await f.evaluate(() => {
        const set = (id, t) => { const e = document.getElementById(id); if (e) e.textContent = t; };
        set("recStatus", "Copied 3 requests carrying 400001 from www.newstore.in. Press “Send by email” and paste it in. Skim it first: tokens are masked, but check nothing personal is in there.");
        set("recSummary", "3 matching requests · 41 other calls · 12 values masked");
        const box = document.getElementById("recBox"); if (box) box.hidden = false;
        const out = document.getElementById("recOut");
        if (out) out.value = JSON.stringify({ store: "www.newstore.in", marker: "400001", count: 3, requests: [{ method: "POST", url: "https://www.newstore.in/api/delivery/check", requestBody: "{\"pincode\":\"400001\",\"sku\":\"[token]\"}", status: 200, response: "{\"deliverable\":false,\"pincode\":\"400001\"}" }] }, null, 2);
        set("recAddr", "getsaurabhpagrut@gmail.com");
      });
    } },
  { id: "5", file: "screenshot-5-private.png", w: 1280, h: 800, eyebrow: "Private by design", title: "No account. No server. *No tracking.*",
    body: "Checks go straight from your browser to the store you’re on. Only your home pincode is saved, on your device.",
    chips: ["Free", "No sign-up", "No ads"], url: "product page on a supported store",
    set: scan("10"), until: (f) => f.waitForFunction(() => /Nearest place/.test(document.getElementById("summary").textContent), null, { timeout: 30000 }) },
  { id: "marquee", file: "marquee-promo-tile-1400x560.png", w: 1400, h: 560, big: true, title: "Out of stock at your pincode? *Find where it isn’t.*",
    body: "Scans nearby pincodes, your state and all of India on the store’s own delivery check.",
    chips: ["Free", "No sign-up", "No ads", "Runs in the side panel"], url: "product page on a supported store", win: { x: 700, y: 60, w: 640 },
    set: scan("10"), until: (f) => f.waitForFunction(() => /Nearest place/.test(document.getElementById("summary").textContent), null, { timeout: 30000 }) },
];

/* the small tile: no panel, just the mark and the line */
const small = (base) => `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;700;800&display=block" rel="stylesheet">
<style>*{margin:0;box-sizing:border-box}body{width:440px;height:280px;overflow:hidden;position:relative;color:#fff;font-family:"Plus Jakarta Sans",system-ui,sans-serif;
background:radial-gradient(420px 300px at -10% -10%,#7c3aed,rgba(124,58,237,0) 60%),radial-gradient(360px 260px at 110% 110%,#0d9488,rgba(13,148,136,0) 60%),linear-gradient(135deg,#3b1d8f,#24145e 50%,#1e1a52)}
.ring{position:absolute;border:1.5px solid rgba(255,255,255,.12);border-radius:50%}
img{position:absolute;right:30px;top:30px;width:96px;height:96px;border-radius:22px;box-shadow:0 12px 30px rgba(0,0,0,.35)}
.t{position:absolute;left:28px;bottom:30px}.n{font-weight:800;font-size:20px}h1{font-size:30px;line-height:1.08;font-weight:800;letter-spacing:-.02em;margin-top:6px}
.g{background:linear-gradient(90deg,#fde68a,#5eead4);-webkit-background-clip:text;background-clip:text;color:transparent}p{margin-top:10px;font-size:14px;color:rgba(226,232,240,.9)}</style></head>
<body><div class="ring" style="right:-60px;top:-90px;width:300px;height:300px"></div><div class="ring" style="right:-20px;top:-50px;width:220px;height:220px"></div>
<img src="${base}/extension/icons/icon128.png" alt=""><div class="t"><div class="n">PinScout</div><h1>Out of stock?<br><span class="g">Find where it isn’t.</span></h1><p>Delivery check across India’s pincodes</p></div></body></html>`;

module.exports = { stub, page, PRODUCT, HOME, FOUND, ETA, STORE_URL };

if (require.main === module) (async () => {
  const want = (id) => !only.length || only.includes(id);
  fs.mkdirSync(OUT, { recursive: true });
  const { chromium } = playwright(), srv = await serve(), browser = await chromium.launch({ executablePath: chrome() });
  let bad = 0;
  try {
    for (const s of SHOTS.filter((s) => want(s.id))) {
      const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: 1, colorScheme: "light", reducedMotion: "no-preference" });
      await ctx.addInitScript(stub, { url: s.tab || STORE_URL, found: FOUND, eta: ETA, product: PRODUCT, hangAt: s.hangAt || 0 });
      const pg = await ctx.newPage(), errs = [];
      pg.on("pageerror", (e) => errs.push(e.message));
      await pg.setContent(page({ ...s, base: srv.base, win: s.win || { x: 548, y: 70, w: 672 } }), { waitUntil: "networkidle" });
      const f = pg.frames().find((fr) => /sidepanel\.html/.test(fr.url()));
      await f.waitForFunction(() => /pincodes loaded/.test(document.getElementById("dataInfo")?.textContent || ""), null, { timeout: 15000 });
      if (s.set) await s.set(f);
      if (s.until) await s.until(f);
      await pg.evaluate(() => document.fonts.ready); await pg.waitForTimeout(400);
      const file = path.join(OUT, s.file); await pg.screenshot({ path: file });
      console.log(`${errs.length ? "FAIL" : "ok  "} ${s.id.padEnd(7)} ${path.relative(ROOT, file)} ${s.w}×${s.h}${errs.length ? " · ERRORS: " + errs.join(" | ") : ""}`);
      if (errs.length) bad++;
      await ctx.close();
    }
    if (want("small")) {
      const ctx = await browser.newContext({ viewport: { width: 440, height: 280 }, deviceScaleFactor: 1 }), pg = await ctx.newPage();
      await pg.setContent(small(srv.base), { waitUntil: "networkidle" }); await pg.evaluate(() => document.fonts.ready);
      const file = path.join(OUT, "small-promo-tile-440x280.png"); await pg.screenshot({ path: file });
      console.log(`ok   small   ${path.relative(ROOT, file)} 440×280`); await ctx.close();
    }
  } finally { await browser.close(); srv.stop(); }
  process.exit(bad ? 1 : 0);
})();
