/*
 * Reliance Digital adapter.
 *
 * Built from a recording (2026-10-03) of the product page's own "Apply pincode"
 * flow. The verdict comes from:
 *
 *   POST /ext/raven-api/inventory/multi/articles-v2
 *   body: { articles: [{ article_id, custom_json, quantity: 0 }],
 *           phone_number, pincode, request_page: "pdp" }
 *
 * The answer is JSON. For a pincode it can't serve, the recording returned
 *   data.success: false, data.error.message "Not available for your pincode",
 *   and the article's own error { type: "OutOfStockError", message: "Out of Stock" }.
 * Each article also carries promise.formatted { min, max } delivery dates.
 *
 * The product's article id and custom_json come from the page's own state
 * (window.FPI.state.product, the Fynd storefront store).
 *
 * What is confirmed vs assumed:
 *   confirmed  request URL, body shape and the "not available" response
 *   assumed    an available pincode answers success: true with no article error
 *              (no available sample was recorded yet)
 *   assumed    the endpoint accepts the call without the page's x-fp-signature
 *              header (the recording shows the page sends one; it was masked).
 *              If Reliance rejects it, this reports an error, not a guess.
 * This adapter is marked experimental in data/stores.json.
 */
(function (root) {
  // Runs INSIDE the Reliance Digital page (MAIN world). Must be fully self-contained.
  async function relianceDigitalPageCheck(pin) {
    function unwrap(x) { return x && x._data !== undefined ? x._data : x; }
    function productFromPage() {
      try {
        var p = unwrap(window.FPI && window.FPI.state && window.FPI.state.product);
        p = p && (p.product || p);
        if (p && (p.item_code || p.uid)) return p;
      } catch (e) { /* fall through */ }
      try {
        var s = window.__INITIAL_STATE__;
        var q = s && s.productDetailsPage && s.productDetailsPage.product;
        if (q && (q.item_code || q.uid)) return q;
      } catch (e) { /* none */ }
      return null;
    }

    var product = productFromPage();
    if (!product) {
      return { ok: false, error: "Couldn't read the product from this page. Open a Reliance Digital product page and let it finish loading." };
    }
    var articleId = String(product.item_code || (product.attributes && product.attributes.item_code) || "");
    if (!articleId) return { ok: false, error: "This product has no article id on the page." };
    var customJson = product._custom_json || product.custom_json || {};
    var title = product.name || document.title || "";

    var res = await fetch("/ext/raven-api/inventory/multi/articles-v2", {
      method: "POST",
      credentials: "include",
      headers: { "Accept": "application/json, text/plain, */*", "Content-Type": "application/json", "x-user-data": "{}" },
      body: JSON.stringify({
        articles: [{ article_id: articleId, custom_json: customJson, quantity: 0 }],
        phone_number: "",
        pincode: pin,
        request_page: "pdp"
      })
    });
    var text = await res.text();
    if (!res.ok) return { ok: false, httpStatus: res.status, preview: text.slice(0, 300) };

    var json;
    try { json = JSON.parse(text); }
    catch (e) { return { ok: false, httpStatus: res.status, error: "Reliance Digital returned non-JSON data", preview: text.slice(0, 300) }; }

    var data = json && json.data;
    var articles = (data && data.articles) || [];
    var article = articles.filter(function (a) { return String(a.article_id) === articleId; })[0] || articles[0];
    if (!data || typeof data.success !== "boolean" || !article) {
      return { ok: false, httpStatus: res.status, error: "Unexpected response (no articles or success flag)", preview: text.slice(0, 300) };
    }

    var artErr = article.error && (article.error.type || article.error.message) ? article.error : null;
    var topErr = data.error && (data.error.type || data.error.message) ? data.error : null;
    var serviceable = data.success === true && !artErr;
    var f = article.promise && article.promise.formatted;
    var eta = serviceable && f && f.min ? (f.max && f.max !== f.min ? f.min + " – " + f.max : f.min) : "";
    var stock = serviceable ? "" :
      (topErr && topErr.message) || (artErr && artErr.message) || "Not available for this pincode";
    return { ok: true, serviceable: serviceable, title: title, stock: stock, eta: eta };
  }

  root.Adapters.register({ id: "reliancedigital", pageCheck: relianceDigitalPageCheck });
})(typeof self !== "undefined" ? self : this);
