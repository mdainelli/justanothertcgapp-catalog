import gzip
import io
import json
import urllib.error

import pytest

import build_packs as bp


def fake_get(db):
    def get(url):
        return db[url]
    return get


def make_db(lang="en"):
    base = f"{bp.API}/{lang}"
    return {
        f"{base}/sets": [{"id": "b1", "name": "B"}, {"id": "a1", "name": "A"}],
        f"{base}/sets/a1": {"id": "a1", "name": "A", "cards": [{"id": "a1-1", "localId": "1"}, {"id": "a1-2", "localId": "2"}]},
        f"{base}/sets/b1": {"id": "b1", "name": "B", "cards": [{"id": "b1-1", "localId": "1"}, {"id": "a1-2", "localId": "2"}]},
        f"{base}/cards/a1-1": {"id": "a1-1", "name": "X", "hp": 60, "pricing": {"cardmarket": {}}, "updated": "t", "variants": {"normal": True}},
        f"{base}/cards/a1-2": {"id": "a1-2", "name": "Y"},
        f"{base}/cards/b1-1": {"id": "b1-1", "name": "Z", "dexId": [1]},
    }


def test_fetch_content_sorted_dedup_and_clean():
    c = bp.fetch_pack_content("en", get=fake_get(make_db()), log=lambda *_: None)
    assert [s["id"] for s in c["sets"]] == ["a1", "b1"]
    assert [x["id"] for x in c["cards"]] == ["a1-1", "a1-2", "b1-1"]
    assert "pricing" not in c["cards"][0] and "updated" not in c["cards"][0]
    assert c["cards"][0]["variants"] == {"normal": True} and c["cards"][0]["hp"] == 60
    assert c["cards"][2]["dexId"] == [1]
    assert c["schemaVersion"] == 1 and c["lang"] == "en"


def test_only_set():
    c = bp.fetch_pack_content("en", get=fake_get(make_db()), only_set="a1", log=lambda *_: None)
    assert len(c["sets"]) == 1 and len(c["cards"]) == 2


def test_pack_is_deterministic_and_entry_correct():
    c = bp.fetch_pack_content("en", get=fake_get(make_db()), log=lambda *_: None)
    gz1, e1 = bp.build_pack(c, "2026-01-01")
    gz2, e2 = bp.build_pack(c, "2026-02-02")
    assert gz1 == gz2 and e1["sha256"] == e2["sha256"] and e1["contentHash"] == e2["contentHash"]
    assert json.loads(gzip.decompress(gz1))["lang"] == "en"
    assert (e1["setCount"], e1["cardCount"], e1["size"]) == (2, 3, len(gz1))
    assert e1["file"] == "en.json.gz" and e1["version"] == "2026-01-01"


def run_build(tmp_path, codes, previous, date, dbs):
    out = tmp_path / "out"
    idx = bp.run(codes, str(out), previous, date,
                 lambda lang: bp.fetch_pack_content(lang, get=fake_get(dbs[lang]), log=lambda *_: None),
                 log=lambda *_: None)
    return out, idx


def test_only_changed_languages_republished(tmp_path):
    dbs = {"en": make_db("en"), "it": make_db("it")}
    out1, idx1 = run_build(tmp_path, ["en", "it"], None, "2026-01-01", dbs)
    assert (out1 / "changed.txt").read_text() == "en\nit\n"
    assert (out1 / "en.json.gz").exists()
    dbs["it"][f"{bp.API}/it/cards/a1-2"]["name"] = "Changed"
    out2, idx2 = run_build(tmp_path / "second", ["en", "it"], idx1, "2026-01-08", dbs)
    assert (out2 / "changed.txt").read_text() == "it\n"
    assert not (out2 / "en.json.gz").exists()
    by = {p["lang"]: p for p in idx2["packs"]}
    assert by["en"]["version"] == "2026-01-01" and by["it"]["version"] == "2026-01-08"
    assert json.loads((out2 / "index.json").read_text())["packs"] == idx2["packs"]


