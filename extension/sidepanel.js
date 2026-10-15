const $ = (id) => document.getElementById(id);
const pinInput = $("pin"), keepGoing = $("keepGoing");
const startBtn = $("start"), stopBtn = $("stop");
const summary = $("summary"), log = $("log"), bar = $("bar"), retailerLabel = $("retailer");

const TIER_IDS = ["home", "nearby", "state", "india"];
const DEFAULT_LABELS = {
  home: "Your pincode",
  nearby: "Nearby pincodes",
  state: "Rest of your state",
  india: "Rest of India",
};

let stopRequested = false;
let running = false;
let dataset = null;
let previewToken = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const setScanning = (on) => document.body?.classList?.toggle("scanning", on);

function setSummary(text, cls = "") {
  summary.className = cls || "muted";
  summary.textContent = text;
}

// Only follow new results if the user is already at the bottom. If they
// scroll up to read or reach the Stop button, leave the scroll position alone.
function addLog(text, cls = "") {
  const doc = document.documentElement;
  const nearBottom = window.innerHeight + window.scrollY >= doc.scrollHeight - 60;
  const li = document.createElement("li");
  if (cls) li.className = cls;
  li.textContent = text;
  log.appendChild(li);
  if (nearBottom) window.scrollTo({ top: doc.scrollHeight });
}

// Prefer the full dataset built by tools/build_pincodes.py; fall back to the
// small starter list that ships with the extension.
async function loadDataset() {
  if (dataset) return dataset;
  for (const file of ["data/pincodes.json", "data/pincodes.seed.json"]) {
    try {
      const res = await fetch(chrome.runtime.getURL(file));
      if (!res.ok) continue;
      dataset = await res.json();
      break;
    } catch { /* try the next file */ }
  }
  if (!dataset) throw new Error("No pincode dataset found in extension/data/");
  const info = $("dataInfo");
  const n = dataset.length;
  if (n < 2000) {
    info.className = "warn";
    info.textContent = `⚠ Starter list only (${n} pincodes). Nearby/state coverage will be tiny. Run tools/build_pincodes.py to load the full India Post data.`;
  } else {
    info.className = "muted";
    info.textContent = `Pincode data: ${n.toLocaleString("en-IN")} pincodes loaded.`;
  }
  return dataset;
}

// ---- Stores -------------------------------------------------------------------

async function loadStores() {
  const res = await fetch(chrome.runtime.getURL("data/stores.json"));
  Stores.load(await res.json());
  renderStoreList();
}
const storesReady = loadStores().catch((e) => {
  retailerLabel.textContent = "Couldn't load the store list: " + e.message;
});

function renderStoreList() {
  const el = $("storeList");
  if (!el) return;
  const names = (list) => list.map((s) => s.name).join(", ") || "none yet";
  el.textContent = `Works on: ${names(Adapters.implemented())}.`;
}

// In Chrome this page is the side panel, so the product is the active tab of its own window.
// Where there is no side panel (Safari), background.js opens it in a window or tab of its own
// and passes ?win=<browser window>&tab=<tab the icon was clicked on>.
const host = (() => {
  const q = new URLSearchParams(location.search);
  const num = (k) => (/^\d+$/.test(q.get(k) || "") ? Number(q.get(k)) : null);
  return { win: num("win"), tab: num("tab") };
})();

async function activeProductTab() {
  if (host.win === null) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }
  let tab;
  try { [tab] = await chrome.tabs.query({ active: true, windowId: host.win }); } catch { /* window gone */ }
  // Opened as a tab next to the product: the active tab is this page, so use the one it was opened from.
  let self = null;
  try { self = await chrome.tabs.getCurrent(); } catch { /* not in a tab */ }
  if ((!tab || (self && tab.id === self.id)) && host.tab !== null) {
    try { tab = await chrome.tabs.get(host.tab); } catch { /* closed */ }
  }
  return tab;
}

