// The demo video for YouTube, to BracelTheCat's specification: dist/video/pinscout-demo.webm (2560×1440, 60 fps, VP9,
// no sound; 1440p gets YouTube's better codecs at every quality, so the panel's small text stays sharp) and
// dist/video/thumbnail.jpg (1280×720).
// Title cards, then the real side panel on the page the store screenshots use (scripts/screenshots.js: a headline on
// the left, a pretend browser with sidepanel.html on a stand-in chrome.* on the right), then the privacy and end cards.
// The panel runs its own scan at its own pace (about a second between checks); the store answers "not deliverable"
// until 560003. Filmed frame by frame on the panel's own virtual clock (the stand-in's __tick), with a seeded
// Math.random, so every frame is exact and a run is the same every time. The pointer, its click ring and the fades are drawn here, over the page.
// Run: node scripts/video.js [--still] [--only title|panel|privacy|end]   (--still: one picture per scene, into
// dist/video/still-*.jpg, for a quick look). Encodes with Playwright's own ffmpeg (or FFMPEG=/path/to/ffmpeg).
const fs = require("fs"), path = require("path"), os = require("os"), { spawn } = require("child_process");
const { playwright, chrome, serve } = require("./browse.js");
const { stub, page, PRODUCT, HOME, FOUND, ETA, STORE_URL } = require("./screenshots.js");

const ROOT = path.join(__dirname, ".."), OUT = path.join(ROOT, "dist/video"), argv = process.argv.slice(2);
const FPS = 60, W = 1280, H = 720, DPR = 2, FADE = 0.45;
const still = argv.includes("--still"), only = argv.includes("--only") ? argv[argv.indexOf("--only") + 1] : null;

function ffmpegPath() {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  for (const d of [path.join(os.homedir(), "Library/Caches/ms-playwright"), path.join(os.homedir(), ".cache/ms-playwright")]) if (fs.existsSync(d))
    for (const f of fs.readdirSync(d).filter((f) => f.startsWith("ffmpeg-"))) for (const b of ["ffmpeg-mac", "ffmpeg-linux"])
      if (fs.existsSync(path.join(d, f, b))) return path.join(d, f, b);
  return "ffmpeg";
}

/* ---------- the cards: the listing's purple-to-teal background, the mark, a title and a line ---------- */
const card = (base, title, sub, small = "", foot = "") => `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&display=block" rel="stylesheet">
<style>*{box-sizing:border-box;margin:0}html,body{height:100%}
body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:26px;color:#fff;font-family:"Plus Jakarta Sans",system-ui,sans-serif;position:relative;overflow:hidden;
 background:radial-gradient(1000px 640px at -10% -20%,#7c3aed 0%,rgba(124,58,237,0) 55%),radial-gradient(700px 500px at 110% 110%,#0d9488 0%,rgba(13,148,136,0) 60%),linear-gradient(135deg,#3b1d8f,#24145e 45%,#1e1a52)}
body:before{content:"";position:absolute;inset:0;background-image:radial-gradient(rgba(255,255,255,.10) 1px,transparent 1.2px);background-size:24px 24px}
.ring{position:absolute;left:50%;top:50%;border:1.5px solid rgba(255,255,255,.10);border-radius:50%;transform:translate(-50%,-50%)}
img{width:112px;height:112px;border-radius:26px;box-shadow:0 18px 40px rgba(0,0,0,.35);position:relative}
h1{font-size:84px;font-weight:800;letter-spacing:-.02em;position:relative}
p{font-size:32px;font-weight:600;color:rgba(226,232,240,.92);position:relative;text-align:center;max-width:980px}
small{display:block;font-size:22px;font-weight:500;color:#5eead4;position:relative;text-align:center;max-width:900px;line-height:1.45}
.foot{position:absolute;bottom:24px;left:0;right:0;text-align:center;font-size:15px;color:rgba(226,232,240,.6)}
</style></head><body><div class="ring" style="width:520px;height:520px"></div><div class="ring" style="width:820px;height:820px"></div>
<img src="${base}/extension/icons/icon128.png" alt=""><h1>${title}</h1><p>${sub}</p>${small ? `<small>${small}</small>` : ""}${foot ? `<div class="foot">${foot}</div>` : ""}</body></html>`;

