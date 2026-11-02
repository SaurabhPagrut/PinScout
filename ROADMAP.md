# PinScout: roadmap

The one planning file for this project: where things stand, what's next, decisions and open questions. Update it as
PRs open and merge. Store-by-store status is in the README's **Stores** table; publishing steps are in
`webstore/chrome-web-store-guide.md`.

Much of the release and tooling plan below follows **BracelTheCat** (`~/Projects/BracelTheCat`), the other extension on
the same Chrome Web Store account, which has already been through the stores. Items marked *(from Bracel)* copy
something that already works there.

## Where things stand (2 Nov 2026)

- [x] Chrome extension (MV3, side panel) in `extension/`, version 1.0.1: tiered pincode search (your pincode → nearby →
      state → India), 19,586-pincode dataset from India Post, scan safety rules, "Help add a new store" recorder.
- [x] Store adapters: Flipkart and Croma **working**; Myntra, Amazon, Blinkit and Reliance Digital **experimental**.
      JioMart, Zepto and Swiggy Instamart not built (signed requests).
- [x] Safari fallback: no `chrome.sidePanel`, so the toolbar icon opens the panel in its own window (or a tab).
- [x] Chrome Web Store package and texts prepared: `webstore/` (listing, description, privacy policy, privacy tab
      answers, screenshots, promo tiles).
- [x] **Live on the Chrome Web Store** (by 2 Nov 2026):
      https://chromewebstore.google.com/detail/pinscout-pincode-delivery/oicfbaoamapgdhailjaaokgkdolalbco
- [x] Website and privacy policy (2 Nov 2026): https://pinscout.pages.dev, custom domain
      `pinscout.saurabhpagrut.in` to follow (`PUBLISHING.md`).
- [ ] Open PR: #1, README lists Reliance Digital as experimental.
- [x] One build per browser (`npm run build` → `dist/<browser>/`), 1.0.3 with a Buy Me a Coffee link in the panel.
- [ ] **Next:** deploy the site to Cloudflare Pages, upload 1.0.3, submit to Edge and Firefox (Phase 6).

## Phase 1: project hygiene *(from Bracel)*

Goal: the repo explains itself, and every change is checked the same way.

- [ ] `CLAUDE.md`: what PinScout is, a table of the files in the repo, ground rules (every change is a branch and a
      PR, never commit to `main`, "demo first" for visible changes), how to run tests.
- [ ] `EXTENSION_GUIDELINES.md`: the rules PinScout keeps. The user's promise (no account, no server, no tracking), the
      permission model (six store hosts plus optional per-site access for the recorder only), scan safety limits,
      what the recorder masks, store policy, a release checklist.
- [ ] `CHANGELOG.md`, one entry per version (1.0.0, 1.0.1 so far). Move "What changed in this build" out of
      `webstore/chrome-web-store-guide.md`. That section says 1.0.0 while the top of the guide says 1.0.1.
- [x] One privacy policy source: `PRIVACY.md`, built into the website by `npm run site`.
- [x] A root `package.json`: `npm test`, `npm run build`, `npm run site`, `npm run lint:firefox`.
- [ ] More scripts as they come: `lint`, `screenshots`, `serve`.
- [ ] `scripts/lint.mjs`: every script parses; no `eval`, `new Function` or remote code; network calls only in the
      store adapters and the recorder; manifest and `package.json` versions agree; `tools/sync_manifest.py` reports
      nothing missing.
- [ ] CI (GitHub Actions) on every PR: lint, unit tests, build, `web-ext lint` on the Firefox package, upload the zips
      as artifacts.
- [ ] Decide what happens to the unused Go backend and Vue frontend (see Open questions).

## Phase 2: website and privacy page *(from Bracel)*

Goal: a public home for PinScout, with the privacy policy on it.

- [x] `site/` plus `npm run site` → `dist/site/`: landing page, About (`site/about.md`), privacy (from `PRIVACY.md`),
      404. No analytics. Buy Me a Coffee button.
- [ ] Deploy on Cloudflare Pages as `pinscout` (pinscout.pages.dev), then add `pinscout.saurabhpagrut.in` (owner).
- [x] Landing page: what it does, a screenshot, the stores (read from `extension/data/stores.json`), "Add to Chrome",
      and the India Post data credit.
- [ ] A **live demo** on the landing page: type a pincode and see the search tiers it would check. This uses
      `lib/planner.js` and `pincodes.json` in the browser, with no store involved (the same way Bracel's site runs its
      engine).
- [ ] Point the Chrome dashboard's privacy policy URL at the new page.
- [ ] Link the listing from the README.

## Phase 3: one build per browser *(from Bracel)*

Goal: `npm run build` makes every store's package from one source tree. It replaces the hand-made
`pinscout-chrome-webstore-<version>.zip`.

- [x] `scripts/build.mjs` → `dist/<browser>/pinscout-<browser>-<version>/` plus a zip (older zips kept), and `dist/README.md` saying which
      zip goes to which store. The zips hold only `extension/` (no tests, tools, backend or frontend). No bundler or
      minifying, so the stores get readable source.
- [ ] **Chrome, Edge, Opera:** same files. Edge has `chrome.sidePanel`. Opera may not, in which case it uses the
      window fallback. Check it.
