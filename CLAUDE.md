# PinScout

A browser extension that finds where a product can be delivered in India: it checks the user's pincode, then nearby
pincodes, the rest of their state and the rest of India, using the store's own delivery check from inside the product
page, and stops at the first place it's available. Live on the Chrome Web Store; website at
https://pinscout.saurabhpagrut.in (Cloudflare Pages project `pinscouts`).

**Before any work, load the `pinscout-dev` skill** (`.claude/skills/pinscout-dev/SKILL.md`): the fast commands for tests,
the browser and scan plans, and the owner's house rules. The rules the extension keeps are in `EXTENSION_GUIDELINES.md`.

## Files

| Path | What it is |
| --- | --- |
| `extension/` | The extension (Manifest V3, plain JavaScript): `manifest.json`, `background.js`, `sidepanel.html/.js` |
| `extension/lib/planner.js` | Builds the search tiers from the pincode dataset (pure logic) |
| `extension/lib/scanner.js` | Runs the scan loop and its stop rules (pure logic) |
| `extension/lib/stores.js`, `adapters.js` | The store catalogue lookup, and the adapter registry with the shared verdicts |
| `extension/lib/stores/<id>.js` | One adapter per store; its `pageCheck` runs inside the store's page |
| `extension/lib/recorder*.js` | "Help add a new store": records how a store checks delivery, with personal data masked |
| `extension/data/` | `stores.json` (the store catalogue), `pincodes.json` (India Post, 19,586 pincodes) |
| `tests/` | `run.js` (the runner), `*.test.js`, `adapter-harness.js`, `fixtures/<store>/` (saved store answers) |
| `scripts/` | `build.mjs` (every browser), `site.mjs` (website), `lint.mjs`, `plan.js`, `browse.js` |
| `tools/` | `sync_manifest.py`, `build_pincodes.py`, `make-fixture.js`, `probe-page-state.js` |
| `site/` | The website (Cloudflare Pages): landing page with the "Try the search plan" demo (`demo.js`, running the extension's `planner.js`), `about.md`; `PRIVACY.md` becomes its privacy page |
| `webstore/` | Chrome Web Store texts, privacy-tab answers and listing images |
| `ROADMAP.md` | The one roadmap: phases, decisions, open questions. Keep it updated as PRs open and merge |
| `CHANGELOG.md` | What changed in each version |
| `PUBLISHING.md` | Website setup, building a release, the stores |