/* ---------- the overlay: fade, pointer and click ring, in a zero-size host over everything ---------- */
const OVERLAY = () => {
  const host = document.createElement("video-fx");
  Object.assign(host.style, { position: "fixed", left: 0, top: 0, width: 0, height: 0, zIndex: 2147483647, pointerEvents: "none" });
  const r = host.attachShadow({ mode: "open" }); document.documentElement.append(host);
  r.innerHTML = `<style>*{pointer-events:none}#fade{position:fixed;inset:0;background:#000}
    #cur{position:fixed;left:0;top:0;width:26px;height:26px;filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))}
    #ring{position:fixed;left:0;top:0;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;border:3px solid #5eead4}</style>
    <svg id="cur" viewBox="0 0 26 26"><path d="M3 2 L3 21 L8 16.5 L11.5 24 L15 22.5 L11.5 15 L18 15 Z" fill="#fff" stroke="#0f172a" stroke-width="1.6" stroke-linejoin="round"/></svg>
    <div id="ring"></div><div id="fade"></div>`;
  const $ = (id) => r.getElementById(id);
  window.FX = (s) => {
    $("fade").style.opacity = s.fade;
    $("cur").style.display = s.cur ? "block" : "none";
    if (s.cur) $("cur").style.transform = `translate(${s.cur[0] - 3}px,${s.cur[1] - 2}px)`;
    $("ring").style.display = s.ring > 0 ? "block" : "none";
    if (s.ring > 0 && s.cur) Object.assign($("ring").style, { transform: `translate(${s.cur[0]}px,${s.cur[1]}px) scale(${1.6 - s.ring * 0.8})`, opacity: s.ring });
  };
};

/* the left column's copy for each part of the panel scene (same rules as the listing: true to the code, no store names) */
const COPY = {
  ask: { eyebrow: "Out of stock at your pincode?", title: "The store says *not deliverable.*",
    body: "Finding where it can go means typing pincode after pincode into the store’s delivery box. PinScout does that for you." },
  scan: { eyebrow: "On the store’s own check", title: "It checks *pincode after pincode.*",
    body: "Your pincode, then nearby pincodes, your state and the rest of India, about a second apart, live in the side panel." },
  found: { eyebrow: "Found it", title: "Stops at the *nearest place* it can go.",
    body: "The nearest pincode the store says it can deliver to, with the delivery date the store gave." },
  range: { eyebrow: "You choose the range", title: "Search as far as *you need.*",
    body: "Untick an area to skip it: just nearby, your state, or all of India, from India Post’s list of about 19,500 pincodes." },
  store: { eyebrow: "Your store missing?", title: "Teach PinScout *a new store.*",
    body: "Record how a store checks delivery in about a minute. Personal details are masked, and nothing is sent unless you email it." },
};

