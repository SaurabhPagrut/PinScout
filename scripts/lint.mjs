// Policy and syntax checks (EXTENSION_GUIDELINES.md): prints one line when all is well, and one FAIL line per problem.
//   node scripts/lint.mjs        (npm test runs it first, and so does CI)
// - every script parses (extension, tests, scripts, tools)
// - the extension runs no code from strings and builds no HTML from strings (eval, new Function, innerHTML, …)
// - network calls only where they belong: store adapters (lib/stores/*.js) and the recorder (lib/recorder-page.js);
//   anywhere else, fetch() only reads the extension's own files (chrome.runtime.getURL)
// - an adapter only talks to its own store's hosts (extension/data/stores.json)
// - extension pages and the website load no script, style or image from another site
// - extension/manifest.json and package.json have the same version
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, relative, basename } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname, rel = (f) => relative(ROOT, f);
const walk = (d) => existsSync(d) ? readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; }) : [];
const fails = [], fail = (f, line, msg) => fails.push(`FAIL ${rel(f)}${line ? `:${line}` : ""} ${msg}`);
/* comments removed (keeping line numbers), so a word in a comment never counts */
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
const lineOf = (s, i) => s.slice(0, i).split("\n").length;

/* 1. every script parses */
const scripts = [...walk(join(ROOT, "extension")), ...walk(join(ROOT, "tests")), ...walk(join(ROOT, "scripts")), ...walk(join(ROOT, "tools"))].filter((f) => /\.(m?js)$/.test(f));
for (const f of scripts) {
  try { execFileSync(process.execPath, ["--check", f], { stdio: "pipe" }); }
  catch (e) { fail(f, 0, `doesn't parse: ${String(e.stderr).split("\n").filter(Boolean).slice(0, 3).join(" ")}`); }
}

/* 2 and 3. the extension's own code */
const BANNED = [
  [/\beval\s*\(/, "eval()"], [/\bnew\s+Function\b/, "new Function"], [/\.(?:inner|outer)HTML\s*\+?=/, "innerHTML/outerHTML assignment"],
  [/\binsertAdjacentHTML\b/, "insertAdjacentHTML"], [/\bdocument\.write\b/, "document.write"], [/\bset(?:Timeout|Interval)\s*\(\s*["'`]/, "setTimeout/setInterval with a string"],
  [/\bimportScripts\s*\(\s*["'`]https?:/, "importScripts from another site"],
];
const NET = /\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b|\bsendBeacon\b|\bEventSource\b/g;
const stores = JSON.parse(readFileSync(join(ROOT, "extension/data/stores.json"), "utf8"));
const extJs = walk(join(ROOT, "extension")).filter((f) => f.endsWith(".js"));
for (const f of extJs) {
  const src = code(readFileSync(f, "utf8")), r = rel(f);
  for (const [re, what] of BANNED) { const m = re.exec(src); if (m) fail(f, lineOf(src, m.index), `uses ${what}`); }
  const adapter = /^extension\/lib\/stores\/[\w-]+\.js$/.test(r), recorder = r === "extension/lib/recorder-page.js";
  if (!adapter && !recorder) {
    for (const m of src.matchAll(NET)) {
      const call = src.slice(m.index, m.index + 80);
      if (!/^fetch\s*\(\s*chrome\.runtime\.getURL\(/.test(call)) fail(f, lineOf(src, m.index), `network call outside an adapter or the recorder: ${call.split("\n")[0].trim()}`);
    }
  }
  /* an adapter's hard-coded addresses belong to its own store (a ${…} part, like Flipkart's data-centre number, counts as a subdomain) */
  if (adapter) {
    const store = stores.find((s) => s.id === basename(f, ".js"));
    if (!store) { fail(f, 0, `no store "${basename(f, ".js")}" in extension/data/stores.json`); continue; }
    for (const m of src.matchAll(/https?:\/\/([^\s"'`/?#]+)/g)) {
      const host = m[1].replace(/\$\{[^}]*\}/g, "x").replace(/^\*\./, "").toLowerCase();
      if (!store.hosts.some((h) => host === h || host.endsWith("." + h))) fail(f, lineOf(src, m.index), `talks to ${host}, which isn't one of ${store.name}'s hosts (${store.hosts.join(", ")})`);
    }
  }
}

/* 4. pages load nothing from other sites (links to them are fine) */
for (const f of [...walk(join(ROOT, "extension")), ...walk(join(ROOT, "site"))].filter((f) => f.endsWith(".html"))) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(/<(script|link|img|iframe|source|video|audio)\b[^>]*\b(?:src|href)\s*=\s*["'](https?:)?\/\//gi))
    fail(f, lineOf(src, m.index), `<${m[1]}> loads from another site`);
  for (const m of src.matchAll(/@import\s+(?:url\()?["']?https?:/gi)) fail(f, lineOf(src, m.index), "CSS @import from another site");
}

/* 5. no links to sites that aren't ours: pinscout.pages.dev belongs to another Cloudflare project (ours is pinscouts) */
const NOT_OURS = ["pinscout.pages.dev"];
for (const f of [...walk(join(ROOT, "extension")), ...walk(join(ROOT, "site")), ...walk(join(ROOT, "webstore")), ...walk(join(ROOT, "scripts")),
  ...["PRIVACY.md", "README.md", "PUBLISHING.md", "CHANGELOG.md", "CLAUDE.md"].map((f) => join(ROOT, f))].filter((f) => existsSync(f) && /\.(html|js|mjs|json|md|txt)$/.test(f) && !f.endsWith("lint.mjs"))) {
  const src = readFileSync(f, "utf8");
  for (const host of NOT_OURS) for (const m of src.matchAll(new RegExp(`(?<![\\w-])${host.replace(/\./g, "\\.")}`, "g"))) fail(f, lineOf(src, m.index), `links to ${host}, which isn't ours`);
}

/* 6. one version */
const mv = JSON.parse(readFileSync(join(ROOT, "extension/manifest.json"), "utf8")).version, pv = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
if (mv !== pv) fail(join(ROOT, "package.json"), 0, `version ${pv}, but extension/manifest.json is ${mv}`);

if (fails.length) { console.log(fails.join("\n")); console.log(`lint: ${fails.length} problem${fails.length === 1 ? "" : "s"}`); process.exit(1); }
console.log(`lint ok · ${scripts.length} scripts parse · ${extJs.length} extension files follow the rules · version ${mv}`);
