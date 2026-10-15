// Run: node tests/planner.test.js   (uses extension/data/pincodes.json when present)
const assert = require("assert");
const P = require("../extension/lib/planner.js");
let data;
try { data = require("../extension/data/pincodes.json"); } catch { data = require("../extension/data/pincodes.seed.json"); }
const tier = (t, id) => t.find((x) => x.id === id) || { pins: [], total: 0 };

for (const home of ["560001", "560028", "413512", "682001", "110001", "796001", "744101"]) {
  const t = P.buildTiers(home, data);
  const all = t.flatMap((x) => x.pins.map((e) => e.p));
  assert.equal(new Set(all).size, all.length, `${home}: a pincode appears in two tiers`);
  assert.equal(t[0].pins[0].p, home);
  assert(!tier(t, "nearby").pins.some((e) => e.s === "Lakshadweep" && home === "682001"), "Lakshadweep counted as near Kochi");
  console.log(home, t.map((x) => `${x.id}=${x.pins.length}/${x.total}`).join(" "));
}

if (data.length > 2000) {
  // Regression guards for the "fewer pincodes" bug: a rural home gets a full nearby
  // tier, and Delhi's other districts are not swallowed by the nearby radius.
  assert(tier(P.buildTiers("413512", data), "nearby").total > 50);
  assert(tier(P.buildTiers("110001", data), "state").pins.length > 0);
}

// Pincodes without coordinates sort by their district's location, not last.
const d2 = [
  { p: "560001", d: "Bengaluru", s: "Karnataka", lat: 12.97, lng: 77.59 },
  { p: "635109", d: "Krishnagiri", s: "Tamil Nadu" },
  { p: "635110", d: "Krishnagiri", s: "Tamil Nadu", lat: 12.74, lng: 77.82 },
  { p: "110001", d: "New Delhi", s: "Delhi", lat: 28.63, lng: 77.21 },
];
assert.equal(tier(P.buildTiers("560001", d2), "india").pins[0].p, "635109");
console.log("PLANNER OK");
