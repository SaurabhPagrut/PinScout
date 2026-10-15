#!/usr/bin/env python3
"""
Build extension/data/pincodes.json from the India Post "All India Pincode
Directory" CSV (data.gov.in).

Usage:
    python3 tools/build_pincodes.py path/to/AllIndiaPinCodes.csv

The CSV has one row per post office, so a pincode appears many times, and
some pincodes span several districts (or, rarely, states). This script
collapses it to one entry per pincode:

    {"p":"560028","d":"Bengaluru Urban","s":"Karnataka","lat":12.93,"lng":77.57,"m":1}

  - state / district : weighted majority across the pincode's offices
                       (head office counts most, then sub office, then branch)
  - lat / lng        : MEDIAN of the valid coordinates; dropped if >150 km from the
                       centre of its own district (bad source data)
  - m (major)        : 2 = big city listed in pincodes.seed.json,
                       1 = pincode of a Head Post Office (a district hub)
  - missing state    : inferred from neighbouring pincodes (same 3-, then 2-digit prefix)

Column names are matched loosely, so other releases of the file also work.
"""
import csv
import json
import math
import statistics
import sys
from collections import Counter, defaultdict
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "extension" / "data" / "pincodes.json"
SEED = OUT.with_name("pincodes.seed.json")  # starter list shipped with the extension

ALIASES = {
    "pin": ["pincode", "pin", "pin_code"],
    "district": ["district", "districtname", "district_name"],
    "state": ["state", "statename", "state_name"],
    "lat": ["latitude", "lat"],
    "lng": ["longitude", "lng", "long"],
    "office": ["officetype", "office_type"],
}
OFFICE_WEIGHT = {"HO": 5, "PO": 2, "BO": 1}


def pick(header, names):
    lowered = {h.strip().lower(): h for h in header}
    for n in names:
        if n in lowered:
            return lowered[n]
    return None


def num(v, lo, hi):
    try:
        x = float(str(v).strip())
    except (TypeError, ValueError):
        return None
    return x if lo <= x <= hi else None  # India bounding box; drops NA / junk / 0,0


MAX_KM_FROM_DISTRICT_CENTRE = 150  # farther than this = almost certainly a bad coordinate


def haversine_km(lat1, lng1, lat2, lng2):
    r = math.pi / 180
    a = (math.sin((lat2 - lat1) * r / 2) ** 2 +
         math.cos(lat1 * r) * math.cos(lat2 * r) * math.sin((lng2 - lng1) * r / 2) ** 2)
    return 12742 * math.asin(math.sqrt(a))


SMALL = {"and", "of"}


def title(s):
    s = (s or "").strip()
    if not s or s.upper() in {"NA", "N/A", "NAN", "NULL", "NONE"}:
        return ""
    words = [w.capitalize() if w.lower() not in SMALL else w.lower() for w in s.split()]
    out = " ".join(words)
    return out[4:] if out.lower().startswith("the ") else out  # "The Dadra and ..." -> "Dadra and ..."


def weighted_mode(pairs):
    """pairs: [(value, weight)] -> most heavily weighted non-empty value."""
    c = Counter()
    for v, w in pairs:
        if v:
            c[v] += w
    return c.most_common(1)[0][0] if c else ""


