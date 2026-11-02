# Add a store to PinScout

Every store checks delivery in its own way, with its own private request. To support a new store, PinScout needs one example of that request: what the store's page sends when you change the delivery pincode, and what comes back. You can record one in about a minute, from the PinScout panel, without any technical knowledge.

## What you need

- PinScout installed (Chrome, Edge, Brave or another browser that installs from the Chrome Web Store).
- A product page on the store you want, with a box where you can change the delivery pincode.
- A pincode to try. Any real one works; your own is fine.

## Record it

- **1. Open the product page** on the store you want added.
- **2. Open the PinScout panel** (click the PinScout icon) and open **Help add a new store** at the bottom.
- **3. Type a pincode and press Start.** PinScout reloads the store's page once, so the recorder is in place before the store's own code runs.
- **4. Allow access, if asked.** PinScout can only see the six stores it already supports. On any other site it says it doesn't have access yet and fills in the site's address (for example `tatacliq.com`): check it, press **Allow access**, accept the browser's question (for that one site only), then press **Start** again.
- **5. Change the delivery pincode on the store's page** to that same number, the way you normally would: open the store's pincode box, type it and press Check or Apply. It's fine if the page reloads or takes you to another page.
- **6. Press Stop & copy**, then **Send by email** and paste the recording into the email. Or paste it into any email to getsaurabhpagrut@gmail.com.

The recorder switches itself off after 10 minutes, and nothing is sent anywhere unless you send that email yourself.

## What's in a recording

Only what the store's page did while you changed the pincode: the requests that carried your pincode and the store's answers, a short list of the other calls the page made, and your clicks and typing on the page (the text you type is not kept, except a value with the pincode in it; passwords never).

Before anything is shown to you, the recorder masks cookies, tokens, session values, signatures, addresses, names, phone numbers and e-mail addresses. Whole HTML pages are never kept, only their size, because they can hold a saved address. Masking is careful but not perfect: if you are signed in to the store, skim the recording before you send it, or record while signed out.

## What happens next

The recording shows how the store checks a pincode. If that check can be repeated for other pincodes (some stores sign every request, which makes that much harder), PinScout gets a new store adapter. It starts as **experimental** and becomes **working** once both a deliverable and a not-deliverable answer have been seen. Each new store also needs its own permission, so it arrives in an update of the extension.

Stores already asked for and not built yet: JioMart, Zepto and Swiggy Instamart. They sign every request, so they need a different approach; a recording still helps.

PinScout is an independent tool and is not affiliated with any store.
