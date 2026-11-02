// Check the website or the side panel in a real browser and print one line per check; screenshots go to .check/shots/.
//   node scripts/browse.js shot /                 --widths 1280,390 --theme dark --at "#stores"    a website page
//   node scripts/browse.js shot panel             --widths 420 --url "https://www.croma.com/p/1"   the side panel, on a pretend product tab
//   node scripts/browse.js eval /about "document.title"                                            any expression (a Promise is awaited)
//   node scripts/browse.js eval panel "document.querySelector('#retailer').textContent"
// Options: --js "<code>" sets the page up first (type a pincode, press a button; await works); --wait <ms> after load (default 600).
// Every check reports sideways scroll, page errors and console errors (a CSP block shows here), and requests that left
// localhost: the website and the panel must make none. The website is rebuilt first when site/, PRIVACY.md or
// stores.json are newer than dist/site/ and served with the CSP from site/_headers, like Cloudflare Pages.
// The panel runs outside the extension: chrome.* is a stand-in (a product tab at --url, storage in memory,
// executeScript answers "not deliverable"), so this checks layout and text, not real store checks.
// The browser: $PINSCOUT_CHROME, else a Playwright Chromium in the cache, else Google Chrome. playwright-core is installed
// into .check/pw on first use.
const fs = require("fs"), path = require("path"), os = require("os"), http = require("http"), { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, ".."), OUT = path.join(ROOT, ".check"), SHOTS = path.join(OUT, "shots"), SITE = path.join(ROOT, "dist/site");
const argv = process.argv.slice(2), val = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const VALUED = ["--widths", "--theme", "--at", "--wait", "--url", "--js", "--width"], pos = argv.filter((a, i) => !a.startsWith("--") && !VALUED.includes(argv[i - 1]));

function playwright() {
  const local = path.join(OUT, "pw", "node_modules", "playwright-core");
  for (const p of [path.join(ROOT, "node_modules", "playwright-core"), local]) if (fs.existsSync(p)) return require(p);
  console.log("installing playwright-core into .check/pw (once)…"); fs.mkdirSync(path.join(OUT, "pw"), { recursive: true });
  const r = spawnSync("npm", ["i", "--prefix", path.join(OUT, "pw"), "playwright-core@1.55.0", "--no-audit", "--no-fund", "--silent"], { stdio: "inherit" });
  if (r.status !== 0) { console.error("Couldn't install playwright-core"); process.exit(1); }
  return require(local);
}
function chrome() {
  if (process.env.PINSCOUT_CHROME) return process.env.PINSCOUT_CHROME;
  const H = os.homedir(), c = [];
  for (const dir of [path.join(H, "Library/Caches/ms-playwright"), path.join(H, ".cache/ms-playwright")]) if (fs.existsSync(dir))
    for (const d of fs.readdirSync(dir).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse())
      for (const sub of ["chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing", "chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
        "chrome-mac/Chromium.app/Contents/MacOS/Chromium", "chrome-linux64/chrome", "chrome-linux/chrome"]) c.push(path.join(dir, d, sub));
  c.push("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser");
  const f = c.find((p) => fs.existsSync(p));
  if (!f) { console.error("No Chromium found: set PINSCOUT_CHROME, or run npx playwright install chromium"); process.exit(1); }
  return f;
}

