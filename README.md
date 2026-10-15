# PinScout

Finds where a product can be delivered by scouting outward from your pincode: your pincode, then nearby, then the rest of your state, then all of India. Stops at the first place it's available.

**The Chrome extension in `extension/` is the product.** The Go backend and Vue frontend folders are the original skeleton; the extension does not use them (a browser session works better than a server for these stores).

## Stores
| Store | Status |
|---|---|
| Flipkart | Working |
| Croma | Working |
| Myntra | **Experimental.** Its delivery check is unsigned and stateless, so it can be replayed, but the request needs per-size product data from the page (skuId, warehouses, price). Where that lives in the page is assumed (`window.__myx`); if the assumption is wrong the adapter says what it found instead of guessing |
| Amazon | **Experimental.** Signed out, the delivery-location check (`address-change`) is a simple `zipCode` POST. It changes the visitor's delivery location as a side effect, so the adapter saves the original pincode before a scan and restores it after. Amazon doesn't return the availability verdict as JSON — it's in the reloaded product page's HTML — so the adapter re-fetches the page and reads the `#availability`/buy-box markup. If Amazon's markup doesn't match what's expected, it reports an error instead of guessing |
| Blinkit | **Experimental.** `location/autoSuggest` + `location/info` resolve a pincode to serviceability for that spot (dark-store coverage), then `v1/layout/product/<id>` is scanned for a sold-out marker for the specific item. The session headers Blinkit's own JS sends on every request (`access_token`, `auth_key`, `session_uuid`, `device_id`) are read from the visitor's own cookies/localStorage at check time rather than hardcoded, since the recorded values were per-session. None of these calls save the looked-up address as the account's delivery location |
| JioMart, Reliance Digital | Not built. Both run on the Fynd storefront, where every request carries a per-request signature (`x-fp-signature`). Replaying those from outside the site's own code doesn't work |
| Zepto, Swiggy Instamart | Not built. Location based (pincode -> lat/lng -> nearest dark store) and every request is signed (`request-signature`, a rotating `matcher` header) |

**Signed stores.** Where requests are signed by the site's own JavaScript, the workable approach is to drive the store's own UI (open the pincode box, type, submit) and read the response the site itself receives, because the site signs its own requests. The recorder's `steps` capture is there to make that possible.

## Adding a store
Each store checks delivery through its own internal request, so an adapter needs one captured example first.

**1. Record it.** Open the store's product page. In the panel, open **Help add a new store**, enter a pincode, press **Start**, change the delivery pincode on the store's page to that number, then press **Stop & copy** (or use the Copy button on the output box). Skim it, then share it.

The recorder is built to survive what stores actually do:
- **Reload on Start.** Pressing Start reloads the page once, so the recorder runs at `document_start`, before the store's own code. Stores often keep their own reference to `fetch()`; a recorder attached later would never see those calls.
- **Reloads and navigations afterwards.** It re-installs itself on every page load of the site and keeps what it captured in the tab's session storage. It switches itself off after 10 minutes.
- **Chains.** Many stores turn the pincode into lat/lng or a place id and only use those afterwards. Those values are learned from matching traffic and used as extra markers (`learnedMarkers`), so follow-up calls are captured too. You can navigate to a product page during a recording.
- **When nothing carries the pincode**, you still get `activity` (requests the page made, minus trackers), `hints` (localStorage / sessionStorage / cookie writes involving the pincode), `resources` (URLs the browser saw, flagged when the hooks missed them) and `pageLoads`.
- **`steps`**: what you did in the page (clicks, typing, Enter) as compact element descriptions. Typed text is not recorded, except a value containing the pincode; passwords never.
- **`stateHints`**: where the values used in the requests (SKU ids, warehouses, prices) live in the page's JavaScript state, as paths.
- **Compact JSON.** Long strings and arrays are shortened, keys are kept, so a whole request/response structure fits.
- **Privacy.** Values of anything named like a cookie, token, csrf, session, secret, key, authorization or signature, and like an address, name, phone or e-mail, are masked. HTML pages are never stored (they can hold saved addresses), only their size. Masking is best effort: if you're logged in, skim the result first, or record while logged out.

**2. Build the adapter.** Three small steps:
1. Add an entry to `extension/data/stores.json`: `{ "id": "amazon", "name": "Amazon", "hosts": ["amazon.in"] }` (already there for the planned stores).
2. Create `extension/lib/stores/<id>.js` that calls `Adapters.register({ id, pageCheck })`. `pageCheck(pincode)` runs inside the store's page and returns `{ ok: true, serviceable, soldOut?, stock?, title?, eta? }` or `{ ok: false, httpStatus?, error? }`. See `lib/stores/flipkart.js` and the contract at the top of `lib/adapters.js`.
3. Add a `<script src="lib/stores/<id>.js">` line to `sidepanel.html`, then run `python3 tools/sync_manifest.py`. It regenerates the manifest's site permissions from `stores.json` and warns about missing pieces.

