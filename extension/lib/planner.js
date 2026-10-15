/*
 * Planner: turns (home pincode + pincode dataset) into ordered search tiers.
 *
 *   home   -> the user's own pincode
 *   nearby -> same district, same 3-digit postal prefix, or within ~40 km (if coordinates exist)
 *   state  -> one representative pincode per district in the same state
 *   india  -> one representative pincode per other state / UT (or per district)
 *
 * Every tier carries { pins, total }: pins = what will be checked, total = how many
 * candidates existed before any cap (so the UI can show "50 of 112").
 *
 * Dataset entry shape: { p: "560001", d: "Bengaluru", s: "Karnataka", m?: 1, lat?: n, lng?: n }
 *   m ranks a pincode as a group representative: 2 = big city, 1 = head-post-office hub, absent = ordinary.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Planner = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const DEFAULTS = {
    nearbyCap: 50,          // max pincodes checked in the nearby tier (Infinity = all)
    stateCap: 80,           // max pincodes checked in the rest-of-state tier
    indiaCap: Infinity,     // max pincodes checked in the rest-of-India tier
    statePerDistrict: 1,    // representatives per district in your state
    indiaBy: "state",       // "state" = group India by state, "district" = by district
    indiaPerGroup: 1,       // representatives per state (or district)
  };
  const NEARBY_KM = 40;
  // Same district / same 3-digit prefix still counts as nearby, but not beyond this
  // (a prefix can span a few hundred km in rural circles).
  const NEARBY_MAX_KM = 150;

  const norm = (s) => (s || "").trim().toLowerCase();

  function haversineKm(a, b) {
    const R = 6371, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
    const x = Math.sin(dLat / 2) ** 2 +
      Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  }

  // Approximate coordinates for every pincode, used only for ORDERING: real ones
  // where present, else the centre of its district, else of its 3-digit prefix.
  // Without this, a pincode with no coordinates sorted after every pincode that
  // had them, so a town 40 km away could be checked after the far end of India.
  const approxCache = new WeakMap();
  function approxCoords(data) {
    if (approxCache.has(data)) return approxCache.get(data);
    const sums = new Map();
    const add = (k, e) => {
      const t = sums.get(k) || { lat: 0, lng: 0, n: 0 };
      t.lat += e.lat; t.lng += e.lng; t.n++;
      sums.set(k, t);
    };
    for (const e of data) {
      if (e.lat == null || e.lng == null) continue;
      if (e.d) add(`d|${norm(e.s)}|${norm(e.d)}`, e);
      add(`p|${e.p.slice(0, 3)}`, e);
    }
    const centre = (k) => { const t = sums.get(k); return t ? { lat: t.lat / t.n, lng: t.lng / t.n } : null; };
    const out = new Map();
    for (const e of data) {
      const c = e.lat != null && e.lng != null ? { lat: e.lat, lng: e.lng }
        : (e.d && centre(`d|${norm(e.s)}|${norm(e.d)}`)) || centre(`p|${e.p.slice(0, 3)}`);
      if (c) out.set(e.p, c);
    }
    approxCache.set(data, out);
    return out;
  }

  // Sort key: km from home (approximate coordinates allowed) when both ends have a
  // location; numeric pincode distance otherwise (postal zones are roughly
  // geographic). Memoised, since sorts call it many times per entry.
  function makeKey(home, approx) {
    const useGeo = home.lat != null && home.lng != null;
    const memo = new Map();
    return (e) => {
      let k = memo.get(e.p);
      if (k) return k;
      const c = useGeo && approx.get(e.p);
      k = c ? [0, haversineKm(home, c)] : [1, Math.abs(Number(e.p) - Number(home.p))];
      memo.set(e.p, k);
      return k;
    };
  }
  const cmp = (ka, kb) => ka[0] - kb[0] || ka[1] - kb[1];

  // Best n entries of a group: "major" first, then closest to home, preferring
  // distinct 3-digit prefixes so extra picks spread across the area.
  function pickN(list, key, n) {
    const sorted = list.slice().sort((a, b) => (b.m || 0) - (a.m || 0) || cmp(key(a), key(b)));
    if (n <= 1) return sorted.slice(0, 1);
    const out = [], usedPrefix = new Set(), rest = [];
    for (const e of sorted) {
      const pre = e.p.slice(0, 3);
      if (out.length < n && !usedPrefix.has(pre)) { out.push(e); usedPrefix.add(pre); }
      else rest.push(e);
    }
    for (const e of rest) { if (out.length >= n) break; out.push(e); }
    return out;
  }

  function pickRepresentatives(groups, key, cap, perGroup) {
    const reps = [];
    for (const list of groups.values()) reps.push(...pickN(list, key, perGroup));
    reps.sort((a, b) => cmp(key(a), key(b)));
    return { pins: reps.slice(0, cap), total: reps.length };
  }

  function groupBy(list, fn) {
    const g = new Map();
    for (const e of list) {
      const k = fn(e);
      if (!g.has(k)) g.set(k, []);
      g.get(k).push(e);
    }
    return g;
  }

  // opts.skip: tier ids the user unticked. A skipped nearby tier doesn't "cover"
  // its area, so the state tier still checks the user's own district.
  function buildTiers(homePin, data, opts = {}) {
    const o = { ...DEFAULTS, ...opts };
    const skip = new Set(o.skip || []);
    const byPin = new Map(data.map((e) => [e.p, e]));
    const homeEntry = byPin.get(homePin);
    const home = {
      p: homePin,
      d: homeEntry?.d, s: homeEntry?.s,
      lat: homeEntry?.lat, lng: homeEntry?.lng,
    };
    // Home pincode not in the dataset (the India Post file has gaps): borrow
    // location details from the closest known pincode sharing the longest prefix.
    //   >= 3 shared digits -> state, district and coordinates (same postal district)
    //   2 shared digits    -> state only
    if (!homeEntry) {
      let best = null, bestLen = 0;
      for (const e of data) {
        let n = 0;
        while (n < 6 && e.p[n] === homePin[n]) n++;
        if (n < 2) continue;
        const closer = best && n === bestLen && Math.abs(e.p - homePin) < Math.abs(best.p - homePin);
        if (n > bestLen || closer) { best = e; bestLen = n; }
      }
      if (best) {
        home.s = best.s;
        if (bestLen >= 3) { home.d = best.d; home.lat = best.lat; home.lng = best.lng; }
      }
    }
    const approx = approxCoords(data);
    // Ordering may use an approximate home location (district centre); the 40 km
    // nearby rule below only trusts real coordinates.
    let homeGeo = home;
    if ((home.lat == null || home.lng == null) && home.d) {
      let lat = 0, lng = 0, n = 0;
      for (const e of data) {
        if (e.lat != null && e.lng != null && norm(e.d) === norm(home.d) && norm(e.s) === norm(home.s)) {
          lat += e.lat; lng += e.lng; n++;
        }
      }
      if (n) homeGeo = { ...home, lat: lat / n, lng: lng / n };
    }
    const key = makeKey(homeGeo, approx);
    const seen = new Set([homePin]);
    const take = (entries) => entries.filter((e) => !seen.has(e.p)).map((e) => { seen.add(e.p); return e; });

    const tiers = [{ id: "home", label: "Your pincode", total: 1, pins: [{ p: homePin, d: home.d, s: home.s }] }];

    // ---- nearby: same district, same 3-digit prefix, or within NEARBY_KM ----
    const pre3 = homePin.slice(0, 3);
    const useGeo = home.lat != null && home.lng != null;
    const sameDistrict = (e) => home.d && norm(e.d) === norm(home.d) && norm(e.s) === norm(home.s);
    // Nearby = within NEARBY_KM (any state), OR same district / same 3-digit prefix
    // inside the home state. The prefix/district match is capped at NEARBY_MAX_KM when
    // both have coordinates, and staying inside the state keeps out traps like
    // Lakshadweep, which shares Kochi's 682 prefix but is its own UT.
    // (A later version used distance alone whenever coordinates existed, which
    // dropped most of the district and shrank this tier.)
    const isNearby = (e) => {
      if (e.p === homePin) return false;
      const km = useGeo && e.lat != null && e.lng != null ? haversineKm(home, e) : null;
      if (km != null && km <= NEARBY_KM) return true;
      if (home.s && norm(e.s) !== norm(home.s)) return false;
      if (!(sameDistrict(e) || e.p.startsWith(pre3))) return false;
      return km == null || km <= NEARBY_MAX_KM;
    };
    const nearbyPool = data.filter(isNearby);
    nearbyPool.sort((a, b) => cmp(key(a), key(b)));
    const nearbyPicked = take(nearbyPool.slice(0, o.nearbyCap));
    const nearbyOn = !skip.has("nearby");
    const nearbyAll = new Set(nearbyOn ? nearbyPool.map((e) => e.p) : []);
    // Every district of the state gets a representative in the state tier, picked
    // from outside the nearby radius when it has one. (Excluding the WHOLE nearby
    // pool, as a later version did, wiped out districts near home and shrank
    // "Rest of state".)
    tiers.push({ id: "nearby", label: "Nearby pincodes", total: nearbyPool.length, pins: nearbyPicked });

    // ---- same state (or same 2-digit postal region when state is unknown) ----
    let statePool, stateLabel;
    if (home.s) {
      statePool = data.filter((e) => norm(e.s) === norm(home.s));
      stateLabel = `Rest of ${home.s}`;
    } else {
      statePool = data.filter((e) => e.p.startsWith(homePin.slice(0, 2)));
      stateLabel = "Same postal region";
    }
    const stateSet = new Set(statePool.map((e) => e.p));
    const stateGroups = groupBy(statePool.filter((e) => !seen.has(e.p)),
      (e) => norm(e.d) || e.p.slice(0, 3));
    // Within a district, prefer pincodes outside the nearby radius (spreads coverage).
    for (const [k, list] of stateGroups) {
      const outside = list.filter((e) => !nearbyAll.has(e.p));
      if (outside.length) stateGroups.set(k, outside);
    }
    const stateRes = pickRepresentatives(stateGroups, key, o.stateCap, o.statePerDistrict);
    tiers.push({ id: "state", label: stateLabel, total: stateRes.total, pins: take(stateRes.pins) });

    // ---- rest of India ----
    const rest = data.filter((e) => !stateSet.has(e.p) && !seen.has(e.p) && !nearbyAll.has(e.p));
    const indiaGroups = groupBy(rest, (e) => {
      const st = norm(e.s) || `region-${e.p.slice(0, 2)}`;
      return o.indiaBy === "district" ? `${st}|${norm(e.d) || e.p.slice(0, 3)}` : st;
    });
    const indiaRes = pickRepresentatives(indiaGroups, key, o.indiaCap, o.indiaPerGroup);
    tiers.push({ id: "india", label: "Rest of India", total: indiaRes.total, pins: take(indiaRes.pins) });

    return tiers.filter((t) => t.id === "home" || t.pins.length > 0);
  }

  return { buildTiers, haversineKm, DEFAULTS };
});