async function getProductTab() {
  await storesReady;
  const tab = await activeProductTab();
  const url = tab?.url;   // only readable on sites PinScout has access to
  return { tab, store: Stores.forUrl(url), adapter: Adapters.forUrl(url) };
}

// The one place that decides what to tell the user about the current tab.
function tabProblem({ tab, store, adapter }) {
  if (adapter) return null;
  if (store) return `${store.name} isn't supported yet. Use “Help add a new store” below to teach PinScout this store.`;
  if (tab?.url && /^https?:/i.test(tab.url)) return `${Stores.hostOf(tab.url)} isn't supported yet. Use “Help add a new store” below.`;
  return "Open a product page on a supported store, then enter your pincode.";
}

function place(entry) {
  return [entry.d, entry.s].filter(Boolean).join(", ");
}

async function refreshRetailerLabel() {
  const info = await getProductTab();
  retailerLabel.textContent = info.adapter
    ? `Ready to check on ${info.adapter.name}${info.adapter.experimental ? " (experimental)" : ""}.`
    : tabProblem(info);
}

function plannerOptions() {
  const cap = $("nearbyCap").value;
  const [by, per] = $("indiaMode").value.split(":");
  return {
    nearbyCap: cap === "all" ? Infinity : Number(cap),
    indiaBy: by,
    indiaPerGroup: Number(per),
    // Unticked areas: an unticked "Nearby" no longer hides your own district from
    // the state tier.
    skip: TIER_IDS.filter((id) => !$(`tier-${id}`).checked),
  };
}

// ---- "Where to search" filters -------------------------------------------

function setTierLabel(id, label, count, total) {
  const span = $(`lbl-${id}`);
  span.textContent = label;
  if (count != null) {
    const c = document.createElement("span");
    c.className = "count";
    c.textContent = total > count ? ` (${count} of ${total})` : ` (${count})`;
    span.appendChild(c);
  }
  const row = $(`tier-${id}`).parentElement;
  const empty = count === 0 && id !== "home";
  row.classList.toggle("empty", empty);
  $(`tier-${id}`).disabled = empty || running;
}

// Once a valid pincode is typed, show real labels ("Rest of Maharashtra") and
// how many pincodes each area would check.
async function refreshTierPreview() {
  const token = ++previewToken;
  const pin = pinInput.value.trim();

  if (!/^\d{6}$/.test(pin)) {
    for (const id of TIER_IDS) setTierLabel(id, DEFAULT_LABELS[id], null, null);
    return;
  }
  let data;
  try { data = await loadDataset(); } catch { return; }
  if (token !== previewToken) return; // a newer keystroke superseded this one

  const tiers = Planner.buildTiers(pin, data, plannerOptions());
  for (const id of TIER_IDS) {
    const t = tiers.find((x) => x.id === id);
    setTierLabel(id, t ? t.label : DEFAULT_LABELS[id], t ? t.pins.length : 0, t ? t.total : 0);
  }
}

function setControlsLocked(locked) {
  pinInput.disabled = locked;
  keepGoing.disabled = locked;
  $("nearbyCap").disabled = locked;
  $("indiaMode").disabled = locked;
  for (const id of TIER_IDS) {
    const box = $(`tier-${id}`);
    box.disabled = locked || box.parentElement.classList.contains("empty");
  }
}

// ---- Scan -----------------------------------------------------------------

