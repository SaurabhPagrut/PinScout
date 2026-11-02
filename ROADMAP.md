# PinScout: roadmap

The one planning file for this project: where things stand, what's next, decisions and open questions. Update it as
PRs open and merge. Store-by-store status is in the README's **Stores** table; publishing steps are in
`webstore/chrome-web-store-guide.md`.

Much of the release and tooling plan below follows **BracelTheCat** (`~/Projects/BracelTheCat`), the other extension on
the same Chrome Web Store account, which has already been through the stores. Items marked *(from Bracel)* copy
something that already works there.

## Where things stand (2 Nov 2026)

- [x] Chrome extension (MV3, side panel) in `extension/`, version 1.0.3 built: tiered pincode search (your pincode → nearby →
      state → India), 19,586-pincode dataset from India Post, scan safety rules, "Help add a new store" recorder.
- [x] Store adapters: Flipkart and Croma **working**; Myntra, Amazon, Blinkit and Reliance Digital **experimental**.
      JioMart, Zepto and Swiggy Instamart not built (signed requests).
- [x] Safari fallback: no `chrome.sidePanel`, so the toolbar icon opens the panel in its own window (or a tab).
- [x] Chrome Web Store package and texts prepared: `webstore/` (listing, description, privacy policy, privacy tab
      answers, screenshots, promo tiles).
- [x] **Live on the Chrome Web Store** (by 2 Nov 2026):
      https://chromewebstore.google.com/detail/pinscout-pincode-delivery/oicfbaoamapgdhailjaaokgkdolalbco
- [x] Website and privacy policy built (2 Nov 2026), for https://pinscout.saurabhpagrut.in (Cloudflare Pages project `pinscouts`,
      `PUBLISHING.md`).
- [x] One build per browser (`npm run build` → `dist/<browser>/`), 1.0.3 with a Buy Me a Coffee link in the panel.
- [x] Website deployed on Cloudflare Pages (2 Nov 2026): https://pinscout.saurabhpagrut.in, with the privacy policy at
      `/privacy`; the Chrome dashboard's privacy policy URL points there.
- [x] 1.0.3 uploaded to the Chrome Web Store (2 Nov 2026), with **Location** ticked on the privacy tab. Until it's
      reviewed, the public listing still shows 1.0.1.
- [ ] **Next:** make the experimental adapters reliable (Phase 4), the demo video and GIF (Phase 5), make the repo
      public, then Firefox (Phase 6).

## Phase 1: project hygiene *(from Bracel)*

Goal: the repo explains itself, and every change is checked the same way.

- [x] `CLAUDE.md`: what PinScout is, a table of the files in the repo, ground rules (every change is a branch and a
      PR, never commit to `main`, "demo first" for visible changes), how to run tests.
- [x] `EXTENSION_GUIDELINES.md`: the rules PinScout keeps. The user's promise (no account, no server, no tracking), the
      permission model (six store hosts plus optional per-site access for the recorder only), scan safety limits,
      what the recorder masks, store policy, a release checklist.
- [x] `CHANGELOG.md`, one entry per version (1.0.0 to 1.0.3, and Unreleased); the Chrome guide points to it.
- [x] One privacy policy source: `PRIVACY.md`, built into the website by `npm run site`.
- [x] A root `package.json`: `npm test`, `npm run build`, `npm run site`, `npm run lint:firefox`.
- [x] `npm run lint`, `npm run screenshots`, `npm run plan`, `npm run browse`.
- [x] Fast dev tools *(from Bracely)*, described in the `pinscout-dev` skill (`.claude/skills/pinscout-dev/SKILL.md`):
      `tests/run.js` (parallel, one line per file, only failures shown, logs in `.check/`, `--changed`),
      `scripts/plan.js` (what a scan would check for a pincode), `scripts/browse.js` (the website and the side panel in a
      real browser: screenshots, sideways scroll, errors, outside requests).
- [x] `scripts/lint.mjs`: every script parses; no `eval`, `new Function` or remote code; network calls only in the
      store adapters and the recorder; manifest and `package.json` versions agree; `tools/sync_manifest.py` reports
      nothing missing.
- [x] CI (GitHub Actions, `.github/workflows/ci.yml`) on every PR and push to `main`: unit tests, manifest in step with
      `stores.json`, build every browser, `web-ext lint` on the Firefox package, build the website; zips and site
      uploaded as artifacts.
