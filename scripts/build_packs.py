#!/usr/bin/env python3
"""Builds one gzipped catalog pack per language from the TCGdex REST API (see PACKS.md).

Usage:
  python3 scripts/build_packs.py [--languages languages.json] [--out dist]
                                 [--previous previous-index.json] [--only-set ID] [--date YYYY-MM-DD]

Writes into --out: <lang>.json.gz for every language whose content changed, index.json (all languages),
changed.txt (languages to upload) and removed.txt (languages to delete from the release).
Exit code 0 on success, 1 on any error (nothing must be published then).
"""
import argparse
import concurrent.futures
import datetime
import gzip
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

API = "https://api.tcgdex.net/v2"
USER_AGENT = "justanothertcgapp-catalog-packs/1 (+https://github.com/mdainelli/justanothertcgapp-catalog)"
SCHEMA_VERSION = 1
CONCURRENCY = 8
RETRIES = 8
LANG_RE = re.compile(r"^[a-z]{2}(-[a-z]{2,4})?$")
# Fields dropped from card details: prices stay live in the app, `updated` would change the hash for no reason.
DROP_CARD_FIELDS = ("pricing", "updated")
RETRY_STATUS = {408, 425, 429, 500, 502, 503, 504}


class BuildError(Exception):
    pass


def http_get_json(url, retries=RETRIES, sleep=time.sleep, opener=urllib.request.urlopen):
    last = None
    for attempt in range(retries):
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
        try:
            with opener(req, timeout=60) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            last = f"HTTP {e.code}"
            if e.code not in RETRY_STATUS:
                raise BuildError(f"{url}: {last}")
        except (urllib.error.URLError, TimeoutError, ConnectionError, json.JSONDecodeError) as e:
            last = repr(e)
        sleep(min(2 ** attempt, 30) * 0.5)
    raise BuildError(f"{url}: giving up after {retries} attempts ({last})")


def load_languages(path):
    with open(path, encoding="utf-8") as f:
        doc = json.load(f)
    codes = []
    for entry in doc.get("languages", []):
        code = entry.get("code") if isinstance(entry, dict) else None
        if not isinstance(code, str) or not LANG_RE.match(code):
            raise BuildError(f"invalid language entry: {entry!r}")
        if code in codes:
            raise BuildError(f"duplicate language: {code}")
        codes.append(code)
    if not codes:
        raise BuildError("languages.json lists no languages")
    return codes


def clean_card(card):
    return {k: v for k, v in card.items() if k not in DROP_CARD_FIELDS}


def canonical(obj):
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def fetch_pack_content(lang, get=http_get_json, only_set=None, concurrency=CONCURRENCY, log=print):
    """Returns the pack content dict: sets (full set documents, card lists inside) and cards (full details)."""
    set_list = get(f"{API}/{lang}/sets")
    ids = sorted(s["id"] for s in set_list)
    if only_set:
        ids = [i for i in ids if i == only_set]
    if not ids:
        raise BuildError(f"{lang}: no sets")
    with concurrent.futures.ThreadPoolExecutor(concurrency) as pool:
        sets = list(pool.map(lambda i: get(f"{API}/{lang}/sets/{i}"), ids))
        card_ids = sorted({c["id"] for s in sets for c in s.get("cards", [])})
        log(f"{lang}: {len(sets)} sets, {len(card_ids)} cards")
        cards = list(pool.map(lambda i: clean_card(get(f"{API}/{lang}/cards/{i}")), card_ids))
    return {"schemaVersion": SCHEMA_VERSION, "lang": lang, "sets": sets, "cards": cards}


def build_pack(content, date):
    """Returns (gz_bytes, index_entry). The gzip is deterministic (mtime 0) for a given content."""
    raw = canonical(content)
    gz = gzip.compress(raw, 9, mtime=0)
    lang = content["lang"]
    entry = {
        "lang": lang,
        "file": f"{lang}.json.gz",
        "schemaVersion": SCHEMA_VERSION,
        "version": date,
        "date": date,
        "contentHash": hashlib.sha256(raw).hexdigest(),
        "sha256": hashlib.sha256(gz).hexdigest(),
        "size": len(gz),
        "uncompressedSize": len(raw),
        "setCount": len(content["sets"]),
        "cardCount": len(content["cards"]),
    }
    return gz, entry


def check_not_shrunk(entry, prev):
    if prev and entry["cardCount"] < prev.get("cardCount", 0) * 0.5:
        raise BuildError(f"{entry['lang']}: card count dropped from {prev['cardCount']} to {entry['cardCount']}, refusing")


def run(codes, out, previous, date, fetch, log=print):
    """Core logic, network-free given `fetch(lang) -> content`. Returns the index."""
    os.makedirs(out, exist_ok=True)
    prev_by_lang = {e["lang"]: e for e in (previous or {}).get("packs", [])}
    packs, changed = [], []
    for lang in codes:
        content = fetch(lang)
        gz, entry = build_pack(content, date)
        prev = prev_by_lang.get(lang)
        if prev and prev.get("contentHash") == entry["contentHash"] and prev.get("schemaVersion") == SCHEMA_VERSION:
            log(f"{lang}: unchanged ({prev['version']})")
            packs.append(prev)
            continue
        check_not_shrunk(entry, prev)
        with open(os.path.join(out, entry["file"]), "wb") as f:
            f.write(gz)
        log(f"{lang}: changed -> version {date}, {entry['size']} bytes")
        packs.append(entry)
        changed.append(lang)
    removed = sorted(set(prev_by_lang) - set(codes))
    index = {"schemaVersion": SCHEMA_VERSION, "generated": date, "packs": packs}
    with open(os.path.join(out, "index.json"), "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=2)
        f.write("\n")
    with open(os.path.join(out, "changed.txt"), "w") as f:
        f.write("".join(f"{c}\n" for c in changed))
    with open(os.path.join(out, "removed.txt"), "w") as f:
        f.write("".join(f"{c}\n" for c in removed))
    return index


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--languages", default="languages.json")
    ap.add_argument("--out", default="dist")
    ap.add_argument("--previous")
    ap.add_argument("--only-set", help="debug: restrict to one set id (never publish the result)")
    ap.add_argument("--date", default=datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d"))
    args = ap.parse_args(argv)
    previous = None
    if args.previous and os.path.exists(args.previous):
        with open(args.previous, encoding="utf-8") as f:
            previous = json.load(f)
    try:
        codes = load_languages(args.languages)
        run(codes, args.out, previous, args.date, lambda lang: fetch_pack_content(lang, only_set=args.only_set))
    except BuildError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