def test_removed_and_added_language(tmp_path):
    dbs = {"en": make_db("en"), "it": make_db("it"), "ja": make_db("ja")}
    _, idx1 = run_build(tmp_path, ["en", "it"], None, "2026-01-01", dbs)
    out2, idx2 = run_build(tmp_path / "s", ["en", "ja"], idx1, "2026-01-08", dbs)
    assert (out2 / "changed.txt").read_text() == "ja\n"
    assert (out2 / "removed.txt").read_text() == "it\n"
    assert [p["lang"] for p in idx2["packs"]] == ["en", "ja"]


def test_shrink_guard(tmp_path):
    dbs = {"en": make_db("en")}
    prev = {"packs": [{"lang": "en", "cardCount": 100, "contentHash": "x", "version": "v"}]}
    with pytest.raises(bp.BuildError):
        run_build(tmp_path, ["en"], prev, "2026-01-08", dbs)


def test_load_languages(tmp_path):
    p = tmp_path / "l.json"
    p.write_text('{"languages":[{"code":"en"},{"code":"zh-tw"}]}')
    assert bp.load_languages(str(p)) == ["en", "zh-tw"]
    for bad in ('{"languages":[]}', '{"languages":[{"code":"E N"}]}', '{"languages":[{"code":"en"},{"code":"en"}]}'):
        p.write_text(bad)
        with pytest.raises(bp.BuildError):
            bp.load_languages(str(p))


class Resp(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        pass


def test_retries_503_then_succeeds():
    calls = []

    def opener(req, timeout):
        calls.append(req.get_header("User-agent"))
        if len(calls) < 3:
            raise urllib.error.HTTPError(req.full_url, 503, "x", {}, None)
        return Resp(b'{"ok":true}')

    assert bp.http_get_json("http://x", sleep=lambda s: None, opener=opener) == {"ok": True}
    assert len(calls) == 3 and calls[0].startswith("justanothertcgapp")


def missing_get(db, missing):
    def get(url):
        if url in missing:
            raise bp.NotFound(url)
        return db[url]
    return get


def test_card_without_details_kept_from_set_list():
    db = make_db()
    url = f"{bp.API}/en/cards/a1-2"
    c = bp.fetch_pack_content("en", get=missing_get(db, {url}), log=lambda *_: None)
    card = next(x for x in c["cards"] if x["id"] == "a1-2")
    assert card["localId"] == "2" and card["set"]["id"] == "a1"


def test_too_many_cards_without_details_fail(monkeypatch):
    monkeypatch.setattr(bp, "MIN_MISSING_ALLOWED", 1)
    db = make_db()
    missing = {f"{bp.API}/en/cards/a1-1", f"{bp.API}/en/cards/a1-2"}
    with pytest.raises(bp.BuildError):
        bp.fetch_pack_content("en", get=missing_get(db, missing), log=lambda *_: None)


def test_missing_set_still_fails():
    db = make_db()
    with pytest.raises(bp.NotFound):
        bp.fetch_pack_content("en", get=missing_get(db, {f"{bp.API}/en/sets/a1"}), log=lambda *_: None)


def test_404_fails_fast_and_exhausted_retries_fail():
    def nf(req, timeout):
        raise urllib.error.HTTPError(req.full_url, 404, "x", {}, None)

    with pytest.raises(bp.NotFound):
        bp.http_get_json("http://x", sleep=lambda s: None, opener=nf)

    n = []

    def always503(req, timeout):
        n.append(1)
        raise urllib.error.HTTPError(req.full_url, 503, "x", {}, None)

    with pytest.raises(bp.BuildError):
        bp.http_get_json("http://x", retries=3, sleep=lambda s: None, opener=always503)
    assert len(n) == 3


def test_path_id_encodes_special_ids():
    assert bp.path_id("SM1+") == "SM1%2B"
    assert bp.path_id("exu-?") == "exu-%3F"
    assert bp.path_id("exu-%3F") == "exu-%3F"
    assert bp.path_id("swsh3-136") == "swsh3-136"
