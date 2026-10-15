/*
 * Amazon.in adapter.
 *
 * Built from a recording of Amazon's own "enter pincode" flow when the
 * visitor is signed out (the LOCATION_INPUT flow — no saved address needed):
 *
 *   1. GET  /portal-migration/hz/glow/get-rendered-address-selections
 *      → an HTML fragment for the location popover, which carries a fresh
 *        anti-csrftoken-a2z value needed by step 2.
 *   2. POST /portal-migration/hz/glow/address-change
 *      body: { locationType:"LOCATION_INPUT", zipCode, deviceType:"web",
 *              storeContext, pageType, actionSource:"glow" }
 *      → this actually changes the browser's delivery location (a side
 *        effect!), and answers with isValidAddress/successful — but NOT
 *        with whether this specific product can be delivered there.
 *
 * Amazon doesn't return the delivery verdict as JSON: it's rendered into the
 * product page's own HTML (the "availability"/buy-box block). So after
 * changing the location, this adapter re-fetches the product page itself and
 * reads that block out of the HTML.
 *
 * Because step 2 changes the visitor's delivery location, the adapter saves
 * the original pincode before the scan (begin) and restores it afterward
 * (end), so the visitor's own Amazon session isn't left pointed somewhere
 * random. The saved pincode is also kept in chrome.storage until it has been
 * put back, so a scan cut short by closing the panel is restored the next
 * time the panel opens. While a scan runs, other Amazon tabs see the
 * location change too: it's one setting per browser session.
 *
 * What is confirmed vs assumed:
 *   confirmed  the address-change request/response shape (from the recording; re-recorded
 *              2026-10-03: Amazon also sends x-amzn-flow-closure-id, and the location
 *              link is now #contextualIngressPtLink)
 *   confirmed  storeContext lives at window.Twister.globalAjaxParameters.storeID
 *              and pageType at window.ue_pty (from the recording's state scan)
 *   assumed    the availability verdict can be read from #availability /
 *              #outOfStock / the buy-box buttons on the reloaded page — this
 *              is Amazon's long-standing markup, but Amazon changes markup
 *              often, so this is marked experimental and fails closed (an
 *              error, not a guess) when it can't find those elements.
 * This adapter is marked experimental in data/stores.json.
 */