async function start() {
  const home = pinInput.value.trim();
  if (!/^\d{6}$/.test(home)) return setSummary("Enter a valid 6-digit pincode.", "bad");

  const info = await getProductTab();
  const { tab, adapter } = info;
  if (!tab?.id || !adapter) return setSummary(tabProblem(info), "bad");

  chrome.storage.local.set({ homePin: home }).catch(() => {});

  let data;
  try { data = await loadDataset(); }
  catch (e) { return setSummary("Could not load data/pincodes.json: " + e.message, "bad"); }

  const allTiers = Planner.buildTiers(home, data, plannerOptions());
  const tiers = allTiers.filter((t) => $(`tier-${t.id}`).checked);
  if (tiers.length === 0) {
    return setSummary("Nothing to search. Tick at least one area under “Where to search”.", "bad");
  }
  const nearbyWanted = $("tier-nearby").checked;
  const nearbyTier = allTiers.find((t) => t.id === "nearby");

  running = true; stopRequested = false;
  startBtn.disabled = true; stopBtn.disabled = false;
  setControlsLocked(true);
  log.textContent = ""; bar.style.width = "0%";
  setSummary(`Checking ${adapter.name}…`);

  const tabId = tab.id;
  // Store pages are often single-page apps that append query params after load, so
  // compare only the product path, not the full URL.
  const pathOf = (u) => { try { return new URL(u).pathname; } catch { return u; } };
  const startPath = pathOf(tab.url);
  let productTitle = "";

  const shouldStop = () => stopRequested;

  const check = async (pincode) => {
    // Abort if the user navigated the product tab elsewhere mid-scan.
    try {
      const t = await chrome.tabs.get(tabId);
      if (pathOf(t.url) !== startPath) {
        stopRequested = true;
        return { status: "error", pincode, fatal: true, message: "The product tab changed. Scan stopped." };
      }
    } catch {
      return { status: "error", pincode, fatal: true, message: "The product tab was closed." };
    }
    const r = await adapter.check(tabId, pincode);
    if (r.title && !productTitle) productTitle = r.title;
    return r;
  };

  const onEvent = (evt) => {
    if (evt.type === "retry") {
      addLog(`⚠️ ${evt.entry.p} – ${evt.res.message || "error"}, retrying once…`);
    } else if (evt.type === "tier") {
      addLog(`${evt.label} (${evt.count})`, "tier");
    } else if (evt.type === "result") {
      const { entry, res } = evt;
      const icon = res.status === "available" ? "✅" : res.status === "unavailable" ? "❌" : "⚠️";
      const extra = res.status === "error" ? ` – ${res.message}` :
        res.status === "available" && res.sla ? ` – ${res.sla}` : "";
      addLog(`${icon} ${entry.p} ${place(entry)}${extra}`);
      bar.style.width = `${Math.round((evt.checked / evt.total) * 100)}%`;
    }
  };

  // Adapters may save and restore store-side state around a scan (for example a
  // store that changes the visitor's delivery location on every check).
  setScanning(true);
  let result, session;
  try {
    session = await adapter.begin?.(tabId);
    result = await Scanner.runScan({
      tiers, check, sleep, shouldStop, onEvent, keepGoing: keepGoing.checked,
      minDelay: adapter.minDelayMs || 700,   // optional per-store pacing (stores.json)
    });
  } catch (e) {
    result = { outcome: "aborted", message: `Scan failed: ${e?.message || e}`, found: [], errors: 0, checked: 0, total: 0 };
  } finally {
    try { await adapter.end?.(tabId, session); } catch { /* best effort */ }
    setScanning(false);
    running = false;
    startBtn.disabled = false; stopBtn.disabled = true;
    setControlsLocked(false);
  }

  const head = productTitle ? `${productTitle}\n\n` : "";
  const errors = result.errors || 0;
  const answered = result.checked - errors;
  const errNote = errors ? `\n\n${errors} pincode(s) couldn't be checked (errors), so they may still be deliverable.` : "";
  const foundLines = (result.found || []).map((f) =>
    `• ${f.entry.p} ${place(f.entry)} [${f.tierLabel}]${f.res.sla ? " – " + f.res.sla : ""}`);
  const skipped = nearbyWanted && (!nearbyTier || nearbyTier.pins.length === 0)
    ? "\n\nNote: no nearby pincodes were checked because the pincode dataset has none close to yours (see README to load the full dataset)."
    : "";
  const searched = `Searched: ${tiers.map((t) => t.label).join(" → ")}.` +
    (adapter.experimental ? `\n\nNote: ${adapter.name} support is experimental. If a result looks wrong, tell the developer.` : "");

  if (result.outcome === "found") {
    const lines = foundLines;
    const first = result.found[0];
    const title = keepGoing.checked
      ? `✅ Available at ${result.found.length} of ${result.checked} pincodes checked:`
      : first.tier === "home" ? "✅ Available at your pincode:" : "✅ Nearest place it's available:";
    setSummary(`${head}${title}\n${lines.join("\n")}\n\nChecked ${result.checked} pincode(s). ${searched}${skipped}${errNote}`, "ok");
  } else if (result.outcome === "none") {
    setSummary(`${head}❌ Not deliverable at any of the ${answered} pincodes that answered.\n${searched}${skipped}${errNote}`, "bad");
  } else if (result.outcome === "soldout") {
    setSummary(`${head}❌ ${result.message}\n\nChecked ${result.checked} pincode(s) before the store said so.`, "bad");
  } else {
    // Stopped or aborted: keep any hits found so far ("don't stop at first hit").
    const hits = foundLines.length ? `\n\n✅ Found before stopping:\n${foundLines.join("\n")}` : "";
    setSummary(`${head}${result.message}${hits}\n\nChecked ${result.checked} of ${result.total}.${errNote}`, foundLines.length ? "ok" : "warn");
  }
}

