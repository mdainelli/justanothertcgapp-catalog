import copy
import io
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime, timezone

import pytest
from PIL import Image

import approve_proposal as ap

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
NOW = datetime(2026, 11, 24, 9, 30, 0, tzinfo=timezone.utc)
PID = "p-20261123-0a1b2c3d"

BASE = {
    "formatVersion": 1, "lang": "it", "setId": "base1", "setName": "Set Base", "localId": "4",
    "name": "Charizard", "category": "Pokemon", "rarity": "Rara Holo", "illustrator": "Mitsuhiro Arita",
    "types": ["Fire"], "hp": 120,
    "variants": {"normal": False, "reverse": False, "holo": True, "firstEdition": False},
    "description": "Misprint", "consent": True, "somethingNew": 1,
    "proposalId": PID, "images": {"front": f"proposals/{PID}/front.jpg", "back": f"proposals/{PID}/back.jpg"},
}


def body_for(proposal):
    return (f"{ap.MARKER}\n**Carta proposta**: x\n\nFoto: ...\n\n```json proposal\n"
            f"{json.dumps(proposal, indent=2, ensure_ascii=False)}\n```\n\nPer approvare aggiungi l'etichetta `approvata`.\n")


def make(**over):
    p = copy.deepcopy(BASE)
    p.update(over)
    return p


def jpeg(size=(2000, 1000), exif=True, color=(200, 30, 30)):
    img = Image.new("RGB", size, color)
    buf = io.BytesIO()
    kw = {}
    if exif:
        e = Image.Exif()
        e[0x010F] = "PhoneMaker"
        e[0x0112] = 1
        kw["exif"] = e
    img.save(buf, "JPEG", **kw)
    return buf.getvalue()


@pytest.fixture
def env(tmp_path):
    root = tmp_path / "repo"
    (root / "catalog").mkdir(parents=True)
    shutil.copy(os.path.join(REPO, "catalog/extra-cards.json"), root / "catalog/extra-cards.json")
    photos = tmp_path / "photos"
    d = photos / "proposals" / PID
    d.mkdir(parents=True)
    (d / "front.jpg").write_bytes(jpeg())
    (d / "back.jpg").write_bytes(jpeg((800, 1100)))
    return root, photos


def run(env, proposal=None, body=None, issue=7):
    root, photos = env
    return ap.approve(body if body is not None else body_for(proposal or make()), issue, str(root), str(photos), NOW)


def catalog(env):
    return json.loads((env[0] / "catalog/extra-cards.json").read_text(encoding="utf-8"))


def snapshot(root):
    return sorted(str(p.relative_to(root)) for p in root.rglob("*") if p.is_file()), \
        (root / "catalog/extra-cards.json").read_text()


# ---------------------------------------------------------------- happy paths

def test_existing_set_id(env):
    cid, pid = run(env)
    assert (cid, pid) == ("x-it-base1-4-charizard", PID)
    doc = catalog(env)
    assert doc["sets"] == []
    c = doc["cards"][0]
    assert c["setId"] == "base1" and c["hp"] == 120 and c["types"] == ["Fire"] and c["category"] == "Pokemon"
    assert c["variants"]["holo"] is True and c["rarity"] == "Rara Holo" and c["illustrator"] == "Mitsuhiro Arita"
    assert c["description"] == "Misprint"
    assert c["images"] == {"front": f"catalog/images/it/{cid}/front.webp", "back": f"catalog/images/it/{cid}/back.webp"}
    assert c["source"] == {"issue": 7, "approvedAt": "2026-11-24T09:30:00Z"}
    assert "consent" not in c and "somethingNew" not in c
    assert doc["updatedAt"] == "2026-11-24T09:30:00Z"
    assert (env[0] / c["images"]["front"]).is_file() and (env[0] / c["images"]["back"]).is_file()


