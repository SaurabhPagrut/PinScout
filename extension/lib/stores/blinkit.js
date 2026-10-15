/*
 * Blinkit adapter.
 *
 * Built from a recording of Blinkit's own "change delivery location" flow:
 *
 *   1. GET /location/autoSuggest?query=<pincode>&lat=..&lng=..
 *      → address suggestions; the one whose subtitle contains the pincode
 *        carries a place_id and (lat/lon via location/info below).
 *   2. GET /location/info?place_id=..&title=..&description=..
 *      → { is_serviceable, is_available, coordinate:{lat,lon} } for that spot.
 *        This is Blinkit's own answer to "do we deliver here at all" — it's
 *        a dark-store coverage check, independent of any one product.
 *   3. POST /v1/layout/product/<id>  (with lat/lon headers set to the spot)
 *      → the product's page layout, which is scanned for an out-of-stock
 *        marker to get a product-specific verdict.
 *
 * Every request in the recording carried custom headers (access_token,
 * auth_key, session_uuid, device_id) that were masked because they're
 * per-session, not secrets tied to Blinkit itself. Rather than copy the
 * masked values (which would be someone else's session and wouldn't work),
 * this adapter reads them from the *current* visitor's own cookies/
 * localStorage at check time — the same idea as the Myntra adapter reading
 * its device id from a cookie.
 *
 * This adapter deliberately never calls the endpoint that would save the
 * looked-up address as the account's delivery location (that happens only
 * when a person clicks the address in Blinkit's own UI) — steps 1-3 above
 * are read-only lookups, so nothing is left changed after a scan.
 *
 * What is confirmed vs assumed:
 *   confirmed  the autoSuggest / location-info shapes and fields (recording)
 *   assumed    which cookie/localStorage keys hold the session headers —
 *              if none are found, the endpoints may still answer (they may
 *              not require full auth for read-only lookups), but if Blinkit
 *              does require them this will show as an HTTP 401/403 error
 *              rather than a wrong guess
 *   assumed    the product layout response carries stock flags (is_sold_out,
 *              in_stock, inventory, ...) on an object whose product_id / id is
 *              this product — not yet confirmed against a real recording. If no
 *              such object is found this reports an error instead of guessing
 * This adapter is marked experimental in data/stores.json.
 */
