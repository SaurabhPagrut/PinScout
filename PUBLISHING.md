# Publishing PinScout

How to put out the website and a new version. Store-specific texts are in `webstore/` (Chrome:
`webstore/chrome-web-store-guide.md`).

## 1. The website on Cloudflare Pages

The site is `site/` plus `about.html` (from `site/about.md`) and `privacy.html` (from `PRIVACY.md`), built by
`npm run site` into `dist/site/`. Try it locally: `npm run site`, then `npx --yes serve dist/site` and open the address
it prints.

1. https://dash.cloudflare.com → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**. Authorise GitHub and
   pick `SaurabhPagrut/PinScout` (it works while the repo is private).
2. Set up the build:

   | Setting | Value |
   | --- | --- |
   | Project name | `pinscout` (gives https://pinscout.pages.dev) |
   | Production branch | `main` |
   | Framework preset | None |
   | Build command | `npm run site` |
   | Build output directory | `dist/site` |
   | Root directory | (empty) |
   | Environment variables | `NODE_VERSION` = `22` |

3. **Save and Deploy**. Check https://pinscout.pages.dev, https://pinscout.pages.dev/about and
   https://pinscout.pages.dev/privacy.
4. Custom domain, when you're ready: the project → **Custom domains** → **Set up a custom domain** →
   `pinscout.saurabhpagrut.in`.
   - If `saurabhpagrut.in` is a zone in this Cloudflare account (as for Bracel), Cloudflare adds the DNS record itself.
   - If its DNS is elsewhere, add `CNAME`, name `pinscout`, target `pinscout.pages.dev` there.
   - Add the domain in the Pages project first: a CNAME alone gives a 522 error.
5. Once https://pinscout.saurabhpagrut.in/privacy loads over HTTPS, update the privacy policy, homepage and support URLs
   in the Chrome dashboard (`webstore/store-listing.md`), and the link in the panel footer
   (`extension/sidepanel.html`) in the next release.

Every push to `main` redeploys; other branches get a preview at `<branch>.pinscout.pages.dev`.

## 2. Building a release

1. Raise the version in **both** `extension/manifest.json` and `package.json` (the build refuses if they differ).
2. `npm test`, then `npm run build`. It writes `dist/<browser>/pinscout-<browser>-<version>.zip` for Chrome, Edge,
   Opera and Firefox, the unpacked Safari folder, and `dist/README.md` (which zip goes where). Zips of earlier versions
   stay in their folder.
3. `npm run lint:firefox`: 0 errors. The warnings about `sidePanel` are expected; the code checks for it first.
4. Load the unpacked folder in the browser and run one scan before uploading.
5. Add the version to section 5 of `webstore/chrome-web-store-guide.md`.

`dist/` is not committed (`.gitignore`); it lives on this machine.

## 3. The stores

| Store | Account | Status |
| --- | --- | --- |
| Chrome Web Store | done | Live: https://chromewebstore.google.com/detail/pinscout-pincode-delivery/oicfbaoamapgdhailjaaokgkdolalbco |
| Microsoft Edge Add-ons | Microsoft Partner Center (free) | Not submitted. Upload `dist/edge/…zip` |
| Firefox Add-ons (AMO) | Firefox account (free) | Not submitted. Upload `dist/firefox/…zip`. On AMO's listing, set the **Contributions URL** to https://buymeacoffee.com/saurabhpagrut |
| Opera add-ons | Opera account (free) | Not submitted. Upload `dist/opera/…zip` |
| Safari | Apple Developer Program (US$99 a year) | Later. See `dist/README.md` |

Brave, Vivaldi, Arc and Yandex install from the Chrome Web Store.
