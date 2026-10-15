/*
 * Particles: a small, calm particle field for the panel background.
 * Tiny drifting dots, faint links between close neighbours, and a soft
 * reaction to the cursor (dots are nudged away and linked to it).
 *
 * The physics lives in stepParticles(), a pure function, so it can be tested
 * without a canvas. start() wires it to a <canvas>.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Particles = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const CURSOR_RADIUS = 120;
  const LINK_DIST = 88;
  const MAX_FPS = 40;
  const MAX_SPEED = 2;   // px per frame: keeps cursor pushes calm, never a fling

  function makeParticles(n, w, h, rand = Math.random) {
    return Array.from({ length: n }, () => {
      const a = rand() * Math.PI * 2, s = 0.08 + rand() * 0.18;
      return {
        x: rand() * w, y: rand() * h,
        bx: Math.cos(a) * s, by: Math.sin(a) * s,   // gentle base drift
        vx: 0, vy: 0,
        r: 0.9 + rand() * 1.4,
        t: rand(),                                  // 0..1 colour mix
      };
    });
  }

  // Advance one frame. k = elapsed time in 60fps-frames (clamped by the caller).
  function stepParticles(ps, w, h, mouse, k = 1) {
    for (const p of ps) {
      // ease back toward the base drift
      p.vx += (p.bx - p.vx) * 0.04 * k;
      p.vy += (p.by - p.vy) * 0.04 * k;

      if (mouse && mouse.active) {
        const dx = p.x - mouse.x, dy = p.y - mouse.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < CURSOR_RADIUS * CURSOR_RADIUS && d2 > 0.01) {
          const d = Math.sqrt(d2);
          const f = (1 - d / CURSOR_RADIUS) ** 2 * 0.9 * k;   // stronger when closer
          p.vx += (dx / d) * f;
          p.vy += (dy / d) * f;
        }
      }

      const sp = Math.hypot(p.vx, p.vy);
      if (sp > MAX_SPEED) { p.vx = (p.vx / sp) * MAX_SPEED; p.vy = (p.vy / sp) * MAX_SPEED; }

      p.x += p.vx * k;
      p.y += p.vy * k;

      // wrap around the edges
      if (p.x < -4) p.x = w + 4; else if (p.x > w + 4) p.x = -4;
      if (p.y < -4) p.y = h + 4; else if (p.y > h + 4) p.y = -4;
    }
  }

  function targetCount(w, h) {
    return Math.max(22, Math.min(70, Math.round((w * h) / 11000)));
  }

  const mix = (a, b, t) => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t));

  function start(canvas, opts = {}) {
    const ctx = canvas.getContext("2d");
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dark = matchMedia("(prefers-color-scheme: dark)");
    let w = 0, h = 0, dpr = 1, ps = [], raf = 0, last = 0, enabled = opts.enabled !== false;
    const mouse = { x: 0, y: 0, active: false };

    // violet -> teal, tuned per theme so dots stay subtle but visible
    const palette = () => dark.matches
      ? { a: [167, 139, 250], b: [45, 212, 191], dot: 0.7, link: 0.22 }
      : { a: [109, 40, 217], b: [13, 148, 136], dot: 0.5, link: 0.16 };

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth; h = window.innerHeight;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      canvas.style.width = w + "px"; canvas.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = targetCount(w, h);
      if (ps.length > n) ps.length = n;
      else if (ps.length < n) ps.push(...makeParticles(n - ps.length, w, h));
      draw();
    }

    function draw() {
      const pal = palette();
      ctx.clearRect(0, 0, w, h);
      for (let i = 0; i < ps.length; i++) {
        const p = ps[i];
        for (let j = i + 1; j < ps.length; j++) {
          const q = ps[j], dx = p.x - q.x, dy = p.y - q.y, d2 = dx * dx + dy * dy;
          if (d2 < LINK_DIST * LINK_DIST) {
            const a = (1 - Math.sqrt(d2) / LINK_DIST) * pal.link;
            const c = mix(pal.a, pal.b, (p.t + q.t) / 2);
            ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${a})`;
            ctx.lineWidth = 0.8;
            ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
          }
        }
        if (mouse.active) {
          const dx = p.x - mouse.x, dy = p.y - mouse.y, d = Math.sqrt(dx * dx + dy * dy);
          if (d < CURSOR_RADIUS * 1.25) {
            const a = (1 - d / (CURSOR_RADIUS * 1.25)) * 0.5;
            const c = mix(pal.a, pal.b, p.t);
            ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${a})`;
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(mouse.x, mouse.y); ctx.stroke();
          }
        }
        const c = mix(pal.a, pal.b, p.t);
        ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${pal.dot})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      }
    }

    function frame(now) {
      raf = requestAnimationFrame(frame);
      const dt = now - last;
      if (dt < 1000 / MAX_FPS) return;          // cap the frame rate to stay light
      last = now;
      stepParticles(ps, w, h, mouse, Math.min(dt / 16.67, 2));
      draw();
    }

    function run() {
      cancelAnimationFrame(raf);
      if (!enabled) { ctx.clearRect(0, 0, w, h); return; }
      if (reduced || document.hidden) { draw(); return; }   // static when asked to, or when hidden
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }

    window.addEventListener("mousemove", (e) => { mouse.x = e.clientX; mouse.y = e.clientY; mouse.active = true; });
    document.addEventListener("mouseleave", () => { mouse.active = false; });
    window.addEventListener("blur", () => { mouse.active = false; });
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", run);
    dark.addEventListener?.("change", draw);

    resize();
    run();
    return { setEnabled(v) { enabled = !!v; canvas.style.display = enabled ? "" : "none"; run(); } };
  }

  return { start, stepParticles, makeParticles, targetCount, CURSOR_RADIUS };
});
