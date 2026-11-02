// The scan loop and its stop rules (extension/lib/scanner.js), with fake checks and no real waiting.
const { test, assert } = require("./check.js");
const S = require("../extension/lib/scanner.js");
const T = (pins) => [{ id: "home", label: "h", pins: pins.map((p) => ({ p })) }];
const base = { sleep: async () => {}, shouldStop: () => false, onEvent: () => {}, retryDelay: 0, delay: () => 0 };

test("a hung check times out and the scan continues", async () => {
  const r = await S.runScan({ ...base, checkTimeout: 50, tiers: T(["1", "2"]), check: (p) => p === "1" ? new Promise(() => {}) : { status: "available" } });
  assert.equal(r.outcome, "found"); assert.equal(r.errors, 1);
});
test("Stop during a hung check returns within a second", async () => {
  let stop = false; setTimeout(() => stop = true, 100); const t0 = Date.now();
  const r = await S.runScan({ ...base, shouldStop: () => stop, checkTimeout: 60000, tiers: T(["1"]), check: () => new Promise(() => {}) });
  assert.equal(r.outcome, "stopped"); assert(Date.now() - t0 < 1000, `took ${Date.now() - t0} ms`);
});
test("one retry rescues a blip", async () => {
  let n = 0; const r = await S.runScan({ ...base, tiers: T(["1"]), check: () => ++n === 1 ? { status: "error", message: "500" } : { status: "available" } });
  assert.equal(r.outcome, "found"); assert.equal(n, 2); assert.equal(r.errors, 0);
});
test("errors are counted separately from checks", async () => {
  const r = await S.runScan({ ...base, tiers: T(["1", "2"]), check: (p) => p === "1" ? { status: "error", message: "x" } : { status: "unavailable" } });
  assert.equal(r.outcome, "none"); assert.equal(r.checked, 2); assert.equal(r.errors, 1);
});
test("a fatal error (429) is not retried and stops the scan", async () => {
  let n = 0; const r = await S.runScan({ ...base, tiers: T(["1", "2"]), check: () => { n++; return { status: "error", fatal: true, message: "429" }; } });
  assert.equal(r.outcome, "aborted"); assert.equal(n, 1);
});
test("sold out everywhere stops early", async () => {
  let n = 0; const r = await S.runScan({ ...base, tiers: T(["1", "2", "3"]), check: () => { n++; return { status: "unavailable", soldOutEverywhere: true }; } });
  assert.equal(r.outcome, "soldout"); assert.equal(n, 1);
});
test("the delay doubles after errors, with no sleep after the last check", async () => {
  const sleeps = [];
  await S.runScan({ ...base, retryDelay: 4000, sleep: async (ms) => sleeps.push(ms), delay: () => 1000, tiers: T(["1", "2", "3"]),
    check: (p) => p === "3" ? { status: "unavailable" } : { status: "error", message: "x" } });
  assert.deepEqual(sleeps, [4000, 2000, 4000, 4000]);
});
test("3 failed pincodes in a row abort the scan", async () => {
  const r = await S.runScan({ ...base, tiers: T(["1", "2", "3", "4"]), check: () => ({ status: "error", message: "x" }) });
  assert.equal(r.outcome, "aborted"); assert.equal(r.checked, 3);
});
test("keep going: what was found is kept when stopped", async () => {
  let k = 0; const r = await S.runScan({ ...base, keepGoing: true, shouldStop: () => k >= 1, tiers: T(["1", "2"]), check: () => { k++; return { status: "available" }; } });
  assert.equal(r.outcome, "stopped"); assert.equal(r.found.length, 1);
});
test("a check that throws counts as an error", async () => {
  const r = await S.runScan({ ...base, tiers: T(["1"]), check: () => { throw new Error("boom"); } }); assert.equal(r.errors, 1);
});
test("default pacing waits at least the store's minDelay", async () => {
  const sl = []; await S.runScan({ ...base, delay: undefined, minDelay: 2000, sleep: async (ms) => sl.push(ms), tiers: T(["1", "2"]), check: () => ({ status: "unavailable" }) });
  assert(sl[0] >= 2000 && sl[0] <= 3700, `slept ${sl[0]} ms`);
});
