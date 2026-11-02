// The GIFs for Product Hunt (or anywhere a GIF is wanted), to BracelTheCat's specification, into dist/gif/:
//   gallery-1270x760.gif: the store screenshot's page (scripts/screenshots.js) with the real side panel: the pointer
//     types a pincode, presses Find availability, the panel scans and shows the nearest place it's available
//     (Product Hunt's gallery size; must stay under its 3 MB)
//   icon-240.gif: the PinScout mark with radar rings going out from it, looping (Product Hunt's thumbnail size)
// Filmed frame by frame on the panel's own virtual clock (the stand-in's __tick) at twice the size, scaled down by the browser, then encoded with
// gifenc: one shared palette, and each frame after the first marks the pixels that did not change as transparent, so
// only what moves is stored. The gallery's last 0.6 s fade into its first frame, so the loop has no jump. The panel's
// background particles are still (reduced motion): they would change every pixel of every frame. In the gallery the
// panel's pauses run at half speed, so a whole scan fits in a short loop.
// Run: node scripts/gif.js [--only gallery|icon]
const fs = require("fs"), path = require("path"), { spawnSync } = require("child_process");
const { playwright, chrome, serve } = require("./browse.js");
const { stub, page, PRODUCT, HOME, FOUND, ETA, STORE_URL } = require("./screenshots.js");

const ROOT = path.join(__dirname, ".."), OUT = path.join(ROOT, "dist/gif"), argv = process.argv.slice(2);
const FPS = 25, XF = 15, DPR = 2, only = argv.includes("--only") ? argv[argv.indexOf("--only") + 1] : null;

/* gifenc, installed next to playwright-core in .check/pw the first time (no dependency in package.json) */
function gifenc() {
  const local = path.join(ROOT, ".check/pw/node_modules/gifenc");
  for (const p of [path.join(ROOT, "node_modules/gifenc"), local]) if (fs.existsSync(p)) return require(p);
  console.log("installing gifenc into .check/pw (once)…");
  const r = spawnSync("npm", ["i", "--prefix", path.join(ROOT, ".check/pw"), "gifenc@1.0.3", "--no-audit", "--no-fund", "--silent"], { stdio: "inherit" });
  if (r.status !== 0) { console.error("Couldn't install gifenc"); process.exit(1); }
  return require(local);
}
const { GIFEncoder, quantize, applyPalette } = gifenc();
const ease = (t) => (t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t));
const lerp = (a, b, t) => a + (b - a) * ease(t);

/* the pointer, in a zero-size host over everything */
const POINTER = () => {
  const h = document.createElement("gif-fx"); Object.assign(h.style, { position: "fixed", left: 0, top: 0, width: 0, height: 0, zIndex: 2147483647, pointerEvents: "none" });
  const r = h.attachShadow({ mode: "open" }); document.documentElement.append(h);
  r.innerHTML = `<svg id="c" viewBox="0 0 26 26" style="position:fixed;left:0;top:0;width:26px;height:26px;display:none;filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))"><path d="M3 2 L3 21 L8 16.5 L11.5 24 L15 22.5 L11.5 15 L18 15 Z" fill="#fff" stroke="#0f172a" stroke-width="1.6" stroke-linejoin="round"/></svg>
    <div id="g" style="position:fixed;left:0;top:0;width:40px;height:40px;margin:-20px 0 0 -20px;border-radius:50%;border:3px solid #5eead4;display:none"></div>`;
  const c = r.getElementById("c"), g = r.getElementById("g");
  window.CUR = (xy, ring) => {
    c.style.display = xy ? "block" : "none"; if (xy) c.style.transform = `translate(${xy[0] - 3}px,${xy[1] - 2}px)`;
    g.style.display = xy && ring > 0 ? "block" : "none"; if (xy && ring > 0) Object.assign(g.style, { transform: `translate(${xy[0]}px,${xy[1]}px) scale(${1.6 - ring * 0.8})`, opacity: ring });
  };
};