(function (root) {
  // Runs INSIDE the Blinkit page (MAIN world). Must be fully self-contained.
  async function blinkitPageCheck(pin) {
    // Defined in here, not beside it: Chrome serialises only this one function into the page.
    function findBlinkitHeaders() {
      var h = {};
      function note(k, v) {
        if (typeof v !== "string" || !v) return;
        if (/access.?token/i.test(k) && !h.access_token) h.access_token = v;
        else if (/auth.?key/i.test(k) && !h.auth_key) h.auth_key = v;
        else if (/session.?uuid/i.test(k) && !h.session_uuid) h.session_uuid = v;
        else if (/device.?id/i.test(k) && !h.device_id) h.device_id = v;
      }
      function walk(o, depth) {
        if (!o || typeof o !== "object" || depth > 4) return;
        Object.keys(o).forEach(function (k) {
          var v = o[k];
          if (typeof v === "string") note(k, v);
          else if (v && typeof v === "object") walk(v, depth + 1);
        });
      }
      try {
        var flat = {};
        for (var i = 0; i < localStorage.length; i++) {
          var key = localStorage.key(i);
          var raw = localStorage.getItem(key);
          flat[key] = raw;
          note(key, raw);
          if (raw && (raw[0] === "{" || raw[0] === "[")) {
            try { walk(JSON.parse(raw), 0); } catch (e) { /* not JSON */ }
          }
        }
      } catch (e) { /* localStorage unavailable */ }
      try {
        document.cookie.split(";").forEach(function (p) {
          var idx = p.indexOf("=");
          if (idx < 0) return;
          var k = p.slice(0, idx).trim();
          var v = p.slice(idx + 1);
          try { v = decodeURIComponent(v); } catch (e) { /* keep raw */ }
          note(k, v);
          note(k.replace(/^gr_1_/, ""), v);
        });
      } catch (e) { /* cookies unavailable */ }
      return h;
    }

    try {
      var m = location.pathname.match(/\/prid\/(\d+)/);
      if (!m) return { ok: false, error: "Open a Blinkit product page (the address should contain /prid/ followed by a number)." };
      var productId = m[1];

      var found = findBlinkitHeaders();
      var baseHeaders = { "Content-Type": "application/json", "app_client": "consumer_web" };
      Object.keys(found).forEach(function (k) { baseHeaders[k] = found[k]; });

      var sugRes = await fetch(
        "https://blinkit.com/location/autoSuggest?query=" + encodeURIComponent(pin) + "&lat=20.5937&lng=78.9629",
        { credentials: "include", headers: baseHeaders }
      );
      if (!sugRes.ok) return { ok: false, httpStatus: sugRes.status, preview: (await sugRes.text()).slice(0, 300) };
      var sug = await sugRes.json();
      var suggestions = (sug && sug.ui_data && sug.ui_data.suggestions) || [];
      var hit = suggestions.filter(function (s) {
        var sub = (s.subtitle && s.subtitle.text) || "";
        return sub.indexOf(pin) !== -1;
      })[0];
      // Blinkit only covers some cities: no place for this pincode means it can't deliver there.
      if (!hit) return { ok: true, serviceable: false, title: "", stock: "no Blinkit location for this pincode" };

      var placeId = hit.meta && hit.meta.place_id;
      var sessionToken = hit.meta && hit.meta.session_token;
      var infoUrl = "https://blinkit.com/location/info?place_id=" + encodeURIComponent(placeId || "") +
        "&title=" + encodeURIComponent((hit.title && hit.title.text) || "") +
        "&description=" + encodeURIComponent((hit.subtitle && hit.subtitle.text) || "") +
        "&is_pin_moved=false" + (sessionToken ? "&session_token=" + encodeURIComponent(sessionToken) : "");
      var infoRes = await fetch(infoUrl, { credentials: "include", headers: baseHeaders });
      if (!infoRes.ok) return { ok: false, httpStatus: infoRes.status, preview: (await infoRes.text()).slice(0, 300) };
      var info = await infoRes.json();
      var isServiceable = info && info.is_serviceable === true;
      var isAvailable = info && info.is_available !== false;
      if (!isServiceable || !isAvailable) return { ok: true, serviceable: false, title: "" };

      var prodHeaders = {};
      Object.keys(baseHeaders).forEach(function (k) { prodHeaders[k] = baseHeaders[k]; });
      var coord = info && info.coordinate;
      if (coord) { prodHeaders.lat = String(coord.lat); prodHeaders.lon = String(coord.lon); }

      var prodRes = await fetch("https://blinkit.com/v1/layout/product/" + productId, {
        method: "POST", credentials: "include", headers: prodHeaders, body: "{}"
      });
      if (!prodRes.ok) return { ok: false, httpStatus: prodRes.status, preview: (await prodRes.text()).slice(0, 300) };
      var prodText = await prodRes.text();
      var layout;
      try { layout = JSON.parse(prodText); }
      catch (e) { return { ok: false, httpStatus: 200, error: "Blinkit returned non-JSON product data", preview: prodText.slice(0, 300) }; }

      // The layout also lists similar and recommended products, so a "sold out" anywhere in it
      // says nothing about this one. Only stock flags on an object that is this product count.
      var STOCK_KEYS = ["is_sold_out", "sold_out", "in_stock", "inventory", "available_quantity", "is_available"];
      var flags = [], seen = new WeakSet(), nodes = 0;
      (function walk(v, depth) {
        if (!v || typeof v !== "object" || depth > 14 || seen.has(v) || nodes++ > 50000) return;
        seen.add(v);
        if (!Array.isArray(v)) {
          var ids = [v.product_id, v.productId, v.prid, v.id].map(function (x) { return x == null ? "" : String(x); });
          if (ids.indexOf(productId) !== -1) {
            STOCK_KEYS.forEach(function (k) { if (k in v && v[k] != null && typeof v[k] !== "object") flags.push([k, v[k]]); });
          }
        }
        Object.keys(v).forEach(function (k) { walk(v[k], depth + 1); });
      })(layout, 0);

      if (!flags.length) {
        return { ok: false, httpStatus: 200, error: "Couldn't find this product's stock in Blinkit's response (the layout may have changed).", preview: prodText.slice(0, 300) };
      }
      var soldOut = flags.some(function (f) {
        var k = f[0], v = f[1];
        if (k === "is_sold_out" || k === "sold_out") return v === true || v === 1 || v === "true";
        if (k === "in_stock" || k === "is_available") return v === false || v === 0 || v === "false";
        return Number(v) <= 0;   // inventory / available_quantity
      });

      var h1 = document.querySelector("h1");
      var title = (h1 && h1.textContent.trim()) || document.title || "";

      return { ok: true, serviceable: true, soldOut: soldOut, title: title, stock: soldOut ? "" : "in stock" };
    } catch (e) {
      return { ok: false, error: (e && e.message) || String(e) };
    }
  }

  root.Adapters.register({ id: "blinkit", pageCheck: blinkitPageCheck });
})(typeof self !== "undefined" ? self : this);
