/*
 * Myntra adapter (EXPERIMENTAL).
 *
 * From two recordings: Myntra's own delivery check is
 *   POST /gateway/v3/serviceability/check
 * It carries the pincode in the body and in an x-location-context header, is not signed,
 * and does not touch the visitor's saved pincode (unlike /gateway/v1/user/locationContext,
 * which this adapter never calls). The body needs product data that only the page has:
 * for every size a skuId, the warehouses holding stock, the price, and the article type.
 *
 * What is confirmed vs assumed:
 *   confirmed  the request/response shape (two recordings, two products)
 *   ASSUMED    where the product data lives in the page (window.__myx ... sizes[].sizeSellerData[])
 *   ASSUMED    that the request works without the site's tracing headers
 * Nothing is guessed silently: if the product data can't be found, the adapter returns an
 * error that lists the structure it did find, so the assumption can be corrected.
 */
(function (root) {
  // Runs INSIDE the Myntra page (MAIN world). Must be fully self-contained.
  async function myntraPageCheck(pin) {
    var pdpRoot = null;
    try { pdpRoot = window.__myx || null; } catch (e) { /* ignore */ }
    if (!pdpRoot) {
      return { ok: false, error: "Couldn't find Myntra's product data on this page (window.__myx is missing). Open a product page and reload it." };
    }

    // 1. find the object that owns a `sizes` array whose items have a skuId
    var found = null, seen = new WeakSet();
    (function dfs(v, path, depth) {
      if (found || !v || typeof v !== "object" || depth > 7 || seen.has(v)) return;
      seen.add(v);
      if (Array.isArray(v.sizes) && v.sizes.some(function (s) { return s && s.skuId != null; })) { found = { pdp: v, path: path }; return; }
      Object.keys(v).slice(0, 200).forEach(function (k) {
        if (found) return;
        var c; try { c = v[k]; } catch (e) { return; }
        dfs(c, path + "." + k, depth + 1);
      });
    })(pdpRoot, "window.__myx", 0);

    var keysOf = function (o, n) { try { return Object.keys(o || {}).slice(0, n || 25); } catch (e) { return []; } };
    if (!found) {
      return { ok: false, error: "Couldn't find a sizes[] list with skuId in the page data. Top-level keys of window.__myx: " + keysOf(pdpRoot).join(", ") };
    }
    var pdp = found.pdp;

    // 2. helpers
    var idList = function (list) {
      return (Array.isArray(list) ? list : []).map(function (w) {
        return String(w && typeof w === "object" ? (w.warehouseId != null ? w.warehouseId : w.id) : w);
      }).filter(function (x) { return x && x !== "undefined" && x !== "null"; });
    };
    var firstNum = function () {
      for (var i = 0; i < arguments.length; i++) { var n = Number(arguments[i]); if (arguments[i] != null && arguments[i] !== "" && isFinite(n)) return n; }
      return null;
    };
    var findStr = function (obj, names, depth) {
      if (!obj || typeof obj !== "object" || depth > 4) return "";
      for (var i = 0; i < names.length; i++) if (typeof obj[names[i]] === "string" && obj[names[i]]) return obj[names[i]];
      var ks = keysOf(obj, 60);
      for (var j = 0; j < ks.length; j++) { var r = findStr(obj[ks[j]], names, depth + 1); if (r) return r; }
      return "";
    };

    // 3. one item per size that has stock somewhere
    var items = [], sawWarehouseData = false;
    pdp.sizes.forEach(function (sz) {
      if (!sz || sz.skuId == null) return;
      var sellers = [].concat(sz.sizeSellerData || sz.sellers || []).filter(Boolean);
      var withStock = sellers.filter(function (s) { return idList(s.warehouses || s.availableInWarehouses).length; })[0];
      var any = sellers[0];
      var wh = idList((withStock || any || {}).warehouses || (withStock || any || {}).availableInWarehouses || sz.warehouses || sz.availableInWarehouses);
      if (withStock || any || sz.warehouses || sz.availableInWarehouses) sawWarehouseData = true;
      if (!wh.length) return;                                 // sold out in this size
      var s = withStock || any || {};
      var price = firstNum(s.discountedPrice, s.sellingPrice, s.price, sz.discountedPrice, sz.price,
        pdp.price && pdp.price.discounted, pdp.discountedPrice, pdp.mrp);
      items.push({
        itemReferenceId: String(s.sellerPartnerId != null ? s.sellerPartnerId : (sz.sellerPartnerId != null ? sz.sellerPartnerId : "")),
        skuId: String(sz.skuId),
        procurementTimeInDays: firstNum(s.procurementTimeInDays, sz.procurementTimeInDays) || 0,
        availableInWarehouses: wh,
        itemValue: price,
        isHazmat: false, isLarge: false, isJewellery: false, isFragile: false,
        codValue: price, codEnabled: true, tryAndBuyEnabled: false,
        isExchangeable: true, isReturnable: true, openBoxPickupEnabled: true,
        articleType: findStr(pdp.analytics || pdp, ["articleType"], 0),
        measurementModeEnabled: false, sampleModeEnabled: false,
        articleGender: findStr(pdp.analytics || pdp, ["articleGender", "gender"], 0)
      });
    });

    if (!items.length) {
      if (!sawWarehouseData) {
        var z = pdp.sizes[0] || {};
        return { ok: false, error: "Found the sizes but no warehouse data. Keys of pdp: " + keysOf(pdp).join(", ") +
          " | keys of sizes[0]: " + keysOf(z).join(", ") + " | keys of sizes[0].sizeSellerData[0]: " + keysOf((z.sizeSellerData || [])[0]).join(", ") };
      }
      // No size has stock in any warehouse, so no pincode can get it.
      return { ok: true, serviceable: false, soldOut: true, soldOutEverywhere: true, title: pdp.name || document.title || "" };
    }
    if (items.some(function (i) { return i.itemValue == null; })) {
      return { ok: false, error: "Found sizes and warehouses but not the price. Keys of pdp: " + keysOf(pdp).join(", ") };
    }

    // 4. the request
    var idMatch = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    var cookieVal = function (name) {
      var m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
      if (!m) return "";
      var dec = m[1]; try { dec = decodeURIComponent(m[1]); } catch (e) { /* keep raw */ }
      var u = dec.match(idMatch);
      return u ? u[0] : "";
    };
    var deviceId = cookieVal("_d_id") || cookieVal("deviceId");
    var headers = {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "X-Requested-With": "browser",
      "X-myntraweb": "Yes",
      "x-location-context": "pincode=" + pin + ";source=USER"
    };
    if (deviceId) {
      headers["deviceId"] = deviceId;
      headers["x-meta-app"] = "deviceId=" + deviceId + ";appFamily=" + navigator.userAgent + ";reqChannel=web;channel=web;";
    }

    var res = await fetch("/gateway/v3/serviceability/check", {
      method: "POST",
      credentials: "include",
      headers: headers,
      body: JSON.stringify({
        pincode: pin,
        clientId: "2297",
        paymentMode: "ALL",
        serviceTypes: ["FORWARD", "EXCHANGE", "RETURN"],
        shippingMethod: "ALL",
        clientReferenceId: "guest_" + Date.now(),
        items: items
      })
    });
    var text = await res.text();
    if (!res.ok) return { ok: false, httpStatus: res.status, preview: text.slice(0, 300) };

    var data;
    try { data = JSON.parse(text); }
    catch (e) { return { ok: false, httpStatus: 200, error: "Myntra returned non-JSON data", preview: text.slice(0, 300) }; }
    var entries = data && data.itemServiceabilityEntries;
    if (!Array.isArray(entries)) {
      return { ok: false, httpStatus: 200, error: "Unexpected response (no itemServiceabilityEntries)", preview: text.slice(0, 300) };
    }

    var ok = entries.filter(function (e) { return e && e.serviceable === true; });
    return {
      ok: true,
      serviceable: ok.length > 0,
      soldOut: false,
      stock: ok.length + " of " + items.length + " sizes deliverable",
      title: pdp.name || document.title || "",
      eta: ""
    };
  }

  root.Adapters.register({ id: "myntra", pageCheck: myntraPageCheck });
})(typeof self !== "undefined" ? self : this);