def test_new_set_name_creates_extra_set(env):
    cid, _ = run(env, make(setId=None, setName="Promo Città d'Arte!"))
    doc = catalog(env)
    assert cid == "x-it-promo-citta-d-arte-4-charizard"
    assert doc["sets"] == [{"id": "x-it-promo-citta-d-arte", "lang": "it", "name": "Promo Città d'Arte!"}]
    assert doc["cards"][0]["setId"] == "x-it-promo-citta-d-arte"


def test_existing_extra_set_not_duplicated(env):
    run(env, make(setId=None, setName="My Set"))
    (env[0] / "catalog/images").mkdir(exist_ok=True)
    run(env, make(setId=None, setName="My Set", localId="5", proposalId=PID))
    assert len(catalog(env)["sets"]) == 1 and len(catalog(env)["cards"]) == 2


def test_explicit_extra_set_id(env):
    run(env, make(setId=None, setName="My Set"))
    cid, _ = run(env, make(setId="x-it-my-set", localId="9"))
    assert cid == "x-it-my-set-9-charizard"


def test_unknown_extra_set_id_rejected(env):
    with pytest.raises(ap.ProposalError, match="non esiste"):
        run(env, make(setId="x-it-nope"))


def test_back_missing_is_allowed(env):
    p = make()
    p["images"]["back"] = None
    cid, _ = run(env, p)
    c = catalog(env)["cards"][0]
    assert c["images"] == {"front": f"catalog/images/it/{cid}/front.webp"}
    assert not (env[0] / f"catalog/images/it/{cid}/back.webp").exists()


def test_optional_fields_omitted(env):
    p = make(category=None, rarity=None, illustrator="", types=None, hp=None, variants=None, description=None)
    run(env, p)
    c = catalog(env)["cards"][0]
    assert set(c) == {"id", "lang", "setId", "localId", "name", "images", "source"}


def test_ordering_and_format(env):
    run(env, make(localId="10", name="B"))
    run(env, make(localId="2", name="A"))
    run(env, make(localId="SV1", name="C"))
    run(env, make(lang="en", setId="base1", localId="1", name="Z"))
    doc = catalog(env)
    assert [c["id"] for c in doc["cards"]] == [
        "x-en-base1-1-z", "x-it-base1-2-a", "x-it-base1-10-b", "x-it-base1-sv1-c"]
    text = (env[0] / "catalog/extra-cards.json").read_text(encoding="utf-8")
    assert text.endswith("}\n") and not text.endswith("\n\n") and '\n  "cards": [' in text


def test_non_ascii_preserved_in_json(env):
    run(env, make(name="Pikachu é", description="città"))
    assert "città" in (env[0] / "catalog/extra-cards.json").read_text(encoding="utf-8")


# ---------------------------------------------------------------- malformed

def test_no_marker():
    with pytest.raises(ap.ProposalError, match="marcatore"):
        ap.parse_issue_body("hello\n```json proposal\n{}\n```")


def test_no_block():
    with pytest.raises(ap.ProposalError, match="blocco"):
        ap.parse_issue_body(ap.MARKER + "\nnothing")


def test_block_before_marker_is_ignored():
    with pytest.raises(ap.ProposalError, match="blocco"):
        ap.parse_issue_body("```json proposal\n{}\n```\n" + ap.MARKER)


def test_bad_json():
    with pytest.raises(ap.ProposalError, match="JSON non valido"):
        ap.parse_issue_body(ap.MARKER + "\n```json proposal\n{oops\n```")


def test_json_not_object():
    with pytest.raises(ap.ProposalError, match="oggetto"):
        ap.parse_issue_body(ap.MARKER + "\n```json proposal\n[1]\n```")


def test_crlf_body():
    assert ap.parse_issue_body(body_for(make()).replace("\n", "\r\n"))["name"] == "Charizard"


