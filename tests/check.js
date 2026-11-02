// The test helper: test("name", fn) registers a check; after the file has loaded they run in order and print
// "PASS name" or "FAIL name" with the reason indented under it (tests/run.js shows only the FAIL lines). fn may be async.
const assert = require("assert");
const checks = [];
function test(name, fn) { checks.push([name, fn]); }
setImmediate(async () => {
  let failed = 0;
  for (const [name, fn] of checks) {
    try { await fn(); console.log(`PASS ${name}`); }
    catch (e) { failed++; console.log(`FAIL ${name}`); for (const l of String(e?.message ?? e).split("\n").slice(0, 4)) console.log(`    ${l}`); }
  }
  process.exit(failed ? 1 : 0);
});
module.exports = { test, assert };
