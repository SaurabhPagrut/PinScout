# Changelog

What changed in each version of the extension. The store-listing steps for a release are in
`webstore/chrome-web-store-guide.md`; how to build and publish one is in `PUBLISHING.md`.

## Unreleased

- Store screenshots and promo tiles are made by `npm run screenshots` from the real panel. Screenshot 5 now says
  "Only your home pincode is saved, on your device" (it said "Your pincode stays on your device", which overstated it).
- Removed four helpers nothing called (`Adapters.has`, `Adapters.pending`, `Stores.byId`, `Stores.originPatterns`).
  No change in behaviour.
- The recorder's masking rules (`scrub`, `sensitiveKey`) are exposed alongside the others, for `tools/make-fixture.js`.
  No change in behaviour.

## 1.0.3 (built 2 Nov 2026; upload to the Chrome Web Store pending)

- A small "pinscout.saurabhpagrut.in · ☕ Buy me a coffee" line at the bottom of the panel. Both are plain links that open in
  a new tab; PinScout sends nothing when they're shown.
- The privacy policy moved to https://pinscout.saurabhpagrut.in/privacy (built from `PRIVACY.md`), with a paragraph on the
  coffee link.
- Chrome privacy tab: also declare **Location** (pincodes are regions). The Firefox build declares the same
  (`locationInfo`, `websiteContent`).
- Builds for Chrome, Edge, Opera, Firefox and Safari from one source (`npm run build`).
- No change to how checks work, and no new permissions.
- First submission rejected (Yellow Argon, "excessive keywords") for naming the stores in the description; the
  description now says "six popular Indian shopping sites" and points to the website. Same package resubmitted.

## 1.0.2 (2 Nov 2026)

- Store title "PinScout: Out of Stock & Pincode Delivery Finder India", and a summary that leads with "Out of stock
  or not deliverable to your pincode?" (both come from the manifest).
- New store description: names the supported stores, says which are experimental, and says that the original pincode
  is restored only on Amazon.
- No code changes.

## 1.0.0 and 1.0.1 (October 2026, Chrome Web Store)

First versions of PinScout.

- Checks delivery for the product on the open page, searching outward from your pincode: nearby pincodes, the rest of
  your state, then the rest of India, stopping at the first place it can be delivered (or listing them all).
- India Post data for 19,586 pincodes; "nearby" by real distance; you choose how far to search.
- Stores: Flipkart and Croma working; Amazon, Myntra, Blinkit and Reliance Digital experimental. Host permissions cover
  only these six; any other site is asked for one at a time, only from the "Help add a new store" recorder.
- Scan safety: about a second between checks, slower after errors, stops on HTTP 401/403/429 or 3 failures in a row.
- "Help add a new store": records how a store checks delivery, masks personal data, and lets you email it yourself.
- Safari: the side-panel call is skipped where it doesn't exist, and the toolbar icon opens PinScout in its own window.