- [ ] **Firefox:** a background script instead of the service worker, a `gecko` add-on id, and
      `data_collection_permissions: { required: ["none"] }` (required for new add-ons since Nov 2025). The panel
      should use Firefox's own `sidebar_action` rather than the window fallback. Check `scripting.executeScript` with
      `world: "MAIN"` in Firefox. `web-ext lint` must show 0 errors.
- [ ] **Safari:** the unpacked folder for Apple's `safari-web-extension-converter`. This needs Xcode and the Apple
      Developer Program (US$99 a year), so it's for later.
- [ ] A `--test` build for the end-to-end tests (see Phase 4).
- [ ] Not separate stores: Brave, Vivaldi, Arc and Yandex install from the Chrome Web Store. Say so on the site.

## Phase 4: adapters that don't break silently

Goal: know when a store changes its delivery check before users notice. This is where PinScout differs most from
Bracel. Bracel only reads the page; PinScout depends on six stores' private endpoints.

- [ ] **Saved fixtures per store** *(Bracel's saved-pages idea)*: a saved product page plus recorded delivery-check
      responses (available, not deliverable, sold out, throttled), with personal data masked by the recorder.
- [ ] **Offline adapter tests** (Playwright): run each `pageCheck` against its fixture with network calls answered from
      the recordings. Check the verdict each time (`serviceable`, `soldOut`, `eta`).
- [ ] **End-to-end test of the built extension**: load `dist/test`, open a saved Flipkart page, run a scan against the
      fixtures, and check that the panel shows the nearest-available card. Also check that no request goes anywhere
      except the store's own host.
- [ ] **Live smoke test**, kept out of CI *(from Bracel's `npm run test:live`)*: one known product per store and one
      pincode, run by hand before each release.
- [ ] Get the experimental adapters to **working**. Each needs the sample its own notes say is missing:
  - [ ] Reliance Digital: a recording for an *available* pincode, and confirmation that the call works without
        `x-fp-signature`.
  - [ ] Myntra: confirm the `window.__myx` path on several product types.
  - [ ] Amazon: check the restore of the original pincode after a scan that was stopped part-way.
  - [ ] Blinkit: check that the session headers read from the visitor's own cookies hold up across a long scan.
- [ ] Signed stores (JioMart, Zepto, Swiggy Instamart): try the "drive the store's own UI" approach from the README on
      one store first, using the recorder's `steps` capture.

## Phase 5: store listing assets as scripts *(from Bracel)*

- [ ] `scripts/screenshots.mjs`: the five 1280×800 screenshots with their caption bars, made from the fixtures (Phase
      4), so they can be redone after any UI change without real addresses on screen.
- [ ] Promo tiles from the same script (440×280, 1400×560).
- [ ] Optional: a short demo video and GIF (`npm run video`, `npm run gif`) for YouTube and Product Hunt.

## Phase 6: more stores and being found *(from Bracel)*

- [ ] Edge Add-ons (needs a Microsoft Partner Center account, owner).
- [ ] Firefox AMO (free account, owner), after trying the Firefox build in Firefox.
- [ ] Opera add-ons (owner).
- [ ] Listing text aimed at what people search for (e.g. "pincode checker", "delivery availability", "out of stock
      finder", "Flipkart pincode"). Don't use other products' trademarks as keywords. The store names may only appear
      where they describe what PinScout works with.
- [ ] First honest reviews from friends and colleagues. No paid or swapped reviews (store policy).
- [ ] Share it where self-promotion is allowed (e.g. r/india and deal or shopping communities, r/chrome_extensions),
      and on Product Hunt.

## Later

- [ ] "Tell me when it's back": re-check a saved product and pincode now and then, on the user's device and within the
      same scan safety rules. This needs a decision on how often is polite to the store, and on alarms permission.
- [ ] More stores, recorded by users with "Help add a new store" (a contribution guide on the site).
- [ ] Hindi (and other languages) for the panel.
- [ ] Refresh the pincode dataset when India Post publishes a newer file. Track known missing pincodes like 560028.
- [ ] Firefox for Android: only after trying the panel on a phone.

## Decisions

- **The Chrome extension is the product.** A browser session works better than a server for these stores, because
  checks run inside the store's page using the user's own session (README).
- **Permissions:** host access only for stores with a working or experimental checker. Any other site is asked for one
  site at a time, only from the recorder (`webstore/privacy-practices-tab.txt`).
- **Side panel, not a popup.** A popup closes as soon as you click the page and kills the scan. Where there's no side
  panel, open the panel in its own window instead.
- **Experimental adapters say what they found instead of guessing** when a store's response doesn't match what's
  expected.
- 1.0.1 is live on the Chrome Web Store (listing above). Updates go through the same item.
- 2 Nov 2026: Reliance Digital is listed as experimental in the README to match `stores.json` (PR #1).
- 2 Nov 2026: release tooling, website and multi-browser builds follow BracelTheCat's setup.

## Open questions

- The Go backend and Vue frontend are the original skeleton and the extension doesn't use them. Delete them, move them
  to an `archive/` branch, or keep them for a possible web version?
- Where the website lives: a subdomain next to Bracel's (`pinscout.saurabhpagrut.in`), or GitHub Pages?
- Make the repo public so users can read the source (as Bracel did)?
- Firefox: is `sidebar_action` enough for a long-running scan, or does it need the window fallback too?
