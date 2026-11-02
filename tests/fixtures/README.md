# Adapter fixtures

Each `<store>/<case>.json` is one answer from a store's delivery check, and what PinScout should conclude from it.
`tests/adapters.test.js` runs the real adapter on every file here, offline, on every PR. When a store changes its
answer and the adapter misreads it, add that answer here: the test fails until the adapter is fixed, and then it can't
quietly break the same way again.

`"source"` says where a file came from: **recorded** (a real answer, masked) or **synthetic** (written by hand from
what the adapter reads; replace these with recordings when you can).

## Adding a real answer

1. Open a product page on the store, signed out if you can. Open DevTools → **Network**, and tick **Preserve log**.
2. Use the store's own pincode box: type a pincode and press Check.
3. Find the request that carries the pincode (filter by it, e.g. `560001`). For Flipkart it is `page/fetch` on a
   `*.rome.api.flipkart.com` host. Click it → **Response** → right-click → **Copy response**, and paste it into a file,
   e.g. `~/Downloads/fk-560001.json`. Note what the store's page said: deliverable (and the date), or not.
4. Turn it into a fixture:

   ```
   node tools/make-fixture.js flipkart available-560001 --response ~/Downloads/fk-560001.json \
     --url "<the product page URL>" --pincode 560001 --expect available --sla "Delivery by Tue, 4 Nov"
   ```

   It masks names, addresses, phone numbers, emails and tokens with the recorder's own rules (without shortening
   anything), writes the file, and runs the adapter on it: `ok` when the adapter agrees with the store's page, `FAIL`
   when it doesn't (a bug to fix, or a wrong `--expect`).
5. Skim the file for anything personal, then commit it in a PR. For a store's first two recorded answers (one
   available, one not deliverable), remove it from `PENDING` in `tests/adapters.test.js` and, if it was experimental,
   consider marking it working in `extension/data/stores.json`.

HTML answers (Amazon reads the product page) aren't converted automatically, because pages can hold names and saved
addresses: cut such an answer down to the part the adapter reads, by hand.