Everything else (finding the store for a tab, standard verdicts, stopping when a store throttles with HTTP 401/403/429, the search itself) is shared. Optional hooks: `begin(tabId)` / `end(tabId, state)` let an adapter save and restore store-side state (for example a saved delivery location) around a scan, and `check(tabId, pincode)` replaces the default flow entirely.

## Using the extension

Open a Flipkart product page, click the PinScout icon (opens a side panel), type your pincode and press **Enter** (or click **Find availability**).

Search order, stopping at the first pincode where the product is deliverable:
1. **Your pincode**
2. **Nearby** – same district / postal prefix / within ~40 km (you pick how many)
3. **Your state** – one representative pincode per district
4. **Rest of India** – one representative pincode per state/UT (configurable)

Under **Where to search**, four compact checkboxes (all ticked by default) let you skip areas, e.g. only "Your pincode", or jump straight to "Rest of India". Once you type a valid pincode the labels update to your state and show how many pincodes each area will check. Drag the side panel wider and the pincode box and the areas sit side by side. Less-used options (nearby limit, India coverage, "don't stop at first hit") are under **Settings**.

Tick "Don't stop at the first hit" to list every place it's available instead.

The Find/Stop buttons stay pinned at the top of the panel, and the log only auto-scrolls if you're already at the bottom, so you can scroll up mid-scan without being pulled back down.

Safety: ~1s randomised delay between requests (a store can ask for slower with `minDelayMs` in `stores.json`), doubled after each error in a row; a check that gets no answer in 20s counts as an error, and an errored pincode is retried once before moving on. The scan stops on HTTP 429/403/401, after 3 failed pincodes in a row, if you navigate the product tab away, or when you press Stop (even mid-request).

Install: `chrome://extensions` -> Developer mode -> Load unpacked -> select the `extension` folder (Chrome 114+).

### Pincode dataset
This build ships with the **full dataset**: `extension/data/pincodes.json` – 19,586 unique pincodes, 36 states/UTs, 97% with usable coordinates – built from the India Post "All India Pincode Directory" (data.gov.in). `pincodes.seed.json` is a 70-pincode starter list used only as a fallback if `pincodes.json` is missing.

The panel shows what is loaded under the pincode box ("Pincode data: 19,586 pincodes loaded").

Rebuild (e.g. from a newer CSV): `python3 tools/build_pincodes.py path/to/AllIndiaPinCodes.csv`, then reload the extension. The script:
- collapses ~165k post-office rows to one entry per pincode (majority state/district, median coordinates)
- drops coordinates more than 150 km from their own district's centre (~2% of the source file has coordinates in the wrong place)
- flags head-post-office pincodes and big cities so they are preferred as representatives
- infers a missing state from neighbouring pincodes

Known gap: the India Post file does not contain every real pincode (for example 560028 is absent). For a pincode that isn't listed, PinScout borrows the district and location of the closest listed pincode with the same 3-digit prefix, so nearby search still works.

Attribution: Pincode data: Department of Posts, Government of India, via data.gov.in, under the Government Open Data Licence – India.

### Search settings
- **Nearby**: same district, same 3-digit prefix, or within ~40 km (when coordinates exist). You choose how many to check (10 / 25 / 50 / 100 / all). The label shows e.g. "50 of 111".
- **Rest of your state**: one pincode per district (every district, picked from outside the nearby area when possible).
- **Rest of India**: 1 per state (fast), 3 per state, or 1 per district (very slow).

### Look and feel
Tiny drifting particles in the background react to the cursor. The animation pauses when the panel is hidden and stays still if your system is set to reduce motion.

### Code layout
- `data/stores.json` – the store catalogue (single source of truth for names and hosts)
- `data/pincodes.json` – full pincode dataset; `pincodes.seed.json` – small fallback
- `lib/stores.js` – catalogue lookup (which store is this URL?)
- `lib/adapters.js` – adapter registry and shared behaviour
- `lib/stores/<id>.js` – one adapter per store
- `lib/planner.js` – builds the search tiers (pure logic)
- `lib/scanner.js` – runs the loop, stop/abort rules (pure logic, no Chrome APIs)
- `lib/recorder.js` – recorder helpers for the panel; `lib/recorder-page.js` – the recorder that runs inside the store page (also mirrors what a store adapter has to be able to do)
- `lib/particles.js` – background animation
- `sidepanel.*` – UI
- `tools/build_pincodes.py` – builds the pincode dataset from the India Post CSV
- `tools/probe-page-state.js` – paste into the browser console to find where product data lives in a store page (for stores whose delivery check needs it)
- `tools/sync_manifest.py` – keeps manifest permissions in step with `stores.json`
