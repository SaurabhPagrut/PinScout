// Turns a store's real answer into an adapter fixture: masks it with the recorder's own rules (without shortening it, so
// the adapter reads it exactly as it read the store), writes tests/fixtures/<store>/<case>.json, and runs the adapter on
// it so you see the verdict straight away.
//
//   node tools/make-fixture.js flipkart available-560001 --response ~/Downloads/answer.json \
//        --url "https://www.flipkart.com/…/p/itm…?pid=…" --pincode 560001 --expect available [--sla "Delivery by …"]
//
//   --response  the answer, saved from DevTools (Network → the delivery-check request → right-click → Copy → Copy response)
//   --expect    what the store's own page said for that pincode: available | unavailable | error
//   --status    the HTTP status of that answer (default 200)
//   --host, --path  where the adapter asks (default: taken from this store's existing fixtures)
//   --h1        the product heading on the page (default: the one in this store's existing fixtures)
//   --sla, --stock  also check the delivery date / stock text the verdict carries
//   --about     one line saying what the case shows
// Skim the written file before committing it: masking is best effort (see PRIVACY.md).
const fs = require("fs"), path = require("path"), vm = require("vm");
const ROOT = path.join(__dirname, ".."), argv = process.argv.slice(2);
const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const VALUED = ["--response", "--url", "--pincode", "--expect", "--status", "--host", "--path", "--h1", "--sla", "--stock", "--about"];
const pos = argv.filter((a, i) => !a.startsWith("--") && !VALUED.includes(argv[i - 1]));
const usage = () => { console.log(fs.readFileSync(__filename, "utf8").split("\n").filter((l) => l.startsWith("//")).map((l) => l.slice(3)).join("\n")); process.exit(1); };

const [store, name] = pos;
if (!store || !name || !val("--response") || !val("--url") || !/^\d{6}$/.test(val("--pincode", "")) || !["available", "unavailable", "error"].includes(val("--expect"))) usage();
if (!/^[a-z0-9-]+$/.test(name)) { console.error("case name: lowercase letters, digits and dashes only"); process.exit(1); }
if (!fs.existsSync(path.join(ROOT, `extension/lib/stores/${store}.js`))) { console.error(`no adapter extension/lib/stores/${store}.js`); process.exit(1); }

/* the recorder's own masking rules (extension/lib/recorder-page.js), loaded the way tests/recorder-mask.test.js does */
function maskers() {
  /* a browser-like Storage (the recorder reads its session state through Storage.prototype), set to "recording" so it sets up */
  function Storage() { this.m = {}; }
  Storage.prototype.getItem = function (k) { return k in this.m ? this.m[k] : null; };
  Storage.prototype.setItem = function (k, v) { this.m[k] = String(v); };
  Storage.prototype.removeItem = function (k) { delete this.m[k]; };
  const noop = () => {}, sessionStorage = new Storage(), localStorage = new Storage();
  sessionStorage.setItem("__pinscout_rec_v1", JSON.stringify({ active: true, startedAt: Date.now(), markers: [val("--pincode")] }));
  const window = { sessionStorage, localStorage, addEventListener: noop, removeEventListener: noop };
  const ctx = { window, Storage, sessionStorage, localStorage, URL, URLSearchParams, console, setTimeout, clearTimeout,
    location: { href: "https://shop.example/p/1", hostname: "shop.example", origin: "https://shop.example", pathname: "/p/1" },
    document: { addEventListener: noop, removeEventListener: noop, visibilityState: "visible", querySelectorAll: () => [] },
    performance: { getEntriesByType: () => [] } };
  vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(ROOT, "extension/lib/recorder-page.js"), "utf8"), ctx);
  return window.__pinscoutRecorder._mask;
}
const M = maskers(), pin = val("--pincode");
let masked = 0;
/* every key the recorder treats as personal is masked, every string is scrubbed; nothing is shortened. The pincode stays. */
function walk(x, k) {
  if (k !== undefined && M.sensitiveKey(k) && !/pin|zip|postal/i.test(k)) { masked++; return "[masked]"; }
  if (typeof x === "string") { const s = x === pin ? x : M.scrub(x); if (s !== x) masked++; return s; }
  if (Array.isArray(x)) return x.map((v) => walk(v));
  if (x && typeof x === "object") return Object.fromEntries(Object.entries(x).map(([kk, v]) => [kk, walk(v, kk)]));
  return x;
}
const raw = fs.readFileSync(val("--response").replace(/^~(?=\/)/, process.env.HOME), "utf8");
let body;
try { body = { json: walk(JSON.parse(raw)) }; }
catch {
  if (/^\s*</.test(raw)) { console.error("This answer is HTML. Pages can hold names and saved addresses, so HTML answers aren't turned into fixtures automatically; cut it down to the part the adapter reads, by hand."); process.exit(1); }
  const s = M.scrub(raw); if (s !== raw) masked++; body = { text: s };
}

/* where the adapter asks, and the page heading: from this store's existing fixtures unless given */
const dir = path.join(ROOT, "tests/fixtures", store), others = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))) : [];
const like = others.find((o) => o.responses?.[0]?.host) || {};
const host = val("--host", like.responses?.[0]?.host), p = val("--path", like.responses?.[0]?.path);
const expect = { status: val("--expect") };
if (val("--sla")) expect.sla = val("--sla");
if (val("--stock")) expect.stock = val("--stock");
const fx = {
  about: val("--about", `recorded answer for ${pin}: ${val("--expect")}`),
  source: `recorded ${new Date().toISOString().slice(0, 10)}, masked by tools/make-fixture.js (${masked} value${masked === 1 ? "" : "s"} masked)`,
  url: val("--url"), h1: val("--h1", like.h1 || ""), pincode: pin,
  responses: [{ ...(host ? { host } : {}), ...(p ? { path: p } : {}), status: +val("--status", 200), ...body }],
  expect,
};
fs.mkdirSync(dir, { recursive: true });
const out = path.join(dir, `${name}.json`);
fs.writeFileSync(out, JSON.stringify(fx, null, 1) + "\n");

(async () => {
  const { check } = require(path.join(ROOT, "tests/adapter-harness.js"));
  let v;
  try { v = (await check(fx, store)).verdict; } catch (e) { v = { status: "error", message: e.message }; }
  const same = v.status === expect.status && (!expect.sla || v.sla === expect.sla) && (!expect.stock || v.stock === expect.stock);
  console.log(`${path.relative(ROOT, out)} · ${masked} value(s) masked · ${Math.round(JSON.stringify(fx).length / 1024)} KB`);
  console.log(`${same ? "ok  " : "FAIL"} the adapter says ${v.status}${v.sla ? ` (${v.sla})` : ""}${v.message ? `: ${v.message}` : ""}; the store's page said ${expect.status}`);
  if (!same) console.log("     Either the adapter misreads this answer (a bug worth fixing: the test now fails until it's fixed) or --expect is wrong.");
  console.log("     Skim the file for anything personal before committing it.");
  process.exit(same ? 0 : 1);
})();
