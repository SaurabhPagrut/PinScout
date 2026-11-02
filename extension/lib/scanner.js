/*
 * Scanner: walks the planner's tiers one pincode at a time and stops at the
 * first "available" result (unless keepGoing is set).
 *
 * Dependencies are injected so this file has no Chrome APIs in it:
 *   check(pincode)  -> { status: "available" | "unavailable" | "error", ... , fatal?: bool,
 *                        soldOutEverywhere?: bool, message?: string }
 *   sleep(ms)       -> Promise
 *   shouldStop()    -> boolean (user pressed Stop / tab changed)
 *   onEvent(evt)    -> progress callback for the UI
 *
 * Pacing: a random delay of minDelay..1.85×minDelay between checks, doubled after
 * each error in a row (up to 8×) and reset by the next good answer.
 * A check that takes longer than checkTimeout counts as an error. A pincode that
 * errors is retried once after a pause, so one blip doesn't skip it (which could
 * otherwise report a "nearest" hit while a closer pincode was never really checked).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Scanner = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const MAX_CONSECUTIVE_ERRORS = 3;
  const MAX_BACKOFF = 8;
  const STOP_POLL_MS = 250;
  const STOPPED = Symbol("stopped");

  function jitter(min = 700, max = 1300) {
    return Math.round(min + Math.random() * (max - min));
  }

  // Resolves with the check's result, a timeout error, or STOPPED, whichever is
  // first, so a hung request can never freeze the scan or block Stop.
  // inflight: the checks still running in the page. Stop and the timeout don't cancel a check that is
  // already in the store's page, so the scan's caller waits for these before undoing anything (see settled).
  function guardedCheck(check, pincode, timeoutMs, shouldStop, inflight) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (!done) { done = true; clearTimeout(timer); clearInterval(poll); resolve(v); } };
      const timer = setTimeout(() => finish({
        status: "error", pincode, timedOut: true,
        message: `No answer after ${Math.round(timeoutMs / 1000)}s.`,
      }), timeoutMs);
      const poll = setInterval(() => { if (shouldStop()) finish(STOPPED); }, STOP_POLL_MS);
      const running = Promise.resolve()
        .then(() => check(pincode))
        .then((r) => finish(r || { status: "error", pincode, message: "No result." }),
          (e) => finish({ status: "error", pincode, message: e?.message || String(e) }));
      if (inflight) { inflight.add(running); running.finally(() => inflight.delete(running)); }
    });
  }

  async function runScan({
    tiers, check, sleep, shouldStop, onEvent, keepGoing = false,
    minDelay = 700, checkTimeout = 20000, retryDelay = 4000, delay,
  }) {
    const found = [];
    const failed = [];
    const inflight = new Set();
    let checked = 0;
    let consecutiveErrors = 0;
    const total = tiers.reduce((n, t) => n + t.pins.length, 0);
    const nextDelay = () => {
      const base = delay ? delay() : jitter(minDelay, Math.round(minDelay * 1.85));
      return base * Math.min(2 ** consecutiveErrors, MAX_BACKOFF);
    };

    const finish = (outcome, message) => {
      // settled(): resolves once every check that was still running in the page has finished (or right away)
      const summary = { outcome, message, found, failed, errors: failed.length, checked, total,
        settled: () => Promise.allSettled([...inflight]).then(() => undefined), running: () => inflight.size };
      onEvent({ type: "done", ...summary });
      return summary;
    };

    let first = true;
    for (const tier of tiers) {
      onEvent({ type: "tier", tier: tier.id, label: tier.label, count: tier.pins.length });

      for (const entry of tier.pins) {
        if (!first) await sleep(nextDelay());
        first = false;
        if (shouldStop()) return finish("stopped", "Stopped.");

        let res = await guardedCheck(check, entry.p, checkTimeout, shouldStop, inflight);
        if (res === STOPPED) return finish("stopped", "Stopped.");
        if (res.status === "error" && !res.fatal) {
          onEvent({ type: "retry", tier: tier.id, entry, res });
          await sleep(retryDelay);
          if (shouldStop()) return finish("stopped", "Stopped.");
          res = await guardedCheck(check, entry.p, checkTimeout, shouldStop, inflight);
          if (res === STOPPED) return finish("stopped", "Stopped.");
        }
        checked++;
        onEvent({ type: "result", tier: tier.id, entry, res, checked, total });

        if (res.status === "error") {
          if (res.fatal) return finish("aborted", res.message || "The store is blocking requests. Stopped to protect your session.");
          failed.push({ tier: tier.id, entry, res });
          if (++consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
            return finish("aborted", `${MAX_CONSECUTIVE_ERRORS} pincodes in a row failed, stopping. Last: ${res.message || "unknown"}`);
          }
          continue;
        }
        consecutiveErrors = 0;

        if (res.status === "available") {
          found.push({ tier: tier.id, tierLabel: tier.label, entry, res });
          if (!keepGoing) return finish("found", `Available at ${entry.p}.`);
        } else if (res.soldOutEverywhere && !found.length) {
          // The store says the product itself is sold out, not just here:
          // every other pincode would get the same answer.
          return finish("soldout", "This product is sold out on this store, so no pincode can get it right now.");
        }
      }
    }

    return found.length
      ? finish("found", `Available at ${found.length} location(s).`)
      : finish("none", "Not available at any pincode checked.");
  }

  return { runScan, jitter, MAX_CONSECUTIVE_ERRORS };
});