// ---- Background particles (always on) ---------------------------------------
try { if (typeof Particles !== "undefined" && $("fx")) Particles.start($("fx")); } catch { /* purely cosmetic */ }

// ---- Recorder: "Help add a new store" ---------------------------------------
let recTabId = null;
const recMsg = (text, bad = false) => { const el = $("recStatus"); el.textContent = text; el.style.color = bad ? "#b45309" : ""; };

const showAccessBox = (show) => { const el = $("recAccess"); if (el) el.hidden = !show; };

function normalizeDomain(v) {
  const h = (v || "").trim().toLowerCase().replace(/^https?:\/\//, "").split(/[/?#]/)[0].replace(/^www\./, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(h) ? h : "";
}

async function recStart() {
  const marker = $("recPin").value.replace(/\D/g, "").slice(0, 6);
  if (!/^\d{6}$/.test(marker)) return recMsg("Enter a 6-digit pincode to watch.", true);
  const { tab } = await getProductTab();
  if (!tab?.id) return recMsg("Open the store's product page in the active tab first.", true);
  if (tab.url && !/^https?:/i.test(tab.url)) return recMsg("Open the store's product page first. Browser pages can't be recorded.", true);

  // 1. Write a fresh recording state into the page. This is also the access check.
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: "MAIN", args: [marker], func: Recorder.pageRecorderPrepare });
  } catch (e) {
    const msg = e?.message || String(e);
    // Clicking inside the side panel does not grant temporary access (Chrome only does that for
    // the toolbar icon), so a site outside the catalogue needs an explicit, per-site permission.
    const noAccess = /cannot access|permission|host/i.test(msg);
    showAccessBox(noAccess);
    if (noAccess && tab.url) $("recDomain").value = Stores.hostOf(tab.url);
    return recMsg(noAccess
      ? "PinScout doesn't have access to this site yet. Check the domain below, press “Allow access”, then press Start again."
      : `Couldn't attach to this page: ${msg}`, true);
  }
  showAccessBox(false);

  // 2. Keep recording across reloads and navigations: run the recorder at document_start on every
  //    page load of this site (before the store's own code), until Stop.
  let acrossReloads = true;
  try {
    const origin = new URL(tab.url).origin;
    try { await chrome.scripting.unregisterContentScripts({ ids: [Recorder.SCRIPT_ID] }); } catch { /* none registered */ }
    await chrome.scripting.registerContentScripts([{
      id: Recorder.SCRIPT_ID, matches: [`${origin}/*`], js: [Recorder.FILE],
      runAt: "document_start", world: "MAIN", persistAcrossSessions: false,
    }]);
  } catch { acrossReloads = false; }

  // 3. Reload the page once, so the recorder is in place BEFORE the store's own code runs. Stores often
  //    keep their own reference to fetch(); a recorder attached afterwards would never see those calls.
  let reloaded = false;
  if (acrossReloads) {
    try { await reloadAndWait(tab.id); reloaded = true; } catch { reloaded = false; }
  }
  if (!reloaded) {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: "MAIN", files: [Recorder.FILE] });
    } catch (e) {
      return recMsg(`Couldn't start the recorder: ${e?.message || e}`, true);
    }
  }

  recTabId = tab.id;
  $("recStart").disabled = true; $("recStop").disabled = false; $("recBox").hidden = true;
  recMsg(reloaded
    ? `Recording… PinScout reloaded the page so the recorder runs before the store's own code. Now change the delivery pincode to ${marker}, wait for it to update, then press “Stop & copy”. Further reloads are fine.`
    : acrossReloads
      ? `Recording… (couldn't reload the page, so calls the store made before now may be missed.) Change the delivery pincode to ${marker}, then press “Stop & copy”.`
      : `Recording this page… (Recording across reloads couldn't be enabled, so anything after a reload won't be captured.) Change the delivery pincode to ${marker}, then press “Stop & copy”.`);
}

