#!/usr/bin/env python3
"""Semantic checks that JSON Schema cannot express (see FORMAT.md, "Rules").

Usage: python3 scripts/check_extra.py [path/to/extra-cards.json]
Exit code 0 when valid, 1 (with one message per line) otherwise.
"""
import json
import os
import sys

path = sys.argv[1] if len(sys.argv) > 1 else "catalog/extra-cards.json"
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
errors = []

with open(os.path.join(root, path) if not os.path.isabs(path) else path, encoding="utf-8") as f:
    doc = json.load(f)

set_ids = set()
for s in doc.get("sets", []):
    key = (s["lang"], s["id"])
    if key in set_ids:
        errors.append(f"duplicate set {s['lang']}/{s['id']}")
    set_ids.add(key)
    logo = s.get("logo")
    if logo:
        expected = f"catalog/images/{s['lang']}/sets/{s['id']}/logo.webp"
        if logo != expected:
            errors.append(f"set {s['id']}: logo must be {expected}")
        if not os.path.isfile(os.path.join(root, logo)):
            errors.append(f"set {s['id']}: missing file {logo}")

card_ids = set()
local_ids = set()
for c in doc.get("cards", []):
    cid = c["id"]
    if cid in card_ids:
        errors.append(f"duplicate card id {cid}")
    card_ids.add(cid)
    lk = (c["lang"], c["setId"], c["localId"])
    if lk in local_ids:
        errors.append(f"card {cid}: localId {c['localId']} already used in {c['lang']}/{c['setId']}")
    local_ids.add(lk)
    if c["setId"].startswith("x-") and (c["lang"], c["setId"]) not in set_ids:
        errors.append(f"card {cid}: set {c['setId']} ({c['lang']}) is not declared in \"sets\"")
    for side in ("front", "back"):
        img = (c.get("images") or {}).get(side)
        if not img:
            continue
        expected = f"catalog/images/{c['lang']}/{cid}/{side}.webp"
        if img != expected:
            errors.append(f"card {cid}: images.{side} must be {expected}")
        if not os.path.isfile(os.path.join(root, img)):
            errors.append(f"card {cid}: missing file {img}")

for e in errors:
    print("ERROR:", e)
print(f"{len(doc.get('sets', []))} sets, {len(doc.get('cards', []))} cards, {len(errors)} errors")
sys.exit(1 if errors else 0)
