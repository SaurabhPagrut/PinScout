// Runs the test files in parallel and prints only what matters: one line per file, and for a failure the failing checks
// with the lines that explain them. The full output of every file goes to .check/<file>.log.
//   node tests/run.js                 every tests/*.test.js (what npm test and CI run)
//   node tests/run.js --changed       only the files a change against main can affect (falls back to all when unsure)
//   node tests/run.js planner scan    only these files (a name, or part of one)
//   node tests/run.js --list          show the files and what each one reads
// A test file prints "PASS name" / "FAIL name" lines (tests/check.js does it); a FAIL's reason is indented under it.
const fs = require("fs"), path = require("path"), os = require("os"), { spawn, execSync } = require("child_process");
const ROOT = path.join(__dirname, ".."), OUT = path.join(ROOT, ".check"), rel = (f) => path.join(ROOT, f);
const args = process.argv.slice(2), flag = (f) => args.includes(f), names = args.filter((a) => !a.startsWith("--"));

/* every *.test.js in tests/ runs: a new file can't be forgotten */
const ALL = fs.readdirSync(__dirname).filter((f) => f.endsWith(".test.js")).sort();

/* ---------- what each test reads, so --changed can pick the tests a change can affect ---------- */
function reads(t) {
  const s = fs.readFileSync(path.join(__dirname, t), "utf8"), out = new Set([`tests/${t}`, "tests/check.js"]);
  for (const m of s.matchAll(/["'`]((?:\.\.\/)+[\w./-]+\.(?:js|json|html|css|py))["'`]/g)) {
    const f = path.relative(ROOT, path.join(__dirname, m[1])); if (fs.existsSync(rel(f))) out.add(f);
  }
  for (const m of s.matchAll(/["'`](tests\/fixtures\/[\w./-]+|fixtures\/[\w./-]+)["'`]/g)) out.add(m[1].startsWith("tests/") ? m[1] : `tests/${m[1]}`);
  return out;
}
function changedFiles() {
  try {
    const base = execSync("git merge-base HEAD origin/main", { cwd: ROOT }).toString().trim();
    return execSync(`git diff --name-only ${base}`, { cwd: ROOT }).toString().split("\n")
      .concat(execSync("git ls-files --others --exclude-standard", { cwd: ROOT }).toString().split("\n")).filter(Boolean);
  } catch { return null; }
}
/* a full name picks that file; otherwise a part of a name picks every file containing it */
function pick() {
  if (names.length) return ALL.filter((t) => names.some((n) => t === n || t === `${n}.test.js` || t.includes(n.replace(/(\.test)?\.js$/, ""))));
  if (!flag("--changed")) return ALL;
  const ch = changedFiles(); if (!ch) { console.log("can't tell what changed (no origin/main?): running everything"); return ALL; }
  /* docs, store texts, the website, dev scripts, CI and editor config don't change what the tests test */
  const code = ch.filter((f) => !/\.(md|txt)$/.test(f) && !/^(webstore|site|scripts|graphify-out|\.claude|\.github|backend|frontend)\//.test(f)
    && !["tests/run.js", ".gitignore", "package.json", "PRIVACY.md"].includes(f));
  if (!code.length) { console.log("nothing the tests read changed: no tests to run"); return []; }
  const map = Object.fromEntries(ALL.map((t) => [t, reads(t)]));
  /* a changed file no test reads (a new adapter, the panel) could matter anywhere: run everything */
  const unknown = code.filter((f) => !ALL.some((t) => map[t].has(f)));
  if (unknown.length) { console.log(`no test reads ${unknown.slice(0, 3).join(", ")}${unknown.length > 3 ? "…" : ""}: running everything`); return ALL; }
  return ALL.filter((t) => code.some((f) => map[t].has(f)));
}

/* ---------- run, in parallel ---------- */
/* a failure in the log: a line starting FAIL, plus the indented lines after it that explain it */
function failures(log) {
  const L = log.split("\n"), out = [];
  L.forEach((l, i) => {
    if (!/^FAIL\b/.test(l)) return;
    const ctx = []; for (let j = i + 1; j < L.length && j < i + 5 && /^\s+\S/.test(L[j]); j++) ctx.push(L[j].slice(0, 240));
    out.push([l.slice(0, 300), ...ctx].join("\n"));
  });
  return out;
}
function runOne(t) {
  return new Promise((res) => {
    const t0 = Date.now(); let log = "";
    const p = spawn(process.execPath, [path.join(__dirname, t)], { cwd: ROOT, env: { ...process.env, FORCE_COLOR: "0" } });
    p.stdout.on("data", (d) => log += d); p.stderr.on("data", (d) => log += d);
    const kill = setTimeout(() => { log += "\nFAIL timed out after 2 minutes"; p.kill("SIGKILL"); }, 120000);
    p.on("close", (code) => {
      clearTimeout(kill); fs.writeFileSync(path.join(OUT, t.replace(/\.test\.js$/, ".log")), log);
      res({ t, code, ms: Date.now() - t0, pass: (log.match(/^PASS\b/gm) || []).length, fails: failures(log), tail: log.trim().split("\n").slice(-12).join("\n") });
    });
  });
}

(async () => {
  if (flag("--list")) { for (const t of ALL) console.log(`${t.padEnd(26)} ${[...reads(t)].filter((f) => !f.startsWith("tests/")).join(" ")}`); return; }
  fs.mkdirSync(OUT, { recursive: true });
  const files = pick(); if (!files.length) return;
  const t0 = Date.now(), width = Math.max(1, Math.min(os.cpus().length, files.length)), queue = [...files], results = [];
  await Promise.all(Array.from({ length: width }, async () => {
    while (queue.length) {
      const r = await runOne(queue.shift()); results.push(r);
      console.log(`${r.code === 0 && !r.fails.length ? "ok  " : "FAIL"} ${r.t.padEnd(26)} ${String(r.pass).padStart(4)} passed${r.fails.length ? ` · ${r.fails.length} failed` : ""} · ${(r.ms / 1000).toFixed(1)}s`);
    }
  }));
  const bad = results.filter((r) => r.code !== 0 || r.fails.length);
  for (const r of bad) {
    console.log(`\n── ${r.t} (exit ${r.code}) · full log: .check/${r.t.replace(/\.test\.js$/, ".log")}`);
    console.log(r.fails.length ? r.fails.slice(0, 15).join("\n") + (r.fails.length > 15 ? `\n… and ${r.fails.length - 15} more` : "") : `no FAIL line; the end of the output:\n${r.tail}`);
  }
  const pass = results.reduce((a, r) => a + r.pass, 0);
  console.log(`\n${bad.length ? `FAILED: ${bad.length} of ${results.length} files` : `all ${results.length} file${results.length === 1 ? "" : "s"} passed`} · ${pass} checks · ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  process.exit(bad.length ? 1 : 0);
})();