(function (root) {
  // Runs INSIDE the Amazon page (MAIN world). Must be fully self-contained.
  // setOnly: just change the delivery pincode (used to put the visitor's own pincode back).
  async function amazonPageCheck(pin, setOnly) {
    // Amazon guards address-change with a two-step token. The page's own location link carries a
    // starter token in its data-a-modal JSON (ajaxHeaders["anti-csrftoken-a2z"]); sending that to
    // get-rendered-address-selections returns the popover HTML holding the real one (CSRF_TOKEN).
    // Without it, address-change answers HTTP 200 with an empty body and nothing changes.
    function modalConfig() {
      var link = document.querySelector("[data-a-modal*='address-selections']") ||
        document.querySelector("#contextualIngressPtLink, #nav-global-location-popover-link, #glow-ingress-block");
      var holder = link && (link.getAttribute("data-a-modal") ? link : link.closest("[data-a-modal]") || link.querySelector("[data-a-modal]"));
      try { return holder ? JSON.parse(holder.getAttribute("data-a-modal")) : null; } catch (e) { return null; }
    }
    function starterToken(cfg) {
      var t = cfg && cfg.ajaxHeaders && cfg.ajaxHeaders["anti-csrftoken-a2z"];
      if (t) return t;
      var input = document.querySelector("input[name='anti-csrftoken-a2z']");
      if (input && input.value) return input.value;
      var m = document.documentElement.innerHTML.match(/anti-csrftoken-a2z(?:&quot;|["'])\s*:\s*(?:&quot;|["'])([^"'&]+)/);
      return m ? m[1] : null;
    }
    async function csrfToken(storeContext, pageType) {
      var cfg = modalConfig();
      var starter = starterToken(cfg);
      var url = (cfg && cfg.url) ||
        ("/portal-migration/hz/glow/get-rendered-address-selections?deviceType=desktop&pageType=" +
          encodeURIComponent(pageType) + "&storeContext=" + encodeURIComponent(storeContext) + "&actionSource=desktop-modal");
      var headers = { "Accept": "text/html,*/*", "X-Requested-With": "XMLHttpRequest" };
      if (starter) headers["anti-csrftoken-a2z"] = starter;
      try {
        var res = await fetch(url, { credentials: "include", headers: headers });
        var text = await res.text();
        var m = text.match(/CSRF_TOKEN\s*:\s*["']([^"']+)["']/) ||
          text.match(/name=["']anti-csrftoken-a2z["']\s+value=["']([^"']+)["']/) ||
          text.match(/anti-csrftoken-a2z["']?\s*[:=]\s*["']([^"']+)["']/);
        var f = text.match(/flow-?closure-?id["']?\s*[:=]\s*["']?(\d+)/i) ||
          document.documentElement.innerHTML.match(/flow-?closure-?id(?:&quot;|["'])?\s*[:=]\s*(?:&quot;|["'])?(\d+)/i);
        flowClosureId = f ? f[1] : null;
        return m ? m[1] : starter;
      } catch (e) { return starter; }
    }
    var flowClosureId = null;

    async function setZip(zip, storeContext, pageType, csrf) {
      var headers = { "Accept": "text/html,*/*", "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" };
      if (csrf) headers["anti-csrftoken-a2z"] = csrf;
      if (flowClosureId) headers["x-amzn-flow-closure-id"] = flowClosureId;
      var res = await fetch("/portal-migration/hz/glow/address-change?actionSource=glow", {
        method: "POST", credentials: "include", headers,
        body: JSON.stringify({ locationType: "LOCATION_INPUT", zipCode: zip, deviceType: "web", storeContext, pageType, actionSource: "glow" })
      });
      var text = await res.text();
      if (!res.ok) return { ok: false, status: res.status, text };
      var data;
      try { data = JSON.parse(text); } catch (e) {
        return { ok: false, status: res.status, text: text,
          error: csrf ? "Amazon didn't accept the pincode change. Reload the Amazon page and try again."
                      : "Couldn't get Amazon's security token from this page. Reload the Amazon product page and try again." };
      }
      return { ok: true, data };
    }

    try {
      var cfgUrl = (modalConfig() || {}).url || "";
      var fromUrl = function (k) { var m = cfgUrl.match(new RegExp("[?&]" + k + "=([^&]+)")); return m ? decodeURIComponent(m[1]) : ""; };
      var storeContext = fromUrl("storeContext") || (window.Twister && window.Twister.globalAjaxParameters && window.Twister.globalAjaxParameters.storeID) || "";
      if (!storeContext) {
        var scripts = document.getElementsByTagName("script");
        for (var i = 0; i < scripts.length && !storeContext; i++) {
          var t = scripts[i].textContent || "";
          var sm = t.match(/"storeID"\s*:\s*"([^"]+)"/) || t.match(/storeID\s*[:=]\s*['"]([^'"]+)['"]/);
          if (sm) storeContext = sm[1];
        }
      }
      if (!storeContext) storeContext = "generic";
      var pageType = fromUrl("pageType") || window.ue_pty || "Detail";

      var csrf = await csrfToken(storeContext, pageType);
      var setRes = await setZip(pin, storeContext, pageType, csrf);
      if (!setRes.ok) {
        return { ok: false, httpStatus: setRes.status, error: setRes.error, preview: String(setRes.text || "").slice(0, 300) };
      }
      if (setOnly) return { ok: true };
      // Amazon has answered these flags as 1; accept true / "1" too so a format change can't
      // quietly turn every pincode into "unavailable".
      var yes = function (v) { return v === 1 || v === true || v === "1" || v === "true"; };
      if (setRes.data && !yes(setRes.data.successful) && !yes(setRes.data.isValidAddress)) {
        // Amazon rejected the pincode outright — not a valid/serviceable Indian pincode.
        return { ok: true, serviceable: false, title: "", stock: "Amazon rejected this pincode" };
      }

      var pageRes = await fetch(location.href, { credentials: "include" });
      var html = await pageRes.text();
      var doc = new DOMParser().parseFromString(html, "text/html");

      var titleEl = doc.querySelector("#productTitle");
      var title = titleEl ? titleEl.textContent.trim() : (doc.title || "").trim();

      var textOf = function (sel) {
        var el = doc.querySelector(sel);
        return el ? el.textContent.trim().replace(/\s+/g, " ") : "";
      };
      var availText = textOf("#availability") || textOf("#outOfStock");
      // Where Amazon says it can't ship to the selected location. The buy box can still be
      // rendered next to this message, so it has to be read, not just the buttons.
      var deliveryText = [
        "#exports_desktop_undeliverable_buybox", "#deliveryBlockMessage",
        "#mir-layout-DELIVERY_BLOCK"
      ].map(textOf).filter(Boolean).join(" ");
      var buyButton = doc.querySelector("#add-to-cart-button, #buy-now-button, #one-click-button");
      var hasBuyBox = !!buyButton && !buyButton.disabled && !buyButton.hasAttribute("disabled");

      if (!availText && !deliveryText && !hasBuyBox) {
        return { ok: false, error: "Couldn't find the availability block on the reloaded page (Amazon may have changed its markup).", preview: html.slice(0, 300) };
      }

      var lower = (availText + " " + deliveryText).toLowerCase();
      var undeliverable = !!doc.querySelector("#exports_desktop_undeliverable_buybox") ||
        /cannot be (delivered|shipped)|can.t be (delivered|shipped)|(does not|doesn.t|do not|don.t) (deliver|ship)|not (deliverable|serviceable)|not available (for delivery |)(at|in|to) (your|this|the selected)|not eligible for (delivery|shipping)|no delivery to/.test(lower);
      var outOfStock = !!doc.querySelector("#outOfStock") ||
        /currently unavailable|out of stock|we don.t know when|unavailable from this seller/.test(lower);
      // "eligible for" only counts when it isn't "not eligible for".
      var saysAvailable = /in stock|usually ships|available from these sellers|only \d+ left/.test(lower) ||
        /(^|[^t] )eligible for/.test(lower);

      var serviceable = !undeliverable && !outOfStock && (saysAvailable || hasBuyBox);
      var etaMatch = (availText + " " + deliveryText).match(/([A-Z][a-z]{2,8},?\s+\d{1,2}\s+[A-Z][a-z]{2,8}|\d{1,2}\s+[A-Z][a-z]{2,8}\s*-\s*\d{1,2}\s+[A-Z][a-z]{2,8})/);
      return {
        ok: true,
        serviceable: serviceable,
        soldOut: outOfStock && !hasBuyBox,
        stock: undeliverable ? "doesn't deliver here" : outOfStock ? "out of stock" : "",
        title: title,
        eta: serviceable && etaMatch ? etaMatch[0] : ""
      };
    } catch (e) {
      return { ok: false, error: (e && e.message) || String(e) };
    }
  }

  // Runs INSIDE the page too (via Adapters.runInPage), but standalone —
  // Chrome only serializes the one function it's given.
  async function amazonReadZip() {
    try {
      var res = await fetch(
        "/portal-migration/hz/glow/get-location-label?storeContext=generic&pageType=Detail&actionSource=desktop-modal",
        { credentials: "include", headers: { "Accept": "*/*", "X-Requested-With": "XMLHttpRequest" } }
      );
      var data = await res.json();
      return { zip: (data && data.selectedDestination && data.selectedDestination.destinationValue) || null };
    } catch (e) { return { zip: null }; }
  }

  // The pincode to put back is also kept in chrome.storage until it has been restored. If the
  // side panel is closed mid-scan, end() never runs; the next time the panel opens it finishes
  // the restore. A scan started before that happens must not save the scanned pincode it finds
  // in the page as the "original", so begin() prefers the one already pending.
  var PENDING_KEY = "amazonPendingRestore";
  var storage = function () { return (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) || null; };
  async function readPending() {
    try { var got = await storage().get(PENDING_KEY); return (got && got[PENDING_KEY]) || null; } catch (e) { return null; }
  }
  async function writePending(v) {
    try { if (v) await storage().set({ [PENDING_KEY]: v }); else await storage().remove(PENDING_KEY); } catch (e) { /* best effort */ }
  }
  async function restore(tabId, zip) {
    try {
      var out = await root.Adapters.runInPage(tabId, amazonPageCheck, [zip, true]);
      return !!(out && out.ok);
    } catch (e) { return false; }
  }

  async function finishPendingRestore() {
    var pending = await readPending();
    if (!pending || !pending.zip || typeof chrome === "undefined" || !chrome.tabs) return;
    var tabIds = [];
    try { var t = await chrome.tabs.get(pending.tabId); if (/^https:\/\/([a-z0-9-]+\.)*amazon\.in\//i.test(t.url || "")) tabIds.push(t.id); } catch (e) { /* tab gone */ }
    try { (await chrome.tabs.query({ url: "https://*.amazon.in/*" })).forEach(function (t) { if (tabIds.indexOf(t.id) === -1) tabIds.push(t.id); }); } catch (e) { /* no access */ }
    for (var i = 0; i < tabIds.length; i++) {
      if (await restore(tabIds[i], pending.zip)) { await writePending(null); return; }
    }
    // No Amazon tab open: try again next time the panel opens.
  }

  root.Adapters.register({
    id: "amazon",
    pageCheck: amazonPageCheck,
    async begin(tabId) {
      var pending = await readPending();
      if (pending && pending.zip) { await writePending({ zip: pending.zip, tabId: tabId }); return { originalZip: pending.zip }; }
      try {
        var out = await root.Adapters.runInPage(tabId, amazonReadZip, []);
        var zip = out && out.zip;
        if (zip) await writePending({ zip: zip, tabId: tabId });
        return { originalZip: zip };
      } catch (e) { return null; }
    },
    async end(tabId, session) {
      if (session && session.originalZip && await restore(tabId, session.originalZip)) await writePending(null);
    }
  });

  if (storage()) finishPendingRestore();
})(typeof self !== "undefined" ? self : this);
