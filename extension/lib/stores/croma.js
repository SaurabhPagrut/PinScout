/*
 * Croma adapter.
 *
 * Built from a recording of Croma's own delivery check: the product page calls
 *   POST https://api.croma.com/inventory/oms/v2/tms/details-pwa/
 * with the product's id and the pincode, and gets back a fulfilment promise.
 * If stock can be assigned to the pincode, the response lists an "assignment"
 * (with quantity and delivery date).
 *
 * What is confirmed vs assumed:
 *   confirmed  the request shape and the "available" response (from the recording)
 *   assumed    "no assignment" means not deliverable (no unavailable sample yet)
 *   assumed    categoryType "mobile" is accepted for other categories (only a
 *              phone has been recorded)
 * When the response does not look like a promise at all, this reports an error
 * with a preview instead of guessing.
 */
(function (root) {
  // Runs INSIDE the Croma page (MAIN world). Must be fully self-contained.
  async function cromaPageCheck(pin) {
    var m = location.pathname.match(/\/p\/(\d+)/);
    if (!m) {
      return { ok: false, error: "Open a Croma product page (the address should contain /p/ followed by a number)." };
    }
    var itemID = m[1];

    var body = {
      promise: {
        allocationRuleID: "SYSTEM",
        checkInventory: "Y",
        organizationCode: "CROMA",
        sourcingClassification: "EC",
        promiseLines: {
          promiseLine: [{
            fulfillmentType: "HDEL",
            mch: "",
            itemID: itemID,
            lineId: "1",
            categoryType: "mobile",
            reqEndDate: "2500-01-01",
            reqStartDate: "",
            requiredQty: "1",
            shipToAddress: {
              company: "", country: "", city: "", mobilePhone: "", state: "", zipCode: pin,
              extn: { irlAddressLine1: "", irlAddressLine2: "" }
            },
            extn: { widerStoreFlag: "Y" }
          }]
        }
      }
    };

    var res = await fetch("https://api.croma.com/inventory/oms/v2/tms/details-pwa/", {
      method: "POST",
      credentials: "include",
      headers: {
        "Accept": "application/json, text/plain, */*",
        "Content-Type": "application/json",
        // Croma's public web key: it ships inside the site's own JavaScript and is sent by every visitor's browser.
        "oms-apim-subscription-key": "1131858141634e2abe2efb2b3a2a2a5d"
      },
      body: JSON.stringify(body)
    });
    var text = await res.text();
    if (!res.ok) return { ok: false, httpStatus: res.status, preview: text.slice(0, 300) };

    var data;
    try { data = JSON.parse(text); }
    catch (e) { return { ok: false, httpStatus: 200, error: "Croma returned non-JSON data", preview: text.slice(0, 300) }; }

    var promise = data && data.promise;
    if (!promise || typeof promise !== "object") {
      return { ok: false, httpStatus: 200, error: "Unexpected response (no 'promise')", preview: text.slice(0, 300) };
    }

    // XML-to-JSON style responses give an object for one item and an array for several.
    var asList = function (x) { return x == null ? [] : [].concat(x); };
    var option = promise.suggestedOption && promise.suggestedOption.option;
    var lines = asList(option && option.promiseLines && option.promiseLines.promiseLine);
    var line = lines.filter(function (l) { return String(l.itemID) === itemID; })[0] || lines[0];
    var assignments = asList(line && line.assignments && line.assignments.assignment);
    var good = assignments.filter(function (a) { return Number(a.quantity) > 0; })[0];

    var h1 = document.querySelector("h1");
    var title = (h1 && h1.textContent.trim()) || document.title || "";

    if (!good) return { ok: true, serviceable: false, title: title };
    return {
      ok: true,
      serviceable: true,
      soldOut: false,
      stock: "assigned " + good.quantity,
      title: title,
      eta: good.deliveryDate ? "Delivery by " + String(good.deliveryDate).slice(0, 10) : ""
    };
  }

  root.Adapters.register({ id: "croma", pageCheck: cromaPageCheck });
})(typeof self !== "undefined" ? self : this);