/* the icon: the mark in the middle of a square, rings going out from it every second, drawn from the time alone */
const icon = (base) => `<!doctype html><html><head><meta charset="utf-8"><style>*{margin:0}html,body{width:240px;height:240px;overflow:hidden}
body{position:relative;background:radial-gradient(200px 160px at 0% 0%,#7c3aed,rgba(124,58,237,0) 70%),radial-gradient(180px 160px at 100% 100%,#0d9488,rgba(13,148,136,0) 70%),linear-gradient(135deg,#3b1d8f,#24145e 50%,#1e1a52)}
.r{position:absolute;left:120px;top:120px;border-radius:50%;border:2px solid #5eead4}
img{position:absolute;left:60px;top:60px;width:120px;height:120px;border-radius:28px;box-shadow:0 10px 24px rgba(0,0,0,.35)}</style></head>
<body><div class="r"></div><div class="r"></div><div class="r"></div><img src="${base}/extension/icons/icon128.png" alt="">
<script>window.RINGS = (t) => document.querySelectorAll(".r").forEach((e, k) => {
  const p = ((t / 2) + k / 3) % 1, d = 128 + p * 120;
  Object.assign(e.style, { width: d + "px", height: d + "px", margin: -d / 2 + "px 0 0 " + -d / 2 + "px", opacity: (1 - p) * 0.9 });
});</script></body></html>`;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { chromium } = playwright(), srv = await serve(), browser = await chromium.launch({ executablePath: chrome() });

  async function film(g) {
    const [w, h] = g.page;
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: DPR, colorScheme: "light", reducedMotion: "reduce" });
    if (g.panel) await ctx.addInitScript(stub, { url: STORE_URL, found: FOUND, eta: ETA, product: PRODUCT, virtual: true, pace: 0.5, answerMs: 200, seed: 20261102 });
    const pg = await ctx.newPage(), errs = [], frames = [];
    pg.on("pageerror", (e) => errs.push(e.message));
    if (!g.panel) {
      await pg.setContent(icon(srv.base), { waitUntil: "networkidle" });
      for (let i = 0; i < g.dur * FPS; i++) { await pg.evaluate((t) => RINGS(t), i / FPS); frames.push((await pg.screenshot({ type: "png" })).toString("base64")); }
      await ctx.close(); return frames;
    }
    await pg.setContent(page({ w, h, eyebrow: "Out of stock at your pincode?", title: "Find *where it isn’t.*",
      body: "PinScout checks your pincode, then nearby pincodes, your state and the rest of India, and stops at the nearest place it can be delivered.",
      url: "product page on a supported store", base: srv.base, win: { x: 560, y: 64, w: 650 } }), { waitUntil: "load" });
    const f = pg.frames().find((fr) => /sidepanel\.html/.test(fr.url()));
    for (let i = 0; i < 400; i++) {
      if (await f.evaluate(() => /pincodes loaded/.test(document.getElementById("dataInfo")?.textContent || ""))) break;
      await f.evaluate(() => __tick(50)); await new Promise((r) => setTimeout(r, 15));
    }
    await f.evaluate(() => { const s = document.getElementById("nearbyCap"); s.value = "10"; s.dispatchEvent(new Event("change", { bubbles: true })); });
    await pg.evaluate(() => document.fonts.ready); await pg.evaluate(POINTER);
    const at = async (sel, fx = 0.5, fy = 0.5) => {
      const [ix, iy] = await pg.evaluate(() => { const r = document.querySelector(".panel iframe").getBoundingClientRect(); return [r.x, r.y]; });
      const [x, y] = await f.evaluate(([s, fx, fy]) => { const r = document.querySelector(s).getBoundingClientRect(); return [r.x + r.width * fx, r.y + r.height * fy]; }, [sel, fx, fy]);
      return [ix + x * 0.8, iy + y * 0.8];
    };
    const home = [w - 90, h - 80], pin = await at("#pin"), go = await at("#start"), res = await at("#summary", 0.92, 0.12);
    let F = null, end = Infinity, typed = 0, ring = 0, clicked = false;
    for (let i = 0; ; i++) {
      const t = i / FPS;
      if (t >= end) break;
      if (t >= 1.0 && typed < 6) {
        const k = Math.min(6, Math.floor((t - 1.0) / 0.12) + 1);
        if (k > typed) { typed = k; await f.evaluate((v) => { const e = document.getElementById("pin"); e.focus(); e.value = v; e.dispatchEvent(new Event("input", { bubbles: true })); }, HOME.slice(0, k)); }
      }
      if (!clicked && t >= 2.4) { clicked = true; ring = 1; await f.evaluate(() => document.getElementById("start").click()); }
      if (t >= 0.9 && t < 0.95) ring = 1;
      if (F === null && clicked && await f.evaluate(() => /Nearest place/.test(document.getElementById("summary").textContent))) { F = t; end = F + 3.2; }
      if (t > 30) throw new Error("the panel never showed a result");
      const cur = t < 0.9 ? [lerp(home[0], pin[0], (t - 0.1) / 0.8), lerp(home[1], pin[1], (t - 0.1) / 0.8)]
        : t < 2.4 ? [lerp(pin[0], go[0], (t - 1.8) / 0.6), lerp(pin[1], go[1], (t - 1.8) / 0.6)]
        : F === null || t < F + 0.2 ? go : t < F + 2.2 ? [lerp(go[0], res[0], (t - F - 0.2) / 0.8), lerp(go[1], res[1], (t - F - 0.2) / 0.8)]
        : [lerp(res[0], home[0], (t - F - 2.2) / 0.8), lerp(res[1], home[1], (t - F - 2.2) / 0.8)];
      await pg.evaluate(([c, r]) => CUR(c, r), [cur, ring]); ring = Math.max(0, ring - 2.4 / FPS);
      frames.push((await pg.screenshot({ type: "png" })).toString("base64"));
      await f.evaluate((ms) => __tick(ms), 1000 / FPS);
    }
    if (errs.length) throw new Error("page errors: " + errs.join(" | "));
    console.log(`gallery: result at ${F.toFixed(1)} s`);
    await ctx.close(); return frames;
  }

  /* pixels: the browser decodes and scales each frame */
  const px = await (await browser.newContext()).newPage(); await px.setContent("<canvas></canvas>");
  const pixels = (png, [w, h]) => px.evaluate(async ({ png, w, h }) => {
    const img = new Image(); img.src = "data:image/png;base64," + png; await img.decode();
    const c = document.querySelector("canvas"); c.width = w; c.height = h; const x = c.getContext("2d", { willReadFrequently: true });
    x.imageSmoothingQuality = "high"; x.drawImage(img, 0, 0, w, h);
    let s = ""; const d = x.getImageData(0, 0, w, h).data; for (let i = 0; i < d.length; i += 0x8000) s += String.fromCharCode(...d.subarray(i, i + 0x8000));
    return btoa(s);
  }, { png, w, h }).then((b) => new Uint8Array(Buffer.from(b, "base64")));

  async function encode(g, frames) {
    const [w, h] = g.page, n = frames.length, first = await pixels(frames[0], g.page);
    const rgba = async (i) => {
      const d = i === 0 ? first : await pixels(frames[i], g.page), k = g.loopFade ? (i - (n - XF) + 1) / (XF + 1) : 0;
      if (k > 0) for (let j = 0; j < d.length; j++) d[j] = d[j] + (first[j] - d[j]) * k;
      return d;
    };
    const sample = new Uint8Array(w * h * 4 * 8);
    for (let s = 0; s < 8; s++) sample.set(await rgba(Math.floor(s * (n - 1) / 7)), s * w * h * 4);
    const palette = quantize(sample, 255), TR = palette.length; palette.push([255, 0, 255]);
    const gif = GIFEncoder(); let prev = null;
    for (let i = 0; i < n; i++) {
      const idx = applyPalette(await rgba(i), palette);
      if (!prev) gif.writeFrame(idx, w, h, { palette, delay: 1000 / FPS, repeat: 0 });
      else { const o = idx.slice(); for (let j = 0; j < o.length; j++) if (o[j] === prev[j]) o[j] = TR; gif.writeFrame(o, w, h, { delay: 1000 / FPS, transparent: true, transparentIndex: TR, dispose: 1 }); }
      prev = idx;
    }
    gif.finish();
    const bytes = gif.bytes(), file = path.join(OUT, `${g.name}.gif`); fs.writeFileSync(file, bytes);
    console.log(`${path.relative(ROOT, file)}: ${w}x${h}, ${n} frames (${(n / FPS).toFixed(1)} s), ${(bytes.length / 1e6).toFixed(2)} MB${bytes.length > 3e6 ? " (over Product Hunt's 3 MB)" : ""}`);
  }

  const GIFS = [
    { name: "gallery-1270x760", panel: true, page: [1270, 760], loopFade: true },
    { name: "icon-240", page: [240, 240], dur: 4 },        // two ring periods: loops on its own
  ];
  try {
    for (const g of GIFS.filter((g) => !only || g.name.startsWith(only))) await encode(g, await film(g));
  } finally { await browser.close(); srv.stop(); }
})().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
