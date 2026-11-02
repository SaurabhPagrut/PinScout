// Builds the extension, one folder per browser: dist/<browser>/pinscout-<browser>-<version>/ (unpacked) and, for the
// stores that take one, dist/<browser>/pinscout-<browser>-<version>.zip. Older versions' zips are kept next to it, so
// dist/<browser>/ is the version history for that store; only this version's folder and zip are replaced.
// dist/README.md says which zip goes where. No bundler, no minifying: the stores get the readable source.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const base = JSON.parse(readFileSync("extension/manifest.json", "utf8")), V = base.version;
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
if (pkg.version !== V) throw new Error(`package.json is ${pkg.version} but extension/manifest.json is ${V}; make them match`);

function copy(out, man) {
  rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });
  cpSync("extension", out, { recursive: true, filter: src => !/(^|\/)\.DS_Store$/.test(src) });
  writeFileSync(`${out}/manifest.json`, JSON.stringify(man, null, 2) + "\n");
}
function zip(dir, name) {
  const z = `${dir}/${name}.zip`; rmSync(z, { force: true });
  execFileSync("zip", ["-qr", "-X", `../${name}.zip`, "."], { cwd: `${dir}/${name}` });
  if (!existsSync(z)) throw new Error("zip failed"); return z;
}
// Browsers without Chrome's side panel: drop the side-panel keys. background.js already opens the panel page in a
// window of its own when chrome.sidePanel is missing.
function noSidePanel(m) {
  const { minimum_chrome_version, side_panel, ...man } = m;
  man.permissions = man.permissions.filter(p => p !== "sidePanel");
  return man;
}
// Firefox: a background script instead of a service worker, an add-on id, and the built-in data consent (required for
// new add-ons since November 2025; Firefox for Android has it from 142, so its minimum is set too, or AMO warns).
// "none": PinScout sends nothing to the developer or anyone else; the delivery checks go to the store the user is on.
function firefox(m) {
  const man = noSidePanel(m);
  man.name = "PinScout: Out of Stock & Pincode Finder"; // AMO allows 45 characters; the Chrome name is longer
  man.background = { scripts: ["background.js"] };
  man.browser_specific_settings = {
    gecko: { id: "pinscout@saurabhpagrut.in", strict_min_version: "140.0", data_collection_permissions: { required: ["none"] } },
    gecko_android: { strict_min_version: "142.0" }
  };
  return man;
}

const BROWSERS = [
  ["chrome", m => m, true], ["edge", m => m, true], ["opera", noSidePanel, true],
  ["firefox", firefox, true], ["safari", noSidePanel, false]
];
const made = [];
for (const [b, adapt, zipped] of BROWSERS) {
  const dir = `dist/${b}`, name = `pinscout-${b}-${V}`;
  mkdirSync(dir, { recursive: true });
  copy(`${dir}/${name}`, adapt(structuredClone(base)));
  made.push(zipped ? zip(dir, name) : `${dir}/${name}/`);
  // keep older zips, but not older unpacked folders (they are only for trying a build locally)
  for (const f of readdirSync(dir)) if (f !== name && !f.endsWith(".zip")) rmSync(`${dir}/${f}`, { recursive: true, force: true });
}

const history = b => readdirSync(`dist/${b}`).filter(f => f.endsWith(".zip")).sort().join(", ") || "(none)";
writeFileSync("dist/README.md", `# PinScout ${V}: one folder per browser

Built by \`npm run build\` from \`extension/\`. Each folder holds this version unpacked (to try it locally) and the zip
to upload. Zips of earlier versions stay in the same folder.

| Folder | Upload this | Where | Notes |
| --- | --- | --- | --- |
| \`chrome/\` | \`pinscout-chrome-${V}.zip\` | https://chrome.google.com/webstore/devconsole | Live on the Chrome Web Store. Also what Brave, Vivaldi, Arc and Yandex users install |
| \`edge/\` | \`pinscout-edge-${V}.zip\` | https://partner.microsoft.com/dashboard/microsoftedge | Same files as Chrome (Edge has the side panel) |
| \`opera/\` | \`pinscout-opera-${V}.zip\` | https://addons.opera.com/developer/ | No side panel keys; the toolbar icon opens PinScout in its own window. Opera users can also install from the Chrome Web Store |
| \`firefox/\` | \`pinscout-firefox-${V}.zip\` | https://addons.mozilla.org/developers/ | Background script instead of a service worker, add-on id \`pinscout@saurabhpagrut.in\`, shorter name (45-character limit), "no data collected" declared; Firefox 140+. Opens in its own window. Try it in Firefox before submitting |
| \`safari/\` | (no zip) | App Store Connect, inside a Mac app | Needs Xcode and the Apple Developer Program: \`xcrun safari-web-extension-converter dist/safari/pinscout-safari-${V} --app-name PinScout --bundle-identifier in.saurabhpagrut.pinscout\`, then build, sign and submit from Xcode |

Try one locally: Chrome/Edge/Opera → extensions page → Developer mode → Load unpacked → the \`pinscout-<browser>-${V}\` folder.
Firefox → \`about:debugging#/runtime/this-firefox\` → Load Temporary Add-on → its \`manifest.json\`.

## Versions here

${BROWSERS.filter(b => b[2]).map(([b]) => `- ${b}: ${history(b)}`).join("\n")}
`);
console.log(made.join("\n") + "\ndist/README.md");
