// Builds the website (https://pinscout.saurabhpagrut.in, served by the Cloudflare Pages project pinscouts) into dist/site/:
// site/index.html with the store list from extension/data/stores.json, about.html from site/about.md, add-a-store.html
// from site/add-a-store.md (the guide to recording a new store), privacy.html
// from PRIVACY.md (one source for the policy), a 404 page, the icons and listing images.
// Cloudflare Pages: build command "npm run site", output directory "dist/site".
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const STORE_URL = "https://chromewebstore.google.com/detail/pinscout-pincode-delivery/oicfbaoamapgdhailjaaokgkdolalbco";
const COFFEE_URL = "https://buymeacoffee.com/saurabhpagrut";
const out = "dist/site";
rmSync(out, { recursive: true, force: true }); mkdirSync(`${out}/img`, { recursive: true });
for (const f of ["site.css", "_headers"]) cpSync(`site/${f}`, `${out}/${f}`);
/* the "Try the search plan" box: the extension's own planner and dataset, unchanged */
mkdirSync(`${out}/js`); mkdirSync(`${out}/data`);
cpSync("site/demo.js", `${out}/js/demo.js`); cpSync("extension/lib/planner.js", `${out}/js/planner.js`);
cpSync("extension/data/pincodes.json", `${out}/data/pincodes.json`);
for (const s of [32, 128]) cpSync(`extension/icons/icon${s}.png`, `${out}/img/icon${s}.png`);
cpSync("webstore/listing-images/screenshot-1-find-where-it-is-available.png", `${out}/img/screenshot-1.png`);
cpSync("webstore/listing-images/small-promo-tile-440x280.png", `${out}/img/promo.png`);

const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// The store list: working, experimental (flag in stores.json) or planned (no adapter file yet)
const stores = JSON.parse(readFileSync("extension/data/stores.json", "utf8"));
const status = s => !existsSync(`extension/lib/stores/${s.id}.js`) ? "planned" : s.experimental ? "experimental" : "working";
const order = { working: 0, experimental: 1, planned: 2 };
const list = "<ul>" + stores.map(s => [s, status(s)]).sort((a, b) => order[a[1]] - order[b[1]])
  .map(([s, st]) => `<li><span>${esc(s.name)}</span><span class="tag ${st}">${st[0].toUpperCase() + st.slice(1)}</span></li>`).join("") + "</ul>";

const fill = h => h.replaceAll("{{STORE_URL}}", STORE_URL).replaceAll("{{COFFEE_URL}}", COFFEE_URL).replace("{{STORES}}", list);
const index = fill(readFileSync("site/index.html", "utf8"));
writeFileSync(`${out}/index.html`, index);

// Just enough Markdown for PRIVACY.md and about.md: headings, paragraphs, "- " lists, **bold**, *italic*, `code`, bare links
const inline = s => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/\*([^*]+)\*/g, "<em>$1</em>")
  .replace(/https:\/\/[^\s<)]+[^\s<).,]/g, u => `<a href="${u}">${u.replace(/^https:\/\//, "").replace(/\/$/, "")}</a>`)
  .replace(/[\w.+-]+@[\w-]+\.[\w.]+[\w]/g, m => `<a href="mailto:${m}">${m}</a>`);
function md(text) {
  return text.trim().split(/\n\s*\n/).map(block => {
    const h = /^(#{1,3}) (.*)/.exec(block);
    if (h) return `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`;
    if (/^- /.test(block)) return "<ul>" + block.split(/\n(?=- )/).map(i => `<li>${inline(i.slice(2).replace(/\n\s*/g, " "))}</li>`).join("") + "</ul>";
    return `<p>${inline(block.replace(/\n/g, " "))}</p>`;
  }).join("\n");
}

// Inner pages share the landing page's header and footer
const part = (a, b) => index.slice(index.indexOf(a), index.indexOf(b) + b.length);
const page = (title, desc, body) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<meta name="description" content="${desc}">
<link rel="icon" href="/img/icon32.png">
<link rel="stylesheet" href="/site.css">
</head>
<body>
${part('<header class="top">', "</div></header>")}

<main class="wrap doc">
${body}
</main>

${part("<footer>", "</div></footer>")}
</body>
</html>
`;
writeFileSync(`${out}/privacy.html`, page("PinScout privacy policy", "PinScout has no server and collects nothing. What it stores on your device, where delivery checks go, and why it asks for each permission.", md(readFileSync("PRIVACY.md", "utf8"))));
writeFileSync(`${out}/about.html`, page("About PinScout", "Who makes PinScout, why, and how to get in touch.", md(readFileSync("site/about.md", "utf8"))));
writeFileSync(`${out}/add-a-store.html`, page("Add a store to PinScout", "Record how a shopping site checks delivery, in about a minute, so PinScout can support it. Personal details are masked.", md(readFileSync("site/add-a-store.md", "utf8"))));
writeFileSync(`${out}/404.html`, page("Not found · PinScout", "This page does not exist.", '<h1>Not deliverable to this address</h1>\n<p>PinScout searched nearby and found no page here. <a href="/">Back home</a></p>'));
console.log(`${out}/`);