- [x] Dependabot (`.github/dependabot.yml`): weekly, for GitHub Actions and root npm.
- [ ] Branch protection on `main`: require the CI check to pass before merging (owner, GitHub settings).
- [x] Removed the unused Go backend and Vue frontend skeleton, and four helpers nothing called (2 Nov 2026).

## Phase 2: website and privacy page *(from Bracel)*

Goal: a public home for PinScout, with the privacy policy on it.

- [x] `site/` plus `npm run site` → `dist/site/`: landing page, About (`site/about.md`), privacy (from `PRIVACY.md`),
      404. No analytics. Buy Me a Coffee button.
- [x] Deploy on Cloudflare Pages as `pinscouts` (pinscouts.pages.dev; `pinscout` was taken), then add `pinscout.saurabhpagrut.in` (owner).
- [x] Landing page: what it does, a screenshot, the stores (read from `extension/data/stores.json`), "Add to Chrome",
      and the India Post data credit.
- [x] A **live demo** on the landing page ("Try the search plan"): type a pincode and see the tiers it would check,
      from the extension's own `planner.js` and `pincodes.json`, in the browser (`site/demo.js`).
- [x] Point the Chrome dashboard's privacy policy URL at the new page.
- [x] Link the listing and the website from the README.
- [x] An "Add a store" guide on the site (`site/add-a-store.md` → `/add-a-store`): how to record a store with "Help
      add a new store" and send it, what a recording holds and what is masked.

## Phase 3: one build per browser *(from Bracel)*

Goal: `npm run build` makes every store's package from one source tree. It replaces the hand-made
`pinscout-chrome-webstore-<version>.zip`.

- [x] `scripts/build.mjs` → `dist/<browser>/pinscout-<browser>-<version>/` plus a zip (older zips kept), and `dist/README.md` saying which
      zip goes to which store. The zips hold only `extension/` (no tests or tools). No bundler or
      minifying, so the stores get readable source.
- [x] **Chrome, Edge, Opera:** same files. Edge has `chrome.sidePanel`. Opera may not, in which case it uses the
      window fallback. Check it.
- [x] **Firefox:** a background script instead of the service worker, a `gecko` add-on id, and
      `data_collection_permissions: { required: ["none"] }` (required for new add-ons since Nov 2025). The panel
      should use Firefox's own `sidebar_action` rather than the window fallback. Check `scripting.executeScript` with
      `world: "MAIN"` in Firefox. `web-ext lint` must show 0 errors.
- Skipped: **Safari** (Apple's `safari-web-extension-converter` needs Xcode and the Apple Developer Program, US$99 a
  year). Decided 2 Nov 2026; the window fallback in the code stays.
- [ ] A `--test` build for the end-to-end tests (see Phase 4).
- [ ] Not separate stores: Brave, Vivaldi, Arc and Yandex install from the Chrome Web Store. Say so on the site.

## Phase 4: adapters that don't break silently

Goal: know when a store changes its delivery check before users notice. This is where PinScout differs most from
Bracel. Bracel only reads the page; PinScout depends on six stores' private endpoints.

- [x] **Fixtures per store** (`tests/fixtures/<store>/`): Flipkart has 8 cases (available, not deliverable, sold out, DC
      change, throttled, a recommendation that disagrees, no serviceable field, not JSON), synthetic for now.
      `tools/make-fixture.js` turns a real answer into a masked fixture (`tests/fixtures/README.md`).
- [ ] Recorded answers for Flipkart (available + not deliverable) to replace the synthetic ones (owner captures).
- [x] Fixtures for Croma: 10 cases (single and listed assignments, quantity 0, another product's line first, no
      promise, not JSON, 429, 500, not a product page), synthetic for now.
- [ ] Recorded Croma answers (available + not deliverable): the adapter still *assumes* "no assignment" means not
      deliverable.
