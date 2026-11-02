# PinScout on the Chrome Web Store

Everything to paste into the Developer Dashboard. Upload file:
`dist/chrome/pinscout-chrome-<version>.zip`, made by `npm run build` (manifest.json is at the root of the zip, which the store requires).

## 1. What you must do in the dashboard

1. **Account**: in Settings, verify your contact email (the store blocks publishing until it is verified) and fill in the publisher name.
2. **Privacy policy URL**: https://pinscout.saurabhpagrut.in/privacy. It is built from `PRIVACY.md` by `npm run site`; see `PUBLISHING.md` §1.
3. **Package** tab of the existing PinScout item → **Upload new package** → `dist/chrome/pinscout-chrome-<version>.zip`.
4. **Store listing** tab: paste the texts in section 2, choose category and language, upload the icon, screenshots and small promo tile (section 4).
5. **Privacy** tab: paste the single purpose and each permission justification (section 3), tick the data-usage boxes as listed, tick the three certification boxes, paste the privacy policy URL.
6. **Distribution** tab: Public (or Unlisted if you want to test with a link first), regions: India (or all regions).
7. **Submit for review.** Expect a manual review because of the store host permissions and the optional "any site" permission; the justifications below are written for that.

## 2. Store listing

See `store-listing.md` (title, summary, description, category, language, images, global assets).

## 3. Privacy tab

**Single purpose**:
Check whether the product on the open shopping page can be delivered to a pincode, searching outward from the user's pincode to nearby areas, their state and the rest of India.

**Permission justifications**:

- **scripting**: PinScout runs a small script in the product page of a supported store to call that store's own delivery-check service for each pincode the user asked to scan, using the user's existing session. It also injects the optional "Help add a new store" recorder into the tab the user chooses, only after the user presses Start.
- **storage**: Saves the user's home pincode on the device so it is filled in next time, and on Amazon keeps the user's original delivery pincode until it has been restored after a scan.
- **sidePanel**: The interface runs in the side panel so a scan, which can check many pincodes, keeps running while the user interacts with the store page. A popup would close and stop the scan.
- **Host permissions (amazon.in, flipkart.com, myntra.com, croma.com, reliancedigital.in, blinkit.com)**: These are the stores PinScout supports. Access is needed to read the product on the open page and run that store's delivery check from inside the page. No other sites are accessed by default.
- **Optional host permission (https://\*/\*)**: Never granted at install. It is requested for one site at a time, through Chrome's own prompt, only when the user presses "Allow access" in the "Help add a new store" recorder on a store PinScout doesn't support yet, so the recorder can capture how that store checks delivery.
- **Remote code**: No, I am not using remote code. All scripts are included in the package.

**Data usage** (what to tick):
- Tick **Website content**: the extension reads the product and the delivery answer on the store page. (Required to be honest about the in-page checks and the recorder.)
- Leave everything else unticked (personally identifiable info, health, financial, authentication, personal communications, location, web history, user activity). The pincode the user types is sent only to the store they're on, as the store's own check box would.
- Tick all three certifications: not sold to third parties, not used for unrelated purposes, not used for creditworthiness or lending.

## 4. Images to make

| Asset | Size | Required | What to show |
|---|---|---|---|
| Store icon | 128×128 PNG | Yes | Use `extension/icons/icon128.png` |
| Screenshot 1 | 1280×800 PNG/JPEG | Yes (at least one) | A Flipkart or Amazon product page with the PinScout side panel open, pincode entered, ready to check |
| Screenshot 2 | 1280×800 | Recommended | A scan in progress: the log showing ✅/❌ results moving from your pincode to nearby |
| Screenshot 3 | 1280×800 | Recommended | A finished scan with the first available pincode found |
| Screenshot 4 | 1280×800 | Optional | Search options open (nearby count, all-India mode, tier checkboxes) |
| Screenshot 5 | 1280×800 | Optional | "Help add a new store" recorder after Stop, showing the masked summary and Send by email |
| Small promo tile | 440×280 PNG | Yes | Icon, "PinScout", and "Find where it can be delivered" |
| Marquee tile | 1400×560 | Optional | Only needed if the store features it |

Tips: set the Chrome window to 1280×800 before capturing (or capture larger and scale down to exactly 1280×800), hide your real name and address in the store header, and use a common product.

## 5. What changed in each build

See `CHANGELOG.md`. For a release, also paste its store-facing notes (permissions, privacy tab) into the dashboard.