@pytest.mark.parametrize("field,value,msg", [
    ("name", None, "`name`"), ("name", "", "`name`"), ("name", "x" * 101, "`name`"),
    ("localId", None, "`localId`"), ("localId", "a b", "`localId`"), ("localId", "--", "`localId`"),
    ("lang", "xx", "`lang`"), ("lang", None, "`lang`"),
    ("formatVersion", 2, "formatVersion"), ("category", "Stadium", "`category`"),
    ("hp", "120", "`hp`"), ("hp", True, "`hp`"), ("types", "Fire", "`types`"),
    ("types", ["a", "b", "c", "d", "e"], "`types`"), ("variants", {"holo": "yes"}, "variants.holo"),
    ("proposalId", "../../x", "proposalId"), ("setId", "bad id", "`setId`"),
    ("images", {"front": "proposals/other/front.jpg"}, "images.front"),
    ("images", None, "images"),
])
def test_invalid_fields(env, field, value, msg):
    with pytest.raises(ap.ProposalError, match=msg):
        run(env, make(**{field: value}))


def test_set_name_required_without_set_id(env):
    with pytest.raises(ap.ProposalError, match="setName"):
        run(env, make(setId=None, setName=None))


def test_missing_required_field_key(env):
    p = make()
    del p["name"]
    with pytest.raises(ap.ProposalError, match="name"):
        run(env, p)


# ---------------------------------------------------------------- duplicates / atomicity

def test_duplicate_id_and_no_side_effects(env):
    run(env)
    before = snapshot(env[0])
    with pytest.raises(ap.ProposalError, match="duplicata"):
        run(env)
    assert snapshot(env[0]) == before


def test_duplicate_local_id_different_name(env):
    run(env)
    with pytest.raises(ap.ProposalError, match="gia' usato"):
        run(env, make(name="Charmeleon"))


def test_missing_front_photo_no_side_effects(env):
    os.remove(env[1] / "proposals" / PID / "front.jpg")
    before = snapshot(env[0])
    with pytest.raises(ap.ProposalError, match="fronte"):
        run(env)
    assert snapshot(env[0]) == before


def test_missing_back_photo_when_declared(env):
    os.remove(env[1] / "proposals" / PID / "back.jpg")
    before = snapshot(env[0])
    with pytest.raises(ap.ProposalError, match="retro"):
        run(env)
    assert snapshot(env[0]) == before


def test_corrupt_photo(env):
    (env[1] / "proposals" / PID / "front.jpg").write_bytes(b"not an image")
    with pytest.raises(ap.ProposalError, match="illeggibile"):
        run(env)


def test_png_rejected(env):
    buf = io.BytesIO()
    Image.new("RGB", (10, 10)).save(buf, "PNG")
    (env[1] / "proposals" / PID / "front.jpg").write_bytes(buf.getvalue())
    with pytest.raises(ap.ProposalError, match="JPEG"):
        run(env)


# ---------------------------------------------------------------- slugs

@pytest.mark.parametrize("text,expected", [
    ("Pikachu", "pikachu"),
    ("Pokémon  Ünïcode", "pokemon-unicode"),
    ("Flabébé", "flabebe"),
    ("Mr. Mime — V-UNION!!", "mr-mime-v-union"),
    ("  --a--b--  ", "a-b"),
    ("Nidoran♀", "nidoran"),
    ("A&B/C", "a-b-c"),
])
def test_slug(text, expected):
    assert ap.slug(text) == expected


def test_slug_japanese_fallback():
    s = ap.slug("ピカチュウ")
    assert s.startswith("card-") and len(s) == 13 and s == ap.slug("ピカチュウ")
    assert s != ap.slug("リザードン")
    assert ap.slug("！？", "set").startswith("set-")


def test_japanese_card_id_valid(env):
    cid, _ = run(env, make(lang="ja", setId=None, setName="拡張パック", name="ピカチュウ", localId="1"))
    assert ap.ID_RE.match(cid) and len(cid) <= 100
    assert catalog(env)["sets"][0]["id"].startswith("x-ja-set-")


