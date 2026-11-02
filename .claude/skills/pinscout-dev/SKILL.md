---
name: pinscout-dev
description: How to build, test, check and ship changes in the PinScout repo quickly and cheaply. Use for any code change, bug fix, new store adapter, website or store-listing copy, PR or review in this repo, and whenever you'd run tests, look at the panel or the website, check what a scan would do, or prepare a release.
---

# Working on PinScout: the fast path

Slow work is scripted. Use these instead of writing throwaway scripts or reading long logs.

## Tests: `tests/run.js`
| Command | When |
| --- | --- |
| `node tests/run.js --changed` | while working: only the test files your change can affect (it reads what each test loads) |
| `node tests/run.js planner scan` | one or a few files, by name or part of a name |
| `npm test` | before every PR (CI runs the same) |
| `node tests/run.js --list` | which file reads what |

Output is one line per file; a failure prints only its failing checks with the lines that explain them, plus the path of the full log in `.check/<file>.log`. Read the summary; open a log only when the failure lines aren't enough. Never read PASS lines.

Every `tests/*.test.js` runs; there is no list to add a new file to. Write checks with `tests/check.js`: `test("name", () => { assert… })` (async allowed), so the runner can count them and show only failures.

## Store adapters: fixtures, offline
`tests/adapters.test.js` runs every adapter on every `tests/fixtures/<store>/<case>.json` (a store's answer plus the verdict
PinScout should reach) in a sandbox page (`tests/adapter-harness.js`): the real `stores.js`, `adapters.js` and adapter,
with `fetch` answered from the fixture. Add a real answer with
`node tools/make-fixture.js <store> <case> --response <file> --url <page> --pincode <pin> --expect available|unavailable`
(it masks with the recorder's rules and prints the adapter's verdict); how to capture one: `tests/fixtures/README.md`.
When an adapter changes, every fixture for it must still pass; when a store changes, add its new answer as a fixture.
A new adapter needs fixtures or an entry in `PENDING` in `tests/adapters.test.js`.

## What a scan would check: `scripts/plan.js`
```
node scripts/plan.js 560001                                   tiers, counts, the first pincodes of each
node scripts/plan.js 560028 --nearby 100 --india district --all
node scripts/plan.js --store "https://www.croma.com/x/p/123"  which store a URL is, and its adapter status
```
Use it before writing website, README or store copy that states numbers or behaviour: every claim must match real output.

## The browser: `scripts/browse.js`
```
node scripts/browse.js shot / --widths 1280,390 --theme dark --at "#stores"   a website page
node scripts/browse.js shot panel --url "https://www.croma.com/p/1"           the side panel on a pretend product tab
node scripts/browse.js eval panel "document.querySelector('#retailer').textContent"
node scripts/browse.js shot panel --js "document.querySelector('#pin').value='560001'"
```
It rebuilds the website first when its sources are newer, serves it with the real CSP from `site/_headers`, prints one line per check (sideways scroll, page and console errors, failed loads, any request that leaves localhost: the site and the panel must make none) and saves screenshots to `.check/shots/`. Look at a screenshot only for visual changes. Check the website at 1280 and 390 px, the panel at 420 px, in light and dark.

The panel runs outside the extension with a stand-in `chrome.*` (a product tab at `--url`, storage in memory, every check answers "not deliverable"): it shows layout and text, not real store checks. For real checks, load `dist/chrome/pinscout-chrome-<version>/` unpacked.

## Builds
- `npm run build`: every browser into `dist/<browser>/` (older zips kept). Refuses if `package.json` and `extension/manifest.json` versions differ.
- `npm run lint:firefox`: must be 0 errors (the 4 `sidePanel` warnings are expected; the code checks for it first).
- `npm run site`: the website into `dist/site/`.

## House rules (from the owner; don't re-derive them)
- **Every change ends in a branch, a push and a PR** without asking. Never commit to `main`. One PR per coherent change; fixes before features.
- **Merging:** merge CI and Dependabot PRs yourself when green; ask before merging any other PR, unless the owner says to merge it.
- **Version:** in both `extension/manifest.json` and `package.json`, plus an entry in section 5 of `webstore/chrome-web-store-guide.md`. The store title and summary come from the manifest, so changing them needs a release.
- **Store and website copy must be true to the code.** Pincodes *are* sent to the store in each check; only the home pincode stays on the device; the original pincode is restored only on Amazon; the dataset is India Post's pincode list (not boundaries); the panel must stay open while it checks. Name stores only to say what PinScout works with, and keep "not affiliated".
- **Data declarations stay in step:** the Chrome privacy tab (`webstore/privacy-practices-tab.txt`: Website content + Location), the Firefox build (`scripts/build.mjs`: `locationInfo`, `websiteContent`) and `PRIVACY.md` describe the same thing.
- **No remote code, no third-party scripts** in the extension or on the website (the CSP blocks them; the Buy Me a Coffee buttons are plain CSS, not their widget).
- **New or changed store adapter:** run `python3 tools/sync_manifest.py` (permissions come from `stores.json`; CI fails if it warns or the manifest is out of date), add the `<script>` to `sidepanel.html`, mark it `experimental` in `stores.json` until an available and a not-deliverable answer have both been seen, and update the README's Stores table.
- **Strings with `\u` escapes:** the Edit and Write tools can turn them into literal invisible characters; write such strings with a Python script.
- **Planning:** `ROADMAP.md` is the one roadmap (committed). Keep it updated as PRs open and merge.
- **Code graph:** `graphify-out/` (git-ignored) holds a graph of the repo; query it (`graphify query "…"`) before reading lots of code, and run `graphify update .` after merged changes. It can't follow adapters calling `root.Adapters.register`, so it shows them unlinked from `adapters.js`; they aren't.
