/*
 * Recorder helpers used by the side panel's "Help add a new store".
 *
 * The recording itself is done by lib/recorder-page.js, which runs inside the
 * store's page. This file holds the small pieces around it:
 *
 *   pageRecorderPrepare(marker)  runs in the page: writes a fresh, active recording
 *                                state (in sessionStorage) for recorder-page.js to pick up
 *   pageRecorderStop()           runs in the page: stops the recorder and returns what it
 *                                captured (falls back to the saved state if the hooks are
 *                                not active on the page the user ended on)
 *   summarize(data)              one-line description of a capture, for the UI
 *
 * pageRecorderPrepare / pageRecorderStop are serialized by Chrome, so each must be
 * fully self-contained.
 */
(function (root) {
  var FILE = "lib/recorder-page.js";
  var SCRIPT_ID = "pinscout-recorder";

  function pageRecorderPrepare(marker) {
    var KEY = "__pinscout_rec_v1";
    try { if (window.__pinscoutRecorder) window.__pinscoutRecorder.stop(); } catch (e) { /* ignore */ }
    sessionStorage.setItem(KEY, JSON.stringify({
      active: true, startedAt: Date.now(), markers: [marker],
      records: [], hints: [], activity: [], pages: [], resources: [],
    }));
    return { prepared: true };
  }

  function pageRecorderStop() {
    var KEY = "__pinscout_rec_v1";
    var r = window.__pinscoutRecorder;
    if (r) return r.stop();
    try {
      var raw = sessionStorage.getItem(KEY);
      if (raw) {
        var s = JSON.parse(raw);
        sessionStorage.removeItem(KEY);
        return {
          store: location.hostname, page: location.origin + location.pathname,
          marker: (s.markers || [])[0],
          learnedMarkers: (s.markers || []).slice(1).map(function (v) { return /^-?\d+\.\d+$/.test(v) ? Number(v).toFixed(2) : v; }),
          seconds: Math.round((Date.now() - s.startedAt) / 1000),
          count: (s.records || []).length, records: s.records || [], hints: s.hints || [],
          pageLoads: s.pages || [], resources: s.resources || [], activity: s.activity || [], steps: s.steps || [], stateHints: [],
          note: "The recorder was not running on the page you ended on; this is what was saved before that.",
        };
      }
    } catch (e) { /* fall through */ }
    return { error: "Nothing was being recorded in this tab. Did you switch tabs or go to a different site? Start again on the store's page." };
  }

  function summarize(data) {
    var plural = function (n, w) { return n + " " + w + (n === 1 ? "" : "s"); };
    var parts = [plural(data.count || 0, "matching request")];
    var other = (data.activity || []).length;
    if (other) parts.push(plural(other, "other request") + " seen");
    var loads = (data.pageLoads || []).length;
    if (loads > 1) parts.push(plural(loads, "page load"));
    if ((data.hints || []).length) parts.push(plural(data.hints.length, "storage/cookie hint"));
    if ((data.steps || []).length) parts.push(plural(data.steps.length, "UI step"));
    var m = data.masked;
    if (m) {
      var masked = [m.secretsOrFields && plural(m.secretsOrFields, "field"), m.emails && plural(m.emails, "e-mail"),
        m.phones && plural(m.phones, "phone number"), m.tokens && plural(m.tokens, "token")].filter(Boolean);
      if (masked.length) parts.push("masked: " + masked.join(", "));
    }
    return parts.join(" · ");
  }

  root.Recorder = { FILE: FILE, SCRIPT_ID: SCRIPT_ID, pageRecorderPrepare: pageRecorderPrepare, pageRecorderStop: pageRecorderStop, summarize: summarize };
  if (typeof module === "object" && module.exports) module.exports = root.Recorder;
})(typeof self !== "undefined" ? self : this);
