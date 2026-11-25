import gzip
import json

import pytest

import build_packs as bp
import build_prices as bpr

A = bp.API


def fake_get(db, calls=None):
    def get(url):
        if calls is not None:
            calls.append(url)
        v = db[url]
        if isinstance(v, Exception):
            raise v
        return v
    return get


def quiet(*_):
    pass


def price(avg=1.0):
    return {"cardmarket": {"updated": "t", "unit": "EUR", "idProduct": 5, "avg": avg, "low": None}}


def test_groups():
    assert bpr.make_groups(["en", "it", "ja", "ko"]) == {"intl": ["en", "it"], "ja": ["ja"], "ko": ["ko"]}
    assert bpr.make_groups(["ja"]) == {"ja": ["ja"]}


def test_clean_pricing():
    p = {
        "cardmarket": {"updated": "t", "unit": "EUR", "idProduct": 1, "avg": 2.5, "low": None, "avg-holo": 0},
        "tcgplayer": {"updated": "t", "unit": "USD",
                      "normal": {"productId": 9, "lowPrice": None, "marketPrice": 1.2},
                      "holo": {"productId": 9, "lowPrice": None}},
    }
    assert bpr.clean_pricing(p) == {
        "cardmarket": {"updated": "t", "unit": "EUR", "avg": 2.5, "avg-holo": 0},
        "tcgplayer": {"updated": "t", "unit": "USD", "normal": {"marketPrice": 1.2}},
    }
    assert bpr.clean_pricing({"cardmarket": {"updated": "t", "unit": "EUR", "idProduct": 1}, "tcgplayer": None}) is None
    assert bpr.clean_pricing(None) is None
    assert bpr.clean_pricing({"tcgplayer": {"updated": "t", "unit": "USD", "holo": {"productId": 1}}}) is None


def intl_db():
    return {
        f"{A}/en/sets": [{"id": "s1"}, {"id": "s2"}],
        f"{A}/it/sets": [{"id": "s1"}, {"id": "s3"}],
        f"{A}/en/sets/s1": {"cards": [{"id": "s1-1"}, {"id": "s1-2"}]},
        f"{A}/it/sets/s1": {"cards": [{"id": "s1-1"}, {"id": "s1-3"}]},
        f"{A}/en/sets/s2": {"cards": [{"id": "s2-1"}]},
        f"{A}/it/sets/s3": {"cards": [{"id": "s3-1"}]},
        f"{A}/en/sets/s3": bp.NotFound("x"),
        f"{A}/it/sets/s2": bp.NotFound("x"),
        f"{A}/en/cards/s1-1": {"pricing": price(1)},
        f"{A}/en/cards/s1-2": {"pricing": None},
        f"{A}/it/cards/s1-3": {"pricing": price(3)},
        f"{A}/en/cards/s2-1": {"id": "s2-1"},
        f"{A}/it/cards/s3-1": bp.NotFound("x"),
    }


def test_fetch_group_union_dedupe_null_cards():
    calls = []
    sets, fetched, failed = bpr.fetch_group("intl", ["en", "it"], get=fake_get(intl_db(), calls), log=quiet)
    assert sorted(sets) == ["s1", "s2", "s3"]
    assert list(sets["s1"]) == ["s1-1", "s1-2", "s1-3"]
    assert sets["s1"]["s1-1"]["cardmarket"]["avg"] == 1 and "idProduct" not in sets["s1"]["s1-1"]["cardmarket"]
    assert sets["s1"]["s1-2"] is None and sets["s1"]["s1-3"]["cardmarket"]["avg"] == 3
    assert sets["s2"] == {"s2-1": None} and sets["s3"] == {"s3-1": None}
    assert (fetched, failed) == (5, 0)
    card_calls = [c for c in calls if "/cards/" in c]
    assert len(card_calls) == len(set(card_calls)) == 5
    assert f"{A}/it/cards/s1-1" not in calls  # fetched once, from the first language


def test_only_set():
    sets, n, _ = bpr.fetch_group("intl", ["en", "it"], get=fake_get(intl_db()), only_set="s2", log=quiet)
    assert list(sets) == ["s2"] and n == 1


