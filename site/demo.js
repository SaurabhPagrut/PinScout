// The "Try the search plan" box on the landing page: runs the extension's own planner (js/planner.js, copied from
// extension/lib/planner.js) on the India Post data (data/pincodes.json, loaded the first time it's needed), in the
// visitor's browser. Nothing is sent anywhere; no store is asked. Builds the result with elements, never innerHTML.
(function () {
  "use strict";
  const form = document.getElementById("demoForm");
  if (!form) return;
  const pinEl = document.getElementById("demoPin"), nearbyEl = document.getElementById("demoNearby"), out = document.getElementById("demoOut");
  let data = null, loading = null;
  const load = () => loading || (loading = fetch("/data/pincodes.json").then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }).then((d) => (data = d)));
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const place = (e) => e.d ? `${e.p} ${e.d}` : e.p;
  const SHOW = 8;

  function render(pin) {
    const home = data.find((e) => e.p === pin);
    const opts = nearbyEl.value === "all" ? { nearbyCap: Infinity } : { nearbyCap: Number(nearbyEl.value) };
    const tiers = window.Planner.buildTiers(pin, data, opts);
    out.replaceChildren();
    out.append(el("p", "demo-home", home ? `${pin}: ${home.d}, ${home.s}` : `${pin} isn't in the India Post list, so PinScout borrows the location of the closest pincode with the same first digits.`));
    let total = 0;
    for (const t of tiers) {
      total += t.pins.length;
      const box = el("div", "tier"), head = el("div", "tier-head");
      head.append(el("strong", null, t.label), el("span", null, t.id === "home" ? "checked first" : `${t.pins.length} of ${t.total}`));
      const shown = t.pins.slice(0, SHOW).map(place).join(" · ");
      box.append(head, el("p", "pins", shown + (t.pins.length > SHOW ? ` · +${t.pins.length - SHOW} more` : "")));
      out.append(box);
    }
    const mins = Math.max(1, Math.round(total / 60));
    out.append(el("p", "demo-sum", `${total} pincodes in this order. At about one check a second that's around ${mins} minute${mins === 1 ? "" : "s"} if none is deliverable, but PinScout stops at the first place it is.`));
  }

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const pin = pinEl.value.trim();
    if (!/^[1-9]\d{5}$/.test(pin)) { out.replaceChildren(el("p", "demo-note", "Type a 6-digit pincode, like 560001.")); pinEl.focus(); return; }
    if (!data) out.replaceChildren(el("p", "demo-note", "Loading the India Post pincode list…"));
    try { await load(); render(pin); }
    catch { loading = null; out.replaceChildren(el("p", "demo-note", "Couldn't load the pincode list. Please try again.")); }
  });
  pinEl.addEventListener("focus", () => { load().catch(() => { loading = null; }); }, { once: true });
  nearbyEl.addEventListener("change", () => { if (data && /^[1-9]\d{5}$/.test(pinEl.value.trim())) render(pinEl.value.trim()); });
})();