function reloadAndWait(tabId, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let finished = false;
    let timer = null;
    const done = (err) => {
      if (finished) return;
      finished = true;
      if (timer !== null) clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      err ? reject(err) : resolve();
    };
    const onUpdated = (id, info) => { if (id === tabId && info.status === "complete") done(); };
    chrome.tabs.onUpdated.addListener(onUpdated);
    timer = setTimeout(() => done(), timeoutMs);            // slow page: carry on anyway
    Promise.resolve(chrome.tabs.reload(tabId)).catch((e) => done(e || new Error("reload failed")));
  });
}

// Called straight from the click, with nothing awaited first, so Chrome accepts the user gesture.
function recGrant() {
  const domain = normalizeDomain($("recDomain").value);
  if (!domain) return recMsg("Enter the store's domain, for example tatacliq.com.", true);
  chrome.permissions.request({ origins: [`https://*.${domain}/*`] }).then((granted) => {
    if (granted) showAccessBox(false);
    recMsg(granted ? `Access to ${domain} granted. Press Start again.` : `Access to ${domain} was not granted.`, !granted);
  }).catch((e) => recMsg(`Couldn't request access: ${e?.message || e}`, true));
}

function flashCopyButton(text) {
  const btn = $("recCopy");
  if (!btn) return;
  btn.textContent = text;
  setTimeout(() => { btn.textContent = "Copy"; }, 1600);
}

async function copyRecording() {
  const out = $("recOut");
  try { await navigator.clipboard.writeText(out.value); flashCopyButton("Copied ✓"); return true; }
  catch {
    out.select();
    try { document.execCommand("copy"); flashCopyButton("Copied ✓"); return true; }
    catch { flashCopyButton("Select all + copy"); return false; }
  }
}