def main(csv_path):
    with open(csv_path, newline="", encoding="utf-8-sig", errors="replace") as f:
        reader = csv.DictReader(f)
        cols = {k: pick(reader.fieldnames, v) for k, v in ALIASES.items()}
        missing = [k for k in ("pin", "district", "state") if not cols[k]]
        if missing:
            sys.exit(f"Could not find columns for: {missing}. Headers seen: {reader.fieldnames}")

        groups = defaultdict(list)
        n_rows = 0
        for row in reader:
            n_rows += 1
            pin = (row[cols["pin"]] or "").strip()
            if pin.isdigit() and len(pin) == 6:
                groups[pin].append(row)

    seed_majors = set()
    if SEED.exists():
        try:
            seed_majors = {e["p"] for e in json.loads(SEED.read_text()) if e.get("m")}
        except Exception:
            pass

    out, multi_state, multi_district = {}, 0, 0
    for pin in sorted(groups):
        rows = groups[pin]
        w = [OFFICE_WEIGHT.get((r.get(cols["office"]) or "").strip().upper(), 1) if cols["office"] else 1 for r in rows]
        states = [title(r[cols["state"]]) for r in rows]
        state = weighted_mode(zip(states, w))
        if len({s for s in states if s}) > 1:
            multi_state += 1
        districts = [title(r[cols["district"]]) if states[i] == state else "" for i, r in enumerate(rows)]
        district = weighted_mode(zip(districts, w))
        if len({d for d in districts if d}) > 1:
            multi_district += 1

        entry = {"p": pin, "d": district, "s": state}

        if cols["lat"] and cols["lng"]:
            pts = [(num(r[cols["lat"]], 6, 38), num(r[cols["lng"]], 68, 98)) for r in rows]
            pts = [(a, b) for a, b in pts if a is not None and b is not None]
            if pts:
                entry["lat"] = round(statistics.median(a for a, _ in pts), 4)
                entry["lng"] = round(statistics.median(b for _, b in pts), 4)

        if pin in seed_majors:
            entry["m"] = 2
        elif cols["office"] and any((r.get(cols["office"]) or "").strip().upper() == "HO" for r in rows):
            entry["m"] = 1
        out[pin] = entry

    # Drop coordinates that sit far from the rest of their own district. The source
    # file has ~2% of pincodes with coordinates in the wrong place, which would put
    # e.g. a Koppal pincode "9 km" from Bengaluru.
    by_district = defaultdict(list)
    for e in out.values():
        if "lat" in e and e["d"]:
            by_district[(e["s"], e["d"])].append(e)
    dropped = 0
    for members in by_district.values():
        if len(members) < 3:
            continue
        c_lat = statistics.median(m["lat"] for m in members)
        c_lng = statistics.median(m["lng"] for m in members)
        for m in members:
            if haversine_km(c_lat, c_lng, m["lat"], m["lng"]) > MAX_KM_FROM_DISTRICT_CENTRE:
                del m["lat"], m["lng"]
                dropped += 1

    # Fill missing states from neighbouring pincodes (same 3-digit, then 2-digit prefix).
    by_prefix = {n: defaultdict(Counter) for n in (3, 2)}
    for e in out.values():
        if e["s"]:
            for n in (3, 2):
                by_prefix[n][e["p"][:n]][e["s"]] += 1
    inferred = 0
    for e in out.values():
        if not e["s"]:
            for n in (3, 2):
                c = by_prefix[n].get(e["p"][:n])
                if c:
                    e["s"] = c.most_common(1)[0][0]
                    inferred += 1
                    break

    data = list(out.values())
    OUT.write_text(json.dumps(data, separators=(",", ":")))

    states = {e["s"] for e in data if e["s"]}
    with_geo = sum(1 for e in data if "lat" in e)
    print(f"Read {n_rows:,} rows -> wrote {len(data):,} unique pincodes -> {OUT}")
    print(f"States/UTs covered: {len(states)}")
    print(f"With coordinates: {with_geo:,} ({100 * with_geo // max(len(data), 1)}%); "
          f"dropped {dropped} implausible ones")
    print(f"Major flags: {sum(1 for e in data if e.get('m') == 2)} big-city, "
          f"{sum(1 for e in data if e.get('m') == 1)} head-office")
    print(f"Pincodes spanning >1 district: {multi_district:,} (majority district used); "
          f">1 state: {multi_state} (majority state used); state inferred: {inferred}")
    if len(data) < 15000 or len(states) < 30:
        print("WARNING: this looks like a partial file (expected roughly 19,000 "
              "pincodes and 35+ states/UTs for all of India). Did you download "
              "a single-circle file?")
    if with_geo < len(data) * 0.5:
        print("Note: fewer than half the pincodes have usable coordinates, so 'nearby' "
              "will rely mostly on pincode prefix rather than distance.")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
