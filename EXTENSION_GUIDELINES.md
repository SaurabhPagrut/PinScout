# Extension guidelines

The rules PinScout keeps. `scripts/lint.mjs` and CI check the ones a script can check; the rest are checked in review.
How to work on the code day to day is in `.claude/skills/pinscout-dev/SKILL.md`.

## 1. The promise to the user

- **No account, no server, no tracking.** PinScout has no backend. It sends nothing to the developer or anyone else,
  except the delivery checks, which go only to the store the user is on.
- **No ads, no analytics**, in the extension or on the website.
- **Honest about data.** Each check sends a pincode to the store; only the home pincode (and, on Amazon, the pincode
  to restore) is kept on the device. `PRIVACY.md`, the Chrome privacy tab (`webstore/privacy-practices-tab.txt`:
  Website content + Location) and the Firefox build (`scripts/build.mjs`: `locationInfo`, `websiteContent`) say the
  same thing, and change together.
- **Never guess.** When a store answers in a way an adapter doesn't recognise, it reports an error, not a verdict.

## 2. Permissions (Manifest V3)

- `scripting`, `storage`, `sidePanel`, and host access only for stores with a working or experimental adapter.
  `tools/sync_manifest.py` writes the host list from `extension/data/stores.json`; CI fails if it's out of date.
- Any other site: `optional_host_permissions`, asked for one site at a time, only when the user presses "Allow access"
  in the recorder.
- A new permission needs a reason in the Chrome privacy tab text, the privacy policy, and a release note.

## 3. Code

- **No remote code.** No `eval`, `new Function`, string timers, or scripts from other sites. Plain JavaScript, no
  bundler, so the stores review readable source.
- **No HTML from strings** (`innerHTML`, `insertAdjacentHTML`, `document.write`): build elements and set `textContent`.
- **Network calls only in store adapters** (`extension/lib/stores/<id>.js`) **and the recorder**
  (`lib/recorder-page.js`). Elsewhere, `fetch()` only reads the extension's own files (`chrome.runtime.getURL`).
- **An adapter talks only to its own store's hosts** (from `stores.json`). Its `pageCheck` runs in the store's page
  (MAIN world), is fully self-contained, and returns the shape documented at the top of `lib/adapters.js`.
- **No third-party scripts on the website** either; `site/_headers` sets a CSP that blocks them.

## 4. Being polite to stores

- About a second between checks (a store can ask for more with `minDelayMs` in `stores.json`), doubled after each
  error in a row; a check with no answer in 20 s is an error, retried once.
- Stop the scan on HTTP 401/403/429, after 3 failed pincodes in a row, when the product tab navigates away, or on Stop.
- An adapter that changes store-side state (Amazon's delivery pincode) puts it back afterwards (`begin` / `end`).

## 5. Adapters and their tests

- A new adapter is **experimental** in `stores.json` until an available and a not-deliverable answer have both been
  seen, and has fixtures in `tests/fixtures/<id>/` (or is listed in `PENDING` in `tests/adapters.test.js`).
- When a store changes its answer, add the new answer as a fixture (`tools/make-fixture.js`) before fixing the adapter.
- The README's Stores table, the website's store list (read from `stores.json`) and the store listing say the same.

## 6. The recorder

- Runs only between Start and Stop, on the tab the user chose, for at most 10 minutes.
- Masks anything named or shaped like a secret or personal data; never stores HTML pages; keeps typed text only when it
  contains the pincode. `tests/recorder-mask.test.js` covers the cases; add one for every leak found.
- Nothing is uploaded: the user emails the recording from their own email app, if they choose.

## 7. Accessibility and look

- Respect reduced motion (the particles stay still). Light and dark. Keyboard-usable; Enter starts a search.
- Check the panel at 420 px and the website at 1280 and 390 px, light and dark (`scripts/browse.js`).

## 8. Cross-browser

- One source in `extension/`; `npm run build` makes each browser's package. Chrome and Edge use the side panel;
  Opera, Firefox and Safari open the same page in a window of their own (`background.js`).
- Firefox: background script, add-on id `pinscout@saurabhpagrut.in`, a name of at most 45 characters,
  `web-ext lint` with 0 errors.

## 9. Store policy and listing

- Store names appear only to say what PinScout works with; the listing says PinScout isn't affiliated with any store.
  No keyword lists, no other products' trademarks as keywords.
- Every claim in the listing, README and website is true to the code (`scripts/plan.js` for numbers).
- No paid or swapped reviews.

## 10. Release checklist

1. Version raised in `extension/manifest.json` and `package.json`; entry in `CHANGELOG.md`.
2. `npm test` (lint + tests) and `npm run build`; `npm run lint:firefox` with 0 errors.
3. Load `dist/chrome/pinscout-chrome-<version>/` unpacked and run one real scan on Flipkart.
4. If permissions, data or text changed: `PRIVACY.md`, `webstore/privacy-practices-tab.txt`, `webstore/store-listing.md`.
5. Upload; then tick the release in `ROADMAP.md`.
