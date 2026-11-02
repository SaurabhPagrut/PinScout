// Store adapters against saved store answers, offline: each tests/fixtures/<store>/<case>.json runs through the real
// adapter in a sandbox page (tests/adapter-harness.js), and the verdict that reaches the scanner is compared with the
// fixture's "expect". Add a recorded answer with tools/make-fixture.js (see tests/fixtures/README.md).
//
// A fixture:
//   { "about": "…", "source": "recorded 2026-11-02" | "synthetic: …",
//     "url": "<product page>", "h1": "<the page's heading>", "pincode": "560001",
//     "responses": [ { "host": "1.rome.api.flipkart.com", "path": "/api/4/page/fetch", "status": 200, "json": {…} | "text": "…" }, … ],
//     "expect": { "status": "available", "sla": "…", "fatal": true, "messageIncludes": "…" },
//     "page": { "FPI": {…} }, "cookie": "…", "localStorage": { "key": "value" },   (optional: the page's own state)
//     "expectRequests": [ { "host": "…", "path": "…", "bodyIncludes": ["…"], "searchIncludes": ["…"], "headers": { "name": "value" } } ] }
// Responses are served in order, and every request must match the next one's host and path (when given). A fixture's
// "source" says whether it is a real recording (masked by the recorder) or written by hand from the adapter's code.
const { test, assert } = require("./check.js");
const { check } = require("./adapter-harness.js");
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, ".."), FIX = path.join(__dirname, "fixtures");

const stores = fs.existsSync(FIX) ? fs.readdirSync(FIX).filter((d) => fs.statSync(path.join(FIX, d)).isDirectory()) : [];
for (const storeId of stores) {
  for (const file of fs.readdirSync(path.join(FIX, storeId)).filter((f) => f.endsWith(".json")).sort()) {
    const fx = JSON.parse(fs.readFileSync(path.join(FIX, storeId, file), "utf8"));
    test(`${storeId}/${file.replace(/\.json$/, "")}: ${fx.about}`, async () => {
      const { verdict: v, requests, left } = await check(fx, storeId);
      const e = fx.expect;
      assert.equal(v.status, e.status, `verdict ${v.status}${v.message ? ` (${v.message})` : ""}, expected ${e.status}`);
      if ("sla" in e) assert.equal(v.sla, e.sla, "delivery date");
      if ("title" in e) assert.equal(v.title, e.title, "title");
      if ("stock" in e) assert.equal(v.stock, e.stock, "stock");
      if ("fatal" in e) assert.equal(!!v.fatal, e.fatal, "fatal (stops the scan)");
      if ("httpStatus" in e) assert.equal(v.httpStatus, e.httpStatus, "HTTP status");
      if ("soldOutEverywhere" in e) assert.equal(v.soldOutEverywhere, e.soldOutEverywhere, "sold out everywhere");
      if (e.messageIncludes) assert((v.message || "").includes(e.messageIncludes), `message "${v.message}" lacks "${e.messageIncludes}"`);
      for (const [i, want] of (fx.expectRequests || []).entries()) {
        const got = requests[i];
        assert(got, `request ${i + 1} was never made (made ${requests.length})`);
        if (want.host) assert.equal(got.host, want.host, `request ${i + 1} host`);
        if (want.method) assert.equal(got.method, want.method, `request ${i + 1} method`);
        if (want.path) assert.equal(got.path, want.path, `request ${i + 1} path`);
        for (const s of want.searchIncludes || []) assert(got.search.includes(s), `request ${i + 1} query lacks ${s}: ${got.search}`);
        for (const [k, v] of Object.entries(want.headers || {})) assert.equal(got.headers[k.toLowerCase()], v, `request ${i + 1} header ${k}`);
        for (const s of want.bodyIncludes || []) assert(got.body.includes(s), `request ${i + 1} body lacks ${s}: ${got.body.slice(0, 200)}`);
      }
      if ("requestCount" in fx) assert.equal(requests.length, fx.requestCount, "number of requests");
      if (!fx.allowUnusedResponses) assert.equal(left.length, 0, `${left.length} fixture response(s) never requested`);
    });
  }
}

/* every adapter in lib/stores/ should have fixtures, or say why not yet */
// amazon: its verdict is read from the product page's HTML (DOMParser), which this sandbox doesn't have; its
// pincode save-and-restore is tested in tests/amazon-restore.test.js instead
const PENDING = ["amazon"]; // remove a store from this list when it gets fixtures
test("every adapter has fixtures or is listed as pending", () => {
  const adapters = fs.readdirSync(path.join(ROOT, "extension/lib/stores")).filter((f) => f.endsWith(".js")).map((f) => f.slice(0, -3));
  const missing = adapters.filter((id) => !stores.includes(id) && !PENDING.includes(id));
  assert.deepEqual(missing, [], `adapters without fixtures: ${missing.join(", ")}`);
  const stale = PENDING.filter((id) => stores.includes(id));
  assert.deepEqual(stale, [], `has fixtures now, remove from PENDING: ${stale.join(", ")}`);
});
