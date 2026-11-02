// What a scan would check for a pincode, from the real planner and dataset (no store, no browser):
//   node scripts/plan.js 560001                            tiers with counts and the first few pincodes of each
//   node scripts/plan.js 560001 --nearby 100 --india district --all
//   node scripts/plan.js 560001 --skip nearby,state --json
//   node scripts/plan.js --store "https://www.flipkart.com/x/p/itm1"   which store a URL belongs to (stores.json)
// Use it before writing page or store copy that states numbers ("19,586 pincodes", "50 of 111") or a test of the planner.
const path = require("path"), fs = require("fs");
const ROOT = path.join(__dirname, ".."), argv = process.argv.slice(2);
const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; }, has = (f) => argv.includes(f);
const VALUED = ["--nearby", "--india", "--skip", "--store"], pos = argv.filter((a, i) => !a.startsWith("--") && !VALUED.includes(argv[i - 1]));

if (has("--store")) {
  const url = val("--store"), host = new URL(url).hostname.replace(/^www\./, "");
  const stores = JSON.parse(fs.readFileSync(path.join(ROOT, "extension/data/stores.json"), "utf8"));
  const s = stores.find((x) => x.hosts.some((h) => host === h || host.endsWith("." + h)));
  if (!s) { console.log(`${host}: not a store in stores.json`); process.exit(1); }
  const adapter = fs.existsSync(path.join(ROOT, `extension/lib/stores/${s.id}.js`));
  console.log(`${host} → ${s.name} (${s.id}) · ${!adapter ? "no adapter yet (recordable only)" : s.experimental ? "experimental adapter" : "working adapter"}${s.minDelayMs ? ` · minDelayMs ${s.minDelayMs}` : ""}`);
  process.exit(0);
}

const pin = pos[0];
if (!/^\d{6}$/.test(pin || "")) { console.log(fs.readFileSync(__filename, "utf8").split("\n").filter((l) => l.startsWith("//")).map((l) => l.slice(3)).join("\n")); process.exit(pin ? 1 : 0); }
const P = require(path.join(ROOT, "extension/lib/planner.js"));
let data, file = "pincodes.json";
try { data = require(path.join(ROOT, "extension/data/pincodes.json")); } catch { data = require(path.join(ROOT, "extension/data/pincodes.seed.json")); file = "pincodes.seed.json"; }
const nearby = val("--nearby"), india = val("--india");
const opts = {
  ...(nearby ? { nearbyCap: nearby === "all" ? Infinity : +nearby } : {}),
  ...(india === "district" ? { indiaBy: "district" } : india ? { indiaPerGroup: +india } : {}),
  ...(val("--skip") ? { skip: val("--skip").split(",") } : {}),
};
const tiers = P.buildTiers(pin, data, opts);
if (has("--json")) { console.log(JSON.stringify(tiers, null, 1)); process.exit(0); }
const home = data.find((e) => e.p === pin);
console.log(`${pin}: ${home ? `${home.d}, ${home.s}` : "not in the dataset (borrows the closest same-prefix pincode)"} · ${data.length.toLocaleString("en-IN")} pincodes in ${file}`);
let total = 0;
for (const t of tiers) {
  total += t.pins.length;
  const show = has("--all") ? t.pins : t.pins.slice(0, 5);
  console.log(`  ${t.id.padEnd(7)} ${t.label}: ${t.pins.length} of ${t.total}  ${show.map((e) => `${e.p}${e.d ? ` ${e.d}` : ""}`).join(", ")}${show.length < t.pins.length ? ", …" : ""}`);
}
console.log(`  ${total} pincodes would be checked (at ~1 s each, about ${Math.ceil(total / 60)} min if none is deliverable)`);