/* the website is built from site/, PRIVACY.md, the store list and the images: rebuild when one is newer (otherwise this checks old pages) */
function freshSite() {
  const mt = (f) => { try { return fs.statSync(path.join(ROOT, f)).mtimeMs; } catch { return 0; } }, built = mt("dist/site/index.html");
  const src = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "site", "PRIVACY.md", "scripts/site.mjs", "extension/data/stores.json", "extension/data/pincodes.json", "extension/lib/planner.js", "extension/icons", "webstore/listing-images"], { cwd: ROOT, encoding: "utf8" }).stdout.split("\n").filter(Boolean);
  const newer = built ? src.filter((f) => mt(f) > built) : ["(no build)"];
  if (!newer.length) return;
  console.log(`${newer.slice(0, 3).join(", ")}${newer.length > 3 ? "…" : ""} newer than dist/site: building`);
  const r = spawnSync(process.execPath, ["scripts/site.mjs"], { cwd: ROOT, encoding: "utf8" });
  if (r.status !== 0) { console.error("site build failed:\n" + ((r.stderr || "") + (r.stdout || "")).trim().split("\n").slice(-10).join("\n")); process.exit(1); }
}
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
/* one server: /extension/… from the repo (the panel), everything else from dist/site with Cloudflare's pretty URLs and the CSP */
function serve() {
  const csp = (fs.readFileSync(path.join(ROOT, "site/_headers"), "utf8").match(/Content-Security-Policy:\s*(.+)/) || [])[1];
  const srv = http.createServer((req, res) => {
    const u = decodeURIComponent(new URL(req.url, "http://x").pathname), panel = u.startsWith("/extension/");
    let f = panel ? path.join(ROOT, u) : path.join(SITE, u);
    if (!panel && fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, "index.html");
    if (!panel && !fs.existsSync(f) && fs.existsSync(f + ".html")) f += ".html";
    const ok = f.startsWith(panel ? path.join(ROOT, "extension") : SITE) && fs.existsSync(f) && fs.statSync(f).isFile();
    if (!ok && !panel) f = path.join(SITE, "404.html");
    if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(ok ? 200 : 404, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream", ...(!panel && csp ? { "Content-Security-Policy": csp } : {}) });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((res) => srv.listen(0, () => res({ base: `http://localhost:${srv.address().port}`, stop: () => srv.close() })));
}

/* chrome.* for the panel outside the extension (runs before the panel's scripts) */
function stub(url) {
  const tab = { id: 7, windowId: 1, index: 0, active: true, url, title: "Product page" }, store = {};
  const ev = () => ({ addListener() {}, removeListener() {}, hasListener: () => false });
  globalThis.chrome = {
    runtime: { getURL: (p) => "/extension/" + p.replace(/^\//, ""), id: "pinscout-stand-in", lastError: undefined, onMessage: ev() },
    tabs: { query: async () => [tab], get: async () => tab, getCurrent: async () => undefined, reload: async () => {}, create: async () => tab, update: async () => tab, onUpdated: ev(), onActivated: ev(), onRemoved: ev() },
    windows: { getCurrent: async () => ({ id: 1 }), update: async () => ({}), create: async () => ({ id: 2 }), onRemoved: ev() },
    storage: { local: { get: async (k) => typeof k === "string" ? (k in store ? { [k]: store[k] } : {}) : { ...store }, set: async (o) => { Object.assign(store, o); }, remove: async (k) => { delete store[k]; } } },
    scripting: { executeScript: async () => [{ result: { ok: true, serviceable: false } }], registerContentScripts: async () => {}, unregisterContentScripts: async () => {}, getRegisteredContentScripts: async () => [] },
    permissions: { request: async () => true, contains: async () => true },
    sidePanel: { close: async () => {}, setPanelBehavior: async () => {} },
  };
}

(async () => {
  const cmd = pos[0];
  if (!["shot", "eval"].includes(cmd)) { console.log(fs.readFileSync(__filename, "utf8").split("\n").filter((l) => l.startsWith("//")).map((l) => l.slice(3)).join("\n")); return; }
  const target = pos[1] || "/", isPanel = target === "panel";
  if (!isPanel) freshSite();
  const { chromium } = playwright(), srv = await serve(), browser = await chromium.launch({ executablePath: chrome() }); let bad = 0;
  async function open(w = 1280, theme) {
    const ctx = await browser.newContext({ viewport: { width: w, height: w < 600 ? 844 : 900 }, isMobile: w < 600 && !isPanel, hasTouch: w < 600, deviceScaleFactor: w < 600 ? 2 : 1, colorScheme: theme || "light" });
    if (isPanel) await ctx.addInitScript(stub, val("--url", "https://www.flipkart.com/apple-iphone-15-black-128-gb/p/itm6ac6485515ae4?pid=MOBGTAGPTB3VS24W"));
    const pg = await ctx.newPage(), errs = [], ext = [];
    pg.on("pageerror", (e) => errs.push(e.message.slice(0, 160)));
    /* a console error that only says a resource failed is reported by the response handler below, with its address */
    pg.on("console", (m) => { if (m.type() === "error" && !/^Failed to load resource/.test(m.text())) errs.push(m.text().slice(0, 160)); });
    pg.on("response", (r) => { if (r.status() >= 400 && r.request().resourceType() !== "document") errs.push(`${r.status()} ${new URL(r.url()).pathname}`); });
    pg.on("request", (r) => { try { const h = new URL(r.url()).hostname; if (h !== "localhost" && !r.url().startsWith("data:")) ext.push(h); } catch {} });
    const resp = await pg.goto(srv.base + (isPanel ? "/extension/sidepanel.html" : target), { waitUntil: "load" });
    if (resp && resp.status() >= 400) console.log(`  ${target} answers ${resp.status()} (the 404 page)`);
    await pg.waitForTimeout(+val("--wait", 600));
    /* --js may use await (it runs as the body of an async function) */
    if (val("--js")) { await pg.evaluate(async (e) => { await (0, eval)(`(async () => {\n${e}\n})()`); }, val("--js")); await pg.waitForTimeout(300); }
    return { pg, ctx, errs, ext };
  }
  const tail = (errs, ext) => { const p = []; if (errs.length) { bad++; p.push(`ERRORS: ${[...new Set(errs)].join(" | ")}`); } if (ext.length) { bad++; p.push(`OUTSIDE REQUESTS: ${[...new Set(ext)].join(", ")}`); } return p.length ? " · " + p.join(" · ") : ""; };
  try {
    if (cmd === "shot") {
      fs.mkdirSync(SHOTS, { recursive: true }); const theme = val("--theme");
      for (const w of val("--widths", isPanel ? "420" : "1280,390").split(",").map(Number)) {
        const { pg, ctx, errs, ext } = await open(w, theme);
        if (val("--at")) { const el = await pg.$(val("--at")); if (el) await el.scrollIntoViewIfNeeded(); else { bad++; console.log(`  no element matches ${val("--at")}`); } await pg.waitForTimeout(200); }
        const scroll = await pg.evaluate(() => document.documentElement.scrollWidth > innerWidth); if (scroll) bad++;
        const f = path.join(SHOTS, `${isPanel ? "panel" : target.replace(/[^\w]+/g, "_").replace(/^_|_$/g, "") || "home"}-${w}${theme ? "-" + theme : ""}.png`);
        await pg.screenshot({ path: f });
        console.log(`${scroll || errs.length || ext.length ? "FAIL" : "ok  "} ${target} @${w}${theme ? " " + theme : ""}: ${scroll ? "SIDEWAYS SCROLL" : "no sideways scroll"} · ${path.relative(ROOT, f)}${tail(errs, ext)}`);
        await ctx.close();
      }
    }
    if (cmd === "eval") {
      const { pg, ctx, errs, ext } = await open(+val("--width", isPanel ? 420 : 1280), val("--theme"));
      const r = await pg.evaluate(async (e) => { try { return JSON.stringify(await (0, eval)(e)); } catch (x) { return "Error: " + x.message; } }, pos[2]);
      console.log(`${target}: ${r}${tail(errs, ext)}`); await ctx.close();
    }
  } finally { await browser.close(); srv.stop(); }
  process.exit(bad ? 1 : 0);
})();