def test_long_names_truncated_to_valid_id():
    cid = ap.build_card_id("zh-tw", "set-" + "a" * 36, "A" * 20, "b" * 100)
    assert len(cid) <= 100 and ap.ID_RE.match(cid)


def test_setid_with_dots_and_case():
    assert ap.build_card_id("en", ap.set_slug_for("SV3.5_x"), "TG05", "Eevee") == "x-en-sv3-5-x-tg05-eevee"


# ---------------------------------------------------------------- images

def test_webp_conversion_strips_exif_and_resizes():
    src = jpeg((3000, 1500), exif=True)
    assert Image.open(io.BytesIO(src)).getexif()
    out = ap.convert_to_webp(src)
    img = Image.open(io.BytesIO(out))
    assert img.format == "WEBP"
    assert max(img.size) == 1200 and img.size == (1200, 600)
    assert not img.getexif() and "exif" not in img.info and "icc_profile" not in img.info
    assert b"EXIF" not in out and b"PhoneMaker" not in out


def test_webp_small_image_not_upscaled():
    out = ap.convert_to_webp(jpeg((300, 400), exif=False))
    assert Image.open(io.BytesIO(out)).size == (300, 400)


def test_webp_exif_orientation_applied():
    img = Image.new("RGB", (400, 200), (1, 2, 3))
    e = Image.Exif()
    e[0x0112] = 6
    buf = io.BytesIO()
    img.save(buf, "JPEG", exif=e)
    out = Image.open(io.BytesIO(ap.convert_to_webp(buf.getvalue())))
    assert out.size == (200, 400) and not out.getexif()


# ---------------------------------------------------------------- CLI / end to end

def test_cli_dry_run_fixture_validates(tmp_path):
    """Run the CLI on the fixture body and validate the result with check_extra.py (and ajv if available)."""
    root = tmp_path / "repo"
    shutil.copytree(os.path.join(REPO, "catalog"), root / "catalog")
    shutil.copytree(os.path.join(REPO, "schema"), root / "schema")
    shutil.copytree(os.path.join(REPO, "scripts"), root / "scripts", ignore=shutil.ignore_patterns("tests", "__pycache__"))
    photos = tmp_path / "photos" / "proposals" / PID
    photos.mkdir(parents=True)
    (photos / "front.jpg").write_bytes(jpeg())
    (photos / "back.jpg").write_bytes(jpeg((800, 1100)))
    fixture = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "issue-body.md")
    err = tmp_path / "err.txt"
    r = subprocess.run([sys.executable, str(root / "scripts/approve_proposal.py"), "approve", "--body-file", fixture,
                        "--issue", "12", "--photos-dir", str(tmp_path / "photos"), "--root", str(root),
                        "--error-file", str(err)], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    assert r.stdout.split() == ["x-it-base1-4-charizard", PID]
    r = subprocess.run([sys.executable, str(root / "scripts/check_extra.py")], capture_output=True, text=True, cwd=root)
    assert r.returncode == 0, r.stdout
    # second run: duplicate -> exit 1 + error file
    r = subprocess.run([sys.executable, str(root / "scripts/approve_proposal.py"), "approve", "--body-file", fixture,
                        "--issue", "12", "--photos-dir", str(tmp_path / "photos"), "--root", str(root),
                        "--error-file", str(err)], capture_output=True, text=True)
    assert r.returncode == 1 and "duplicata" in err.read_text()


def test_cli_proposal_id_from_event_payload(tmp_path):
    ev = tmp_path / "event.json"
    ev.write_text(json.dumps({"issue": {"body": body_for(make())}}))
    r = subprocess.run([sys.executable, os.path.join(REPO, "scripts/approve_proposal.py"), "proposal-id",
                        "--body-file", str(ev)], capture_output=True, text=True)
    assert r.returncode == 0 and r.stdout.strip() == PID