def test_ja_collision_kept_separate(tmp_path):
    db = {
        f"{A}/en/sets": [{"id": "neo1"}], f"{A}/ja/sets": [{"id": "neo1"}],
        f"{A}/en/sets/neo1": {"cards": [{"id": "neo1-1"}]}, f"{A}/ja/sets/neo1": {"cards": [{"id": "neo1-1"}]},
        f"{A}/en/cards/neo1-1": {"pricing": price(1)}, f"{A}/ja/cards/neo1-1": {"pricing": price(9)},
    }
    groups = bpr.make_groups(["en", "ja"])
    idx = bpr.run(groups, str(tmp_path), None, "2026-01-02",
                  lambda g, langs: bpr.fetch_group(g, langs, get=fake_get(db), log=quiet)[0], log=quiet)
    assert idx["groups"]["intl"]["sets"]["neo1"] == "intl-neo1.json.gz"
    assert idx["groups"]["ja"]["sets"]["neo1"] == "ja-neo1.json.gz"
    ja = json.loads(gzip.decompress((tmp_path / "ja-neo1.json.gz").read_bytes()))
    en = json.loads(gzip.decompress((tmp_path / "intl-neo1.json.gz").read_bytes()))
    assert ja["cards"]["neo1-1"]["cardmarket"]["avg"] == 9 and en["cards"]["neo1-1"]["cardmarket"]["avg"] == 1
    assert (idx["cardCount"], idx["pricedCount"], idx["tag"]) == (2, 2, "prices-2026-01-02")
    assert ja["group"] == "ja" and ja["set"] == "neo1" and ja["schemaVersion"] == 1


def test_asset_names_unique_case_insensitive():
    used = set()
    names = [bpr.asset_name("intl", s, used) for s in ["SM1+", "sm1_", "sm1+", "exu-?", "a b"]]
    assert names == ["intl-SM1_.json.gz", "intl-sm1_-2.json.gz", "intl-sm1_-3.json.gz", "intl-exu-_.json.gz", "intl-a_b.json.gz"]


def test_failure_threshold():
    db = {f"{A}/en/sets": [{"id": "s"}], f"{A}/en/sets/s": {"cards": [{"id": f"s-{i}"} for i in range(100)]}}
    for i in range(100):
        db[f"{A}/en/cards/s-{i}"] = {"pricing": price()}
    for i in range(2):
        db[f"{A}/en/cards/s-{i}"] = bp.BuildError("boom")
    sets, _, failed = bpr.fetch_group("intl", ["en"], get=fake_get(db), log=quiet)
    assert failed == 2 and sets["s"]["s-0"] is None
    db[f"{A}/en/cards/s-2"] = bp.BuildError("boom")
    with pytest.raises(bp.BuildError):
        bpr.fetch_group("intl", ["en"], get=fake_get(db), log=quiet)


def test_shrink_check(tmp_path):
    fetch = lambda g, l: {"s": {"a": price(), "b": None}}
    with pytest.raises(bp.BuildError):
        bpr.run({"intl": ["en"]}, str(tmp_path / "o"), {"pricedCount": 10}, "2026-01-01", fetch, log=quiet)
    assert not (tmp_path / "o" / "prices-index.json").exists()
    bpr.run({"intl": ["en"]}, str(tmp_path / "o"), {"pricedCount": 2}, "2026-01-01", fetch, log=quiet)
    assert (tmp_path / "o" / "prices-index.json").exists()


def test_deterministic_gzip_and_canonical():
    cards = {"b": None, "a": {"cardmarket": {"unit": "EUR", "avg": 1}}}
    g1 = bpr.build_set_file("intl", "s", cards, "2026-01-01")
    assert g1 == bpr.build_set_file("intl", "s", dict(reversed(list(cards.items()))), "2026-01-01")
    raw = gzip.decompress(g1)
    assert raw == (b'{"cards":{"a":{"cardmarket":{"avg":1,"unit":"EUR"}},"b":null},"date":"2026-01-01",'
                   b'"group":"intl","schemaVersion":1,"set":"s"}')
