#!/usr/bin/env python3
"""Builds daily per-set gzipped price files from the TCGdex REST API (see PRICES.md).

Usage:
  python3 scripts/build_prices.py [--languages languages.json] [--out dist-prices]
                                  [--previous previous-prices-index.json] [--only-set ID] [--date YYYY-MM-DD]

Writes into --out: one <group>-<setId>.json.gz per (price group, set) and prices-index.json.
Exit code 0 on success, 1 on any error (nothing must be published then).
"""
import argparse
import concurrent.futures
import datetime
import gzip
import json
import os
import re
import sys

from build_packs import API, CONCURRENCY, BuildError, NotFound, canonical, http_get_json, load_languages, path_id

SCHEMA_VERSION = 1
# Asian catalogs have their own ids (they can collide with international ones, e.g. neo1), so each is its own group.
ASIAN = ("ja", "ko", "zh-tw", "zh-cn", "th", "id")
INTL = "intl"
MAX_FAIL_SHARE = 0.02
MIN_KEEP_SHARE = 0.5
DROP_KEYS = ("idProduct", "productId")
META_KEYS = ("updated", "unit")
SAFE_RE = re.compile(r"[^A-Za-z0-9._-]")


def clean_block(block):
    """Cleans a provider block (or a tcgplayer printing); returns None when no price number is left."""
    if not isinstance(block, dict):
        return None
    out = {}
    for k, v in block.items():
        if k in DROP_KEYS or v is None:
            continue
        if isinstance(v, dict):
            v = clean_block(v)
            if v is None:
                continue
        out[k] = v
    return out if has_number(out) else None


def has_number(block):
    for k, v in block.items():
        if isinstance(v, dict):
            if has_number(v):
                return True
        elif k not in META_KEYS and isinstance(v, (int, float)) and not isinstance(v, bool):
            return True
    return False


def clean_pricing(pricing):
    if not isinstance(pricing, dict):
        return None
    out = {}
    for provider, block in pricing.items():
        b = clean_block(block)
        if b is not None:
            out[provider] = b
    return out or None


def make_groups(codes):
    """Ordered {group: [langs]}: intl first (all non-Asian languages), then each Asian language."""
    groups = {}
    intl = [c for c in codes if c not in ASIAN]
    if intl:
        groups[INTL] = intl
    for c in codes:
        if c in ASIAN:
            groups[c] = [c]
    return groups


def fetch_group(group, langs, get=http_get_json, only_set=None, concurrency=CONCURRENCY, log=print):
    """Returns ({setId: {cardId: pricing|None}}, fetched, failed). Raises BuildError over the failure threshold."""
    set_ids = set()
    for lang in langs:
        set_ids.update(s["id"] for s in get(f"{API}/{lang}/sets"))
    if only_set:
        set_ids &= {only_set}
    if not set_ids:
        return {}, 0, 0
    jobs = [(lang, i) for i in sorted(set_ids) for lang in langs]

    def get_set(job):
        lang, i = job
        try:
            return get(f"{API}/{lang}/sets/{path_id(i)}")
        except NotFound:
            return None  # this language does not have the set

    owner = {}  # card id -> first language (languages.json order) that lists it
    set_cards = {i: set() for i in set_ids}
    with concurrent.futures.ThreadPoolExecutor(concurrency) as pool:
        docs = list(pool.map(get_set, jobs))
        for (lang, i), doc in zip(jobs, docs):
            for c in (doc or {}).get("cards", []):
                set_cards[i].add(c["id"])
                owner.setdefault(c["id"], lang)
        card_ids = sorted(owner)
        log(f"{group}: {len(set_ids)} sets, {len(card_ids)} cards")
        failed = []

        def fetch_card(cid):
            try:
                return clean_pricing(get(f"{API}/{owner[cid]}/cards/{path_id(cid)}").get("pricing"))
            except NotFound:
                return None
            except BuildError as e:
                failed.append(f"{cid}: {e}")
                return None

        prices = dict(zip(card_ids, pool.map(fetch_card, card_ids)))
    if failed:
        log(f"{group}: {len(failed)} card fetch(es) failed, e.g. {failed[0]}")
        if len(failed) > len(card_ids) * MAX_FAIL_SHARE:
            raise BuildError(f"{group}: {len(failed)} of {len(card_ids)} card fetches failed (max {MAX_FAIL_SHARE:.0%})")
    sets = {i: {cid: prices[cid] for cid in sorted(cids)} for i, cids in set_cards.items() if cids}
    return sets, len(card_ids), len(failed)


def build_set_file(group, set_id, cards, date):
    content = {"schemaVersion": SCHEMA_VERSION, "group": group, "set": set_id, "date": date, "cards": cards}
    return gzip.compress(canonical(content), 9, mtime=0)


def asset_name(group, set_id, used):
    """`{group}-{setId}.json.gz` with unsafe characters replaced; unique case-insensitively (-2, -3, ...)."""
    base = SAFE_RE.sub("_", f"{group}-{set_id}")
    name, n = base, 1
    while name.lower() in used:
        n += 1
        name = f"{base}-{n}"
    used.add(name.lower())
    return name + ".json.gz"


def check_not_shrunk(priced, previous):
    prev = (previous or {}).get("pricedCount", 0)
    if prev and priced < prev * MIN_KEEP_SHARE:
        raise BuildError(f"pricedCount dropped from {prev} to {priced}, refusing")


def run(groups, out, previous, date, fetch, log=print):
    """Core logic, network-free given `fetch(group, langs) -> {setId: {cardId: pricing|None}}`. Returns the index."""
    os.makedirs(out, exist_ok=True)
    used, index_groups, total, priced = set(), {}, 0, 0
    files = {}
    for group, langs in groups.items():
        sets = fetch(group, langs)
        if not sets:
            continue
        entries = {}
        for set_id in sorted(sets):
            cards = sets[set_id]
            name = asset_name(group, set_id, used)
            files[name] = build_set_file(group, set_id, cards, date)
            entries[set_id] = name
            total += len(cards)
            priced += sum(1 for v in cards.values() if v is not None)
        index_groups[group] = {"langs": list(langs), "sets": entries}
    if not index_groups:
        raise BuildError("no sets found")
    check_not_shrunk(priced, previous)
    for name, gz in files.items():
        with open(os.path.join(out, name), "wb") as f:
            f.write(gz)
    index = {"schemaVersion": SCHEMA_VERSION, "date": date, "tag": f"prices-{date}", "groups": index_groups,
             "cardCount": total, "pricedCount": priced}
    with open(os.path.join(out, "prices-index.json"), "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=2)
        f.write("\n")
    log(f"{len(files)} files, {priced}/{total} cards priced")
    return index


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--languages", default="languages.json")
    ap.add_argument("--out", default="dist-prices")
    ap.add_argument("--previous")
    ap.add_argument("--only-set", help="debug: restrict to one set id (never publish the result)")
    ap.add_argument("--date", default=datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d"))
    args = ap.parse_args(argv)
    previous = None
    if args.previous and os.path.exists(args.previous):
        try:
            with open(args.previous, encoding="utf-8") as f:
                previous = json.load(f)
        except ValueError:
            previous = None
    try:
        groups = make_groups(load_languages(args.languages))
        run(groups, args.out, previous, args.date,
            lambda g, langs: fetch_group(g, langs, only_set=args.only_set)[0])
    except BuildError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
