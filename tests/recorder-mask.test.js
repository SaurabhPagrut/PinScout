// Checks the recorder's masking (extension/lib/recorder-page.js) against samples of what stores send.
// Run: node tests/run.js recorder-mask
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm"), assert = require("assert");

const src = fs.readFileSync(path.join(__dirname, "../extension/lib/recorder-page.js"), "utf8");
const KEY = "__pinscout_rec_v1";
function Storage() { this.m = {}; }
Storage.prototype.getItem = function (k) { return k in this.m ? this.m[k] : null; };
Storage.prototype.setItem = function (k, v) { this.m[k] = String(v); };
Storage.prototype.removeItem = function (k) { delete this.m[k]; };
const sessionStorage = new Storage(), localStorage = new Storage();
sessionStorage.setItem(KEY, JSON.stringify({ active: true, startedAt: Date.now(), markers: ["411001"] }));
const noop = () => {};
const window = { sessionStorage, localStorage, addEventListener: noop, removeEventListener: noop };
const ctx = {
  window, Storage, sessionStorage, localStorage, URL, URLSearchParams,
  location: { href: "https://shop.example/p/1", hostname: "shop.example", origin: "https://shop.example", pathname: "/p/1" },
  document: { addEventListener: noop, removeEventListener: noop, visibilityState: "visible", querySelectorAll: () => [] },
  performance: { getEntriesByType: () => [] }, setTimeout, clearTimeout, console,
};
vm.createContext(ctx);
vm.runInContext(src, ctx);
const M = window.__pinscoutRecorder._mask;

let failed = 0;
function check(name, out, mustNotContain, mustContain = []) {
  const s = typeof out === "string" ? out : JSON.stringify(out);
  const leaks = mustNotContain.filter((x) => s.includes(x)), missing = mustContain.filter((x) => !s.includes(x));
  if (leaks.length || missing.length) { failed++; console.log(`FAIL ${name}`); console.log(`    leaks: ${JSON.stringify(leaks)} · missing: ${JSON.stringify(missing)}`); console.log(`    out: ${s.slice(0, 200)}`); }
  else console.log(`PASS ${name}`);
}
const PII = ["a.b@gmail.com", "9876543210", "Saurabh", "MG Road", "Lotus"];

check("url query personal params", M.maskUrl("https://s.in/api/check?pin=411001&email=a.b@gmail.com&phone=9876543210"), PII, ["pin=411001"]);
check("url fragment token", M.maskUrl("https://s.in/cb#access_token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc"), ["eyJhbGci"]);
check("url path segment", M.maskUrl("https://s.in/api/users/9876543210/addresses?pin=411001"), PII, ["/addresses", "pin=411001"]);
check("url short token names", M.maskUrl("https://s.in/x?sid=AbCdEf123456&jwt=eyJx.eyJy.zz&sig=deadbeef&pin=411001"), ["AbCdEf123456", "deadbeef", "eyJx"]);
check("final scrub keeps lowercase api path", M.finalScrub({ activity: ["GET 200 https://www.reliancedigital.in/api/service/application/logistics/v1.0/pincode/444001"] }),
  ["[token]"], ["reliancedigital.in/api/service/application/logistics/v1.0/pincode/444001"]);
check("final scrub still masks base64 with slashes", M.finalScrub({ v: "Gh1jKlMnOp+QrStUv/WxYz0123456789abcdEF==" }), ["Gh1jKlMnOp"]);
check("url keeps product slug", M.maskUrl("https://s.in/apple-iphone-15-128gb-black-mtp03hn-a/p/itm6ac6485515ae4?pid=MOBGTAGPTB3VS24W"),
  [], ["apple-iphone-15-128gb-black-mtp03hn-a", "MOBGTAGPTB3VS24W"]);
check("headers", M.maskHeaders({ "x-user-email": "a.b@gmail.com", "x-device-id": "d-1234-5678", "x-mobile": "9876543210", Authorization: "Bearer x", "content-type": "application/json" }),
  ["a.b@gmail.com", "d-1234-5678", "9876543210", "Bearer"], ["application/json"]);
check("nested address object", M.clean('{"pincode":"411001","shippingAddress":{"line1":"Flat 4, MG Road","city":"Pune"},"name":"Saurabh Pagrut","userName":"saurabh"}'),
  PII.concat(["saurabh"]), ['"pincode":"411001"']);
check("escaped quotes", M.clean('{"address":"12 \\"Lotus\\" Apts, MG Road","pin":"411001"}'), PII, ["411001"]);
check("escaped quotes (non-JSON fallback)", M.clean('x={"address":"12 \\"Lotus\\" Apts, MG Road"}'), PII);
check("free text under innocent key", M.clean('{"pin":"411001","message":"Delivering to you, 9876543210, a.b@gmail.com"}'), ["9876543210", "a.b@gmail.com"], ["411001"]);
check("numeric ids", M.clean('{"pin":411001,"contactNo":9876543210,"userId":556677,"otp":"123456","sku":7654321}'), ["9876543210", "556677", "123456"], ["411001", "7654321"]);
check("form body", M.clean("pincode=411001&email=a.b%40gmail.com&addr%5Bline1%5D=Flat%204%20MG%20Road&qty=1"), ["a.b", "Flat"], ["pincode=411001", "qty=1"]);
check("encoded cookie JSON", M.cleanAny("%7B%22address%22%3A%22Flat%204%20MG%20Road%22%2C%22pin%22%3A%22411001%22%7D"), PII, ["411001"]);
check("JS object text", M.clean("cb({address:'Flat 4 MG Road', pin:'411001', phone:'9876543210'})"), PII, ["411001"]);
check("lat/lng kept in bodies", M.clean('{"lat":18.52043,"lng":73.85674,"pincode":"411001"}'), [], ["18.52043", "411001"]);

const el = (attrs, text, parent) => ({ nodeType: 1, tagName: "DIV", id: attrs.id || "", className: attrs.class || "", innerText: text, parentElement: parent || null,
  getAttribute: (a) => attrs[a] || null });
check("click on saved-address card", M.describe(el({}, "Home · Flat 4, MG Road, Pune 411001", el({ class: "saved-address-list" }, ""))), PII);
check("click on account menu", M.describe(el({ "aria-label": "Hi Saurabh" }, "Hi, Saurabh", el({ id: "accountMenu" }, ""))), ["Saurabh"]);
check("aria-label with phone", M.describe(el({ "aria-label": "Call 9876543210" }, "Call")), ["9876543210"]);
check("plain button text kept", M.describe(el({}, "Check")), [], ["Check"]);
check("typed pincode kept", M.valueOf({ value: "411001", type: "text" }), [], ["411001"]);
check("typed address not kept", M.valueOf({ value: "Flat 4, MG Road, Pune 411001", type: "text" }), PII, ["contains the pincode"]);

const fin = M.finalScrub({ marker: "411001", stateHints: ["window.user.email = a.b@gmail.com"], pageLoads: [{ url: "https://s.in/u/9876543210" }] });
check("final pass", fin, ["a.b@gmail.com", "9876543210"], ['"marker":"411001"', '"emails":1', '"phones":1']);

process.exit(failed ? 1 : 0);