- [x] Fixtures for the experimental adapters, synthetic for now: Reliance Digital 10, Myntra 8, Blinkit 8 (available,
      not deliverable, sold out, the store's errors, page data missing). The sandbox page can now carry the page's own
      state (`page`, `cookie`, `localStorage`) and requests are checked for path, query and headers. Amazon reads
      its verdict from HTML, so it stays in `PENDING`; its pincode save-and-restore has its own tests
      (`tests/amazon-restore.test.js`).
- [x] **Offline adapter tests** (`tests/adapters.test.js`, in CI): the real adapter in a Node sandbox page, `fetch`
      answered from the fixture, the verdict compared (status, delivery date, stock, fatal).
- [ ] **End-to-end test of the built extension**: load `dist/test`, open a saved Flipkart page, run a scan against the
      fixtures, and check that the panel shows the nearest-available card. Also check that no request goes anywhere
      except the store's own host.
- [ ] **Live smoke test**, kept out of CI *(from Bracel's `npm run test:live`)*: one known product per store and one
      pincode, run by hand before each release.
- [ ] Get the experimental adapters to **working**: recorded answers (one available, one not deliverable) for each,
      made with `tools/make-fixture.js`. Each also needs the sample its own notes say is missing:
  - [ ] Reliance Digital: a recording for an *available* pincode, and confirmation that the call works without
        `x-fp-signature`.
  - [ ] Myntra: confirm the `window.__myx` path on several product types.
  - [x] Amazon: the restore of the original pincode after a scan stopped part-way. Fixed a race: Stop didn't wait for
        the check still running in the page, so it could land after the restore and leave the scanned pincode set.
        The panel now waits for it (at most 20 s) before `end()`.
  - [ ] Blinkit: check that the session headers read from the visitor's own cookies hold up across a long scan.
- [ ] Signed stores (JioMart, Zepto, Swiggy Instamart): try the "drive the store's own UI" approach from the README on
      one store first, using the recorder's `steps` capture.

## Phase 5: store listing assets as scripts *(from Bracel)*

- [x] `scripts/screenshots.js` (`npm run screenshots`): the five 1280×800 screenshots with their caption bars, made from the fixtures (Phase
      4), so they can be redone after any UI change without real addresses on screen.
- [x] Promo tiles from the same script (440×280, 1400×560).
- [ ] A demo video and GIFs (`npm run video`, `npm run gif`) for YouTube and Product Hunt, to Bracel's specifications.

## Phase 6: more stores and being found *(from Bracel)*

- [ ] Edge Add-ons (needs a Microsoft Partner Center account, owner).
- [ ] **Firefox AMO** (free account, owner), after trying the Firefox build in Firefox. Next store after Chrome.
- [ ] Opera add-ons (owner).
- [x] Listing text aimed at what people search for (e.g. "pincode checker", "delivery availability", "out of stock
      finder", "Flipkart pincode"). Don't use other products' trademarks as keywords. The store names may only appear
      where they describe what PinScout works with.
- [ ] First honest reviews from friends and colleagues. No paid or swapped reviews (store policy).
- [ ] Share it where self-promotion is allowed (e.g. r/india and deal or shopping communities, r/chrome_extensions),
      and on Product Hunt.

## Later

- [ ] "Tell me when it's back": re-check a saved product and pincode now and then, on the user's device and within the
      same scan safety rules. This needs a decision on how often is polite to the store, and on alarms permission.
- [ ] More stores, recorded by users with "Help add a new store" (the guide is in Phase 2).
- [ ] Refresh the pincode dataset when India Post publishes a newer file. Track known missing pincodes like 560028.
- [ ] Firefox for Android: only after trying the panel on a phone.

## Decisions

- **The browser extension is the product.** A browser session works better than a server for these stores, because
  checks run inside the store's page using the user's own session (README). The unused Go backend and Vue frontend
  skeleton was removed on 2 Nov 2026.
- **Permissions:** host access only for stores with a working or experimental checker. Any other site is asked for one
  site at a time, only from the recorder (`webstore/privacy-practices-tab.txt`).
- **Side panel, not a popup.** A popup closes as soon as you click the page and kills the scan. Where there's no side
  panel, open the panel in its own window instead.
- **Experimental adapters say what they found instead of guessing** when a store's response doesn't match what's
  expected.
- 1.0.1 is live on the Chrome Web Store (listing above). Updates go through the same item.
- 2 Nov 2026: the Chrome description doesn't name stores: 1.0.3 was rejected for it as excessive keywords (Yellow
  Argon). The website lists them instead.
- 2 Nov 2026: Reliance Digital is listed as experimental in the README to match `stores.json` (PR #1).
- 2 Nov 2026: release tooling, website and multi-browser builds follow BracelTheCat's setup.
- 2 Nov 2026: no Safari build for now (needs Xcode and a paid Apple developer account).
- 2 Nov 2026: no Hindi or other languages for the panel; English only.
- 2 Nov 2026: the repo is public, so users can read the source (as Bracel's is), under the MIT licence (`LICENSE`).

## Open questions

- Firefox: is `sidebar_action` enough for a long-running scan, or does it need the window fallback too?