// Where recordings go. The extension can't send mail by itself (that would need a server and
// keys shipped inside it), so "Send by email" copies the recording and opens a draft to paste into.
const RECORDING_EMAIL = "getsaurabhpagrut@gmail.com";
function setupSendLink(site) {
  const subject = `PinScout new store: ${site || "unknown site"}`;
  const body = "Hi,\n\nHere is a PinScout recording for " + (site || "a new store") +
    ". The recording is copied to your clipboard: paste it below this line (Ctrl+V or Cmd+V).\n\n";
  $("recMail").href = `mailto:${RECORDING_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  $("recAddr").textContent = RECORDING_EMAIL;
}
// Copy again on click, in case something else went on the clipboard since "Stop & copy".
$("recMail")?.addEventListener("click", () => { copyRecording(); });

async function recStop() {
  if (recTabId == null) return;
  let data;
  try {
    const [r] = await chrome.scripting.executeScript({ target: { tabId: recTabId }, world: "MAIN", func: Recorder.pageRecorderStop });
    data = r?.result;
  } catch (e) { data = { error: "Couldn't reach the page: " + (e?.message || e) }; }
  try { await chrome.scripting.unregisterContentScripts({ ids: [Recorder.SCRIPT_ID] }); } catch { /* already gone */ }
  const marker = $("recPin").value;
  recTabId = null;
  $("recStart").disabled = false; $("recStop").disabled = true;

  if (!data || data.error) return recMsg(data?.error || "No data returned.", true);

  $("recOut").value = JSON.stringify(data, null, 2);
  $("recSummary").textContent = Recorder.summarize(data);
  $("recBox").hidden = false;
  setupSendLink(String(data.store || "").replace(/^www\./, ""));
  const copied = await copyRecording();

  if (!data.count) {
    return recMsg(`No request carried ${data.marker || marker}, but PinScout still captured what the store did (${Recorder.summarize(data)}). That usually shows what it does instead. ${copied ? "It's copied" : "Use the Copy button"}: press “Send by email” and paste it in.`, true);
  }
  recMsg(`${copied ? "Copied" : "Captured"} ${Recorder.summarize(data)} from ${data.store}. ${copied ? "" : "Use the Copy button. "}Press “Send by email” and paste it in. Skim it first: tokens are masked, but check nothing personal is in there.`);
}

$("recStart")?.addEventListener("click", recStart);
$("recStop")?.addEventListener("click", recStop);
$("recCopy")?.addEventListener("click", copyRecording);
$("recGrant")?.addEventListener("click", recGrant);
$("recPin")?.addEventListener("input", () => { $("recPin").value = $("recPin").value.replace(/\D/g, "").slice(0, 6); });
$("recPin")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); if (!$("recStart")?.disabled) recStart(); }
});
$("recDomain")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); recGrant(); }
});

startBtn.addEventListener("click", () => { if (!running) start(); });
stopBtn.addEventListener("click", () => { stopRequested = true; stopBtn.disabled = true; });

// Close the side panel. chrome.sidePanel.close() exists from Chrome 141; older versions let the
// panel close its own window. A scan cut short this way still restores Amazon's pincode next time.
$("closePanel").addEventListener("click", async () => {
  stopRequested = true;
  try {
    if (chrome.sidePanel?.close) {
      const win = await chrome.windows.getCurrent();
      await chrome.sidePanel.close({ windowId: win.id });
      return;
    }
  } catch { /* fall back below */ }
  window.close();
});
pinInput.addEventListener("input", () => {
  // Digits only (also cleans up pasted text like "560 028").
  const clean = pinInput.value.replace(/\D/g, "").slice(0, 6);
  if (clean !== pinInput.value) pinInput.value = clean;
  refreshTierPreview();
});
// Enter in the pincode box, or its arrow button, starts the search.
$("pinGo").addEventListener("click", () => { if (!running) start(); });
pinInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    if (!running) start();
  }
});
$("nearbyCap").addEventListener("change", refreshTierPreview);
$("indiaMode").addEventListener("change", refreshTierPreview);
for (const id of TIER_IDS) $(`tier-${id}`).addEventListener("change", refreshTierPreview);

chrome.storage.local.get("homePin")
  .then(({ homePin }) => { if (homePin) { pinInput.value = homePin; refreshTierPreview(); } })
  .catch(() => {});
chrome.tabs.onActivated.addListener(refreshRetailerLabel);
chrome.tabs.onUpdated.addListener((_id, info) => { if (info.status === "complete") refreshRetailerLabel(); });
refreshRetailerLabel();
pinInput.focus?.();
loadDataset().catch((e) => { $("dataInfo").className = "warn"; $("dataInfo").textContent = e.message; });