const ease = (t) => (t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t));
const lerp = (a, b, t) => a + (b - a) * ease(t);

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { chromium } = playwright(), srv = await serve(), browser = await chromium.launch({ executablePath: chrome() });
  const outFile = path.join(OUT, "pinscout-demo.webm");
  let enc = null, ending = false, frames = 0;
  if (!still) {
    enc = spawn(ffmpegPath(), ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "pipe:0",
      "-c:v", "libvpx-vp9", "-b:v", "16M", "-crf", "18", "-g", String(FPS * 2), "-deadline", "good", "-cpu-used", "3", "-row-mt", "1",
      "-tile-columns", "2", "-pix_fmt", "yuv420p", outFile], { stdio: ["pipe", "inherit", "inherit"] });
    enc.on("exit", (c) => { if (c && !ending) { console.error(`ffmpeg exited ${c}`); process.exit(1); } });
    enc.stdin.on("error", (e) => { console.error(e.message); process.exit(1); });
  }
  const write = (buf) => new Promise((res) => (enc.stdin.write(buf) ? res() : enc.stdin.once("drain", res)));

  async function newPage(panel) {
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR, colorScheme: "light", reducedMotion: "no-preference" });
    if (panel) await ctx.addInitScript(stub, { url: STORE_URL, found: FOUND, eta: ETA, product: PRODUCT, virtual: true, pace: 1, answerMs: 300, seed: 20261102 });
    const pg = await ctx.newPage(), errs = [];
    pg.on("pageerror", (e) => errs.push(e.message));
    return { ctx, pg, errs };
  }
  async function shoot(pg, name, sceneT, dur) {
    if (still) {
      if (Math.abs(sceneT - dur * 0.55) < 0.5 / FPS) fs.writeFileSync(path.join(OUT, `still-${name}.jpg`), await pg.screenshot({ type: "jpeg", quality: 90, scale: "css" }));
      return;
    }
    await write(await pg.screenshot({ type: "jpeg", quality: 92 })); frames++;
  }

  /* a card: still, faded in and out */
  async function cardScene(name, dur, html) {
    const { ctx, pg } = await newPage(false);
    await pg.setContent(html, { waitUntil: "networkidle" }); await pg.evaluate(() => document.fonts.ready);
    await pg.evaluate(OVERLAY);
    for (let i = 0, n = Math.round(dur * FPS); i < n; i++) {
      const t = i / FPS;
      await pg.evaluate((s) => FX(s), { fade: Math.max(0, 1 - t / FADE, 1 - (dur - t) / FADE), cur: null, ring: 0 });
      await shoot(pg, name, t, dur);
    }
    await ctx.close(); console.log(`${name}: ${dur}s`);
  }

  /* the panel scene: type the pincode, scan, the result, the range, the recorder */
  async function panelScene() {
    const { ctx, pg, errs } = await newPage(true);
    const html = page({ w: W, h: H, ...COPY.ask, url: "product page on a supported store", base: srv.base, win: { x: 548, y: 56, w: 692 } });
    await pg.setContent(html, { waitUntil: "load" });
    const f = pg.frames().find((fr) => /sidepanel\.html/.test(fr.url()));
    for (let i = 0; i < 400; i++) {   // the dataset loads over the (real) network; the panel's timers wait for __tick
      if (await f.evaluate(() => /pincodes loaded/.test(document.getElementById("dataInfo")?.textContent || ""))) break;
      await f.evaluate(() => __tick(50)); await new Promise((r) => setTimeout(r, 15));
    }
    await f.evaluate(() => { const s = document.getElementById("nearbyCap"); s.value = "10"; s.dispatchEvent(new Event("change", { bubbles: true })); });
    await pg.evaluate(() => document.fonts.ready);
    await pg.evaluate(OVERLAY);
    /* where an element of the panel is, on screen: the frame's place on the page, and its 0.8 scale */
    /* (fx, fy: where in the element, 0.5 is its middle) */
    const at = async (sel, fx = 0.5, fy = 0.5) => {
      const [ix, iy] = await pg.evaluate(() => { const r = document.querySelector(".panel iframe").getBoundingClientRect(); return [r.x, r.y]; });
      const [x, y] = await f.evaluate(([s, fx, fy]) => { const r = document.querySelector(s).getBoundingClientRect(); return [r.x + r.width * fx, r.y + r.height * fy]; }, [sel, fx, fy]);
      return [ix + x * 0.8, iy + y * 0.8];
    };
    const setCopy = (c) => pg.evaluate(({ eyebrow, title, body }) => {
      const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
      document.querySelector(".eye").textContent = eyebrow;
      document.querySelector("h1").innerHTML = esc(title).replace(/\*([^*]+)\*/g, '<span class="g">$1</span>');
      document.querySelector(".body").textContent = body;
    }, c);
    const leftAlpha = (a) => pg.evaluate((a) => { document.querySelector(".left").style.opacity = a; }, a);

    /* the plan, in seconds; F is when the panel shows the result, known only once it happens */
    const HOMEXY = [W - 140, H - 120];
    let cur = HOMEXY, ring = 0, F = null, end = Infinity, shown = "ask", typed = 0, thumb = false;
    const moves = [], clicks = [];        // {from, to, t0, t1}; {t, sel, done}
    const glide = async (sel, t0, t1) => { const to = await at(sel); moves.push({ from: null, to, t0, t1 }); return to; };
    const copyAt = [[0, "ask"], [7.6, "scan"]];
    await glide("#pin", 2.6, 3.8); clicks.push({ t: 4.0, sel: "#pin" });
    moves.push({ from: null, to: null, t0: 5.2, t1: 6.4, sel: "#start" }); clicks.push({ t: 6.7, sel: "#start" });

    for (let i = 0; ; i++) {
      const t = i / FPS;
      if (t >= end) break;
      // the copy: the left column fades out for 0.25 s, changes, and fades back in for 0.25 s
      const [ct, key] = copyAt.filter(([c]) => c <= t).pop();
      let a = 1;
      if (key !== shown) {
        a = 1 - ease((t - ct) / 0.25);
        if (t - ct >= 0.25) { await setCopy(COPY[key]); shown = key; a = 0; }
      } else if (ct > 0 && t - ct < 0.5) a = ease((t - ct - 0.25) / 0.25);
      await leftAlpha(a);
      // typing the pincode, one digit at a time
      if (t >= 4.2 && typed < 6) {
        const k = Math.min(6, Math.floor((t - 4.2) / 0.15) + 1);
        if (k > typed) { typed = k; await f.evaluate((v) => { const e = document.getElementById("pin"); e.focus(); e.value = v; e.dispatchEvent(new Event("input", { bubbles: true })); }, HOME.slice(0, k)); }
      }
      // the pointer: the current glide, or where the last one ended
      for (const m of moves) {
        if (t < m.t0) continue;
        if (!m.to) m.to = await at(m.sel, m.fx, m.fy);
        if (!m.from) m.from = cur;
        cur = t >= m.t1 ? m.to : [lerp(m.from[0], m.to[0], (t - m.t0) / (m.t1 - m.t0)), lerp(m.from[1], m.to[1], (t - m.t0) / (m.t1 - m.t0))];
      }
      for (const c of clicks) if (!c.done && t >= c.t) {
        c.done = true; ring = 1;
        if (c.sel !== "#pin") await f.evaluate((s) => { const e = document.querySelector(s); if (e.tagName === "INPUT" && e.type === "checkbox") { e.click(); } else if (e.tagName === "SUMMARY") e.parentElement.open = !e.parentElement.open; else e.click(); }, c.sel);
      }
      // the result: once the panel shows it, plan the rest from there
      if (F === null && t > 7 && await f.evaluate(() => /Nearest place/.test(document.getElementById("summary").textContent))) {
        F = t; end = F + 15;
        copyAt.push([F + 0.3, "found"], [F + 4.6, "range"], [F + 9.6, "store"]);
        moves.push({ t0: F + 0.6, t1: F + 1.6, sel: "#summary", fx: 0.92, fy: 0.12 });   // beside the result, not over it
        moves.push({ t0: F + 4.9, t1: F + 5.9, sel: "label[for=tier-india]" }); clicks.push({ t: F + 6.2, sel: "#tier-india" }, { t: F + 7.7, sel: "#tier-india" });
        moves.push({ t0: F + 9.9, t1: F + 10.9, sel: "#recorder > summary" }); clicks.push({ t: F + 11.2, sel: "#recorder > summary" });
        moves.push({ t0: F + 12.2, t1: F + 13.4, to: HOMEXY });
      }
      if (t > 40 && F === null) throw new Error("the panel never showed a result");
      const fade = Math.max(0, 1 - t / FADE, end === Infinity ? 0 : 1 - (end - t) / FADE);
      await pg.evaluate((s) => FX(s), { fade, cur, ring });
      ring = Math.max(0, ring - 2.4 / FPS);
      if (!thumb && F !== null && t >= F + 2.4) {
        thumb = true; await pg.evaluate(() => FX({ fade: 0, cur: null, ring: 0 }));   // no pointer on the thumbnail
        fs.writeFileSync(path.join(OUT, "thumbnail.jpg"), await pg.screenshot({ type: "jpeg", quality: 92, scale: "css" }));
      }
      await shoot(pg, "panel", t, end === Infinity ? 30 : end);
      await f.evaluate((ms) => __tick(ms), 1000 / FPS);
    }
    if (errs.length) throw new Error("page errors: " + errs.join(" | "));
    await ctx.close(); console.log(`panel: ${end.toFixed(1)}s (result at ${F.toFixed(1)}s)`);
  }

  const B = srv.base, SCENES = {
    title: () => cardScene("title", 4.5, card(B, "PinScout", "Find where a product can be delivered in India", "Free browser extension · no account · no ads")),
    panel: panelScene,
    privacy: () => cardScene("privacy", 5, card(B, "Private by design", "No account. No server. No tracking.",
      "Checks go straight from your browser to the store you’re on.<br>Only your home pincode is saved, on your device.")),
    end: () => cardScene("end", 5.5, card(B, "PinScout", "Free on the Chrome Web Store", "pinscout.saurabhpagrut.in",
      "Pincode data: Department of Posts, Government of India, via data.gov.in · Not affiliated with any store")),
  };
  try {
    for (const [name, run] of Object.entries(SCENES)) if (!only || only === name) await run();
  } finally { await browser.close(); srv.stop(); }
  if (enc) { ending = true; enc.stdin.end(); await new Promise((res, rej) => enc.on("close", (c) => (c ? rej(new Error(`ffmpeg exited ${c}`)) : res()))); }
  console.log(still ? `${path.relative(ROOT, OUT)}/still-*.jpg` : `${path.relative(ROOT, outFile)} (${(frames / FPS).toFixed(1)} s, ${(fs.statSync(outFile).size / 1e6).toFixed(1)} MB), ${path.relative(ROOT, OUT)}/thumbnail.jpg`);
})().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
