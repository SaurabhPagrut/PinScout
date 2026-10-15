/*
 * Finds WHERE in a store page's JavaScript state certain known values live.
 *
 * Use it when a store's delivery check needs product data from the page (for example
 * Myntra sends the SKU id, price and warehouse list). Paste the whole thing into the
 * browser console (F12 > Console) on the product page, then paste the output back.
 *
 * 1. Edit TARGETS: put values you saw in the recording, as strings.
 * 2. It prints only the PATHS where those values were found (plus the values themselves),
 *    never the rest of the page state.
 */
(() => {
  const TARGETS = ["114210277", "64780", "4076", "Handbags", "949"];   // <- edit me
  const MAX_HITS = 60, MAX_NODES = 300000, MAX_DEPTH = 9;

  const baseline = new Set((() => {
    const f = document.createElement("iframe");
    document.body.appendChild(f);
    const keys = Object.keys(f.contentWindow);
    f.remove();
    return keys;
  })());

  const hits = [], seen = new WeakSet();
  let nodes = 0;
  const walk = (v, path, depth) => {
    if (hits.length >= MAX_HITS || nodes++ > MAX_NODES || depth > MAX_DEPTH || v === null || v === undefined) return;
    if (typeof v === "object") {
      if (typeof Node !== "undefined" && v instanceof Node) return;      // skip DOM nodes
      if (seen.has(v)) return;
      seen.add(v);
      let keys;
      try { keys = Object.keys(v); } catch { return; }
      for (const k of keys.slice(0, 400)) {
        let child;
        try { child = v[k]; } catch { continue; }
        walk(child, path + (Array.isArray(v) ? `[${k}]` : "." + k), depth + 1);
      }
    } else if (TARGETS.includes(String(v))) {
      hits.push(`${path} = ${String(v)}`);
    }
  };

  for (const k of Object.keys(window)) if (!baseline.has(k)) walk(window[k], "window." + k, 0);

  document.querySelectorAll("script").forEach((s, i) => {
    const text = s.textContent || "";
    if (text.length > 200) for (const t of TARGETS) if (text.includes(t)) hits.push(`<script #${i}${s.id ? " id=" + s.id : ""}${s.type ? " type=" + s.type : ""}> contains ${t}`);
  });

  console.log(hits.length ? hits.slice(0, MAX_HITS).join("\n") : "No hits. Check TARGETS against the recording.");
})();
