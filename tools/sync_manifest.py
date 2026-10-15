#!/usr/bin/env python3
"""
Keep extension/manifest.json in step with extension/data/stores.json.

    python3 tools/sync_manifest.py

- host_permissions = one "https://*.<host>/*" pattern per host of every store
  that has an adapter (lib/stores/<id>.js), so PinScout can read the store's page
  for a scan. Catalogue-only stores are left out to keep the install prompt (and
  the Chrome Web Store review) limited to sites PinScout actually checks.
- optional_host_permissions = any https site; used only when the user presses
  "Allow access" for a store that has no adapter yet (Chrome then shows
  its own permission prompt for that one site).

Also warns if a store has an adapter file (lib/stores/<id>.js) that
sidepanel.html doesn't load, or an adapter file for an id that isn't in the catalogue.
"""
import json
import re
from pathlib import Path

EXT = Path(__file__).resolve().parent.parent / "extension"
stores = json.loads((EXT / "data" / "stores.json").read_text())

problems = []
ids = set()
for s in stores:
    if not re.fullmatch(r"[a-z0-9]+", s.get("id", "")):
        problems.append(f"bad id: {s!r}")
    if s.get("id") in ids:
        problems.append(f"duplicate id: {s['id']}")
    ids.add(s.get("id"))
    if not s.get("name") or not s.get("hosts"):
        problems.append(f"store {s.get('id')} needs a name and at least one host")
    for h in s.get("hosts", []):
        if not re.fullmatch(r"[a-z0-9-]+(\.[a-z0-9-]+)+", h):
            problems.append(f"{s['id']}: host must be a bare domain like example.in, got {h!r}")
if problems:
    raise SystemExit("stores.json problems:\n  " + "\n  ".join(problems))

adapter_ids = {p.stem for p in (EXT / "lib" / "stores").glob("*.js")}
hosts = sorted({f"https://*.{h}/*" for s in stores if s["id"] in adapter_ids for h in s["hosts"]})

path = EXT / "manifest.json"
m = json.loads(path.read_text())
m["permissions"] = ["scripting", "storage", "sidePanel"]
m["host_permissions"] = hosts
m["optional_host_permissions"] = ["https://*/*"]
path.write_text(json.dumps(m, indent=2, ensure_ascii=False) + "\n")
print(f"manifest.json: {len(hosts)} store site patterns")

html = (EXT / "sidepanel.html").read_text()
files = {p.stem for p in (EXT / "lib" / "stores").glob("*.js")}
for f in sorted(files - ids):
    print(f"WARNING: lib/stores/{f}.js has no entry in data/stores.json")
for f in sorted(files):
    if f"lib/stores/{f}.js" not in html:
        print(f"WARNING: sidepanel.html does not load lib/stores/{f}.js")
print("adapters present:", ", ".join(sorted(files & ids)) or "none")
print("catalogue only (recordable, no adapter yet):", ", ".join(sorted(ids - files)) or "none")
