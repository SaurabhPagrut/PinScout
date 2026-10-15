/*
 * Flipkart adapter.
 *
 * Flipkart serves each pincode from a specific data centre, so the request
 * may have to be retried on another host (see the DC note in the function).
 */
(function (root) {
  // Runs INSIDE the retailer page (MAIN world) so the user's own cookies and
  // headers are used. Must be fully self-contained: it is serialized by Chrome.
  async function flipkartPageCheck(pin) {
    function find(v, key) {
      if (Array.isArray(v)) {
        for (const x of v) { const r = find(x, key); if (r !== undefined) return r; }
      } else if (v && typeof v === "object") {
        if (Object.prototype.hasOwnProperty.call(v, key)) return v[key];
        for (const x of Object.values(v)) { const r = find(x, key); if (r !== undefined) return r; }
      }
      return undefined;
    }
    // Every value of `key`, with the object that holds it.
    function findAll(v, key, out, depth) {
      out = out || []; depth = depth || 0;
      if (depth > 40) return out;
      if (Array.isArray(v)) v.forEach(function (x) { findAll(x, key, out, depth + 1); });
      else if (v && typeof v === "object") {
        if (Object.prototype.hasOwnProperty.call(v, key)) out.push({ value: v[key], owner: v });
        Object.keys(v).forEach(function (k) { findAll(v[k], key, out, depth + 1); });
      }
      return out;
    }

    const u = new URL(location.href);
    let pageUri = u.pathname;
    const pid = u.searchParams.get("pid");
    if (pid) pageUri += `?pid=${encodeURIComponent(pid)}`;

    const body = JSON.stringify({ pageUri, locationContext: { pincode: pin } });

    // Each pincode is served by a specific data centre; the host prefix is the
    // DC id. A wrong guess returns HTTP 406 / ERROR_CODE 2000 "DC Change" with
    // the right id in RESPONSE.id, so retry on that host and remember it.
    window.__pinscoutDcByPin = window.__pinscoutDcByPin || {};
    let dcId = window.__pinscoutDcByPin[pin] || "1";
    const tried = [];
    let response, raw;

    for (let attempt = 0; attempt < 3; attempt++) {
      tried.push(dcId);
      response = await fetch(`https://${dcId}.rome.api.flipkart.com/api/4/page/fetch`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "Accept": "*/*",
          "X-User-Agent": `${navigator.userAgent} FKUA/website/42/website/Desktop`
        },
        body
      });
      raw = await response.text();
      if (response.status !== 406) break;

      let hint;
      try {
        const j = JSON.parse(raw);
        if (j.ERROR_CODE === 2000 || /DC Change/i.test(j.ERROR_MESSAGE || "")) {
          hint = String(j.RESPONSE?.id ?? j.META_INFO?.dcInfo?.id ?? "");
        }
      } catch { /* not JSON */ }
      if (!hint || tried.includes(hint)) break;
      dcId = hint;
    }

    if (response.ok) window.__pinscoutDcByPin[pin] = dcId;

    if (!response.ok) {
      return { ok: false, httpStatus: response.status, preview: `DC hosts tried: ${tried.join(" -> ")}\n` + raw.slice(0, 300) };
    }

    let data;
    try { data = JSON.parse(raw); }
    catch { return { ok: false, httpStatus: 200, error: "Flipkart returned non-JSON data", preview: raw.slice(0, 300) }; }

    // The page-fetch response holds many widgets, and other products (recommendations) can carry
    // their own "serviceable". When they disagree, trust the one that sits with this pincode or a
    // delivery promise. If that doesn't settle it, keep the first one, as before (Flipkart works
    // today, so an unclear response shouldn't start failing scans).
    const flags = findAll(data, "serviceable").filter((f) => typeof f.value === "boolean");
    if (!flags.length) {
      return { ok: false, httpStatus: 200, error: "Serviceability field not found" };
    }
    let serviceable = flags[0].value;
    if (flags.some((f) => f.value !== serviceable)) {
      const own = flags.filter((f) => JSON.stringify(f.owner).slice(0, 20000).includes(pin) ||
        ["slaText", "deliveryDate", "pincode", "dateText"].some((k) => k in f.owner));
      const values = [...new Set(own.map((f) => f.value))];
      if (values.length === 1) serviceable = values[0];
    }
    const stock = find(data, "availabilityStatus") || "unknown";
    return {
      ok: true,
      serviceable,
      soldOut: stock === "OUT_OF_STOCK",
      stock,
      // The page's own heading is this product; a "title" in the response may be another widget's.
      title: (document.querySelector("h1") && document.querySelector("h1").textContent.trim()) || find(data, "title") || "",
      eta: find(data, "slaText") || ""
    };
  }

  root.Adapters.register({ id: "flipkart", pageCheck: flipkartPageCheck });
})(typeof self !== "undefined" ? self : this);
