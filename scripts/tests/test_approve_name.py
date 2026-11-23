import json
import os
import subprocess
import sys

import pytest

import approve_proposal as ap

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PID = "n-20261123-0a1b2c3d"

BASE = {"formatVersion": 1, "target": "set", "lang": "ja", "id": "SV6", "original": "変幻の仮面",
        "english": "Mask of Change", "proposalId": PID}


def body_for(data):
    return (f"{ap.NAME_MARKER}\n**Nome inglese proposto**: x\n\n```json name-suggestion\n"
            f"{json.dumps(data, indent=2, ensure_ascii=False)}\n```\n\nPer approvare aggiungi l'etichetta `approvata`.\n")


def make(**over):
    d = dict(BASE)
    d.update(over)
    return d


@pytest.fixture
def root(tmp_path):
    (tmp_path / "catalog").mkdir()
    return tmp_path


def overrides(root):
    return json.loads((root / "catalog/name-overrides.json").read_text(encoding="utf-8"))


def test_creates_file_when_missing(root):
    assert ap.approve_name(body_for(make()), str(root)) == ("sets", "ja", "SV6", "Mask of Change", PID)
    assert overrides(root) == {"version": 1, "sets": {"ja": {"SV6": "Mask of Change"}}, "cards": {}}


def test_card_and_sorted_output(root):
    ap.approve_name(body_for(make(target="card", id="SV1S-002", english="Zed")), str(root))
    ap.approve_name(body_for(make(target="card", id="SV1S-001", english="Cacnea")), str(root))
    ap.approve_name(body_for(make()), str(root))
    doc = overrides(root)
    assert doc["cards"] == {"ja": {"SV1S-001": "Cacnea", "SV1S-002": "Zed"}}
    assert list(doc["cards"]["ja"]) == ["SV1S-001", "SV1S-002"]
    assert list(doc) == ["version", "sets", "cards"]
    assert (root / "catalog/name-overrides.json").read_text().endswith("}\n")


def test_later_approval_replaces_and_keeps_others(root):
    ap.approve_name(body_for(make()), str(root))
    ap.approve_name(body_for(make(id="SV7", english="Stellar Crown")), str(root))
    ap.approve_name(body_for(make(english="Mask of Change (new)")), str(root))
    assert overrides(root)["sets"]["ja"] == {"SV6": "Mask of Change (new)", "SV7": "Stellar Crown"}


def test_existing_file_with_unknown_top_level_field_is_not_a_problem(root):
    (root / "catalog/name-overrides.json").write_text(json.dumps({"version": 1, "sets": {}, "cards": {}}))
    ap.approve_name(body_for(make(lang="ko", english="X")), str(root))
    assert overrides(root)["sets"] == {"ko": {"SV6": "X"}}


@pytest.mark.parametrize("over,msg", [
    ({"english": "http://evil.example"}, "english"),
    ({"english": "see evil.com"}, "link"),
    ({"english": "@owner"}, "english"),
    ({"english": "サボネア"}, "english"),
    ({"english": ""}, "english"),
    ({"english": "x" * 101}, "english"),
    ({"english": 5}, "english"),
    ({"target": "pack"}, "target"),
    ({"lang": "xx"}, "lang"),
    ({"id": "a b"}, "`id`"),
    ({"original": ""}, "original"),
    ({"proposalId": "p-20261123-0a1b2c3d"}, "proposalId"),
    ({"formatVersion": 2}, "formatVersion"),
])
def test_invalid_suggestion_writes_nothing(root, over, msg):
    with pytest.raises(ap.ProposalError, match=msg):
        ap.approve_name(body_for(make(**over)), str(root))
    assert not (root / "catalog/name-overrides.json").exists()


def test_accepts_usual_names(root):
    for n in ["Mr. Mime", "Farfetch'd", "Type: Null", "Nidoran♀", "Pikachu & Zekrom-GX", "Flabébé"]:
        assert ap.validate_english_name(n) == n


def test_malformed_bodies(root):
    for body in ["", "no marker", ap.NAME_MARKER + "\nno block", ap.NAME_MARKER + "\n```json name-suggestion\n{x\n```"]:
        with pytest.raises(ap.ProposalError):
            ap.approve_name(body, str(root))


def test_card_proposal_body_is_not_a_name_suggestion(root):
    with pytest.raises(ap.ProposalError, match="marcatore"):
        ap.approve_name(f"{ap.MARKER}\n```json proposal\n{{}}\n```", str(root))


def test_corrupt_existing_file(root):
    (root / "catalog/name-overrides.json").write_text("{nope")
    with pytest.raises(ap.ProposalError, match="leggibile"):
        ap.approve_name(body_for(make()), str(root))


def test_cli_success_and_error(root, tmp_path):
    body = tmp_path / "body.md"
    body.write_text(body_for(make()), encoding="utf-8")
    out = tmp_path / "out"
    env = dict(os.environ, GITHUB_OUTPUT=str(out))
    r = subprocess.run([sys.executable, os.path.join(REPO, "scripts/approve_proposal.py"), "approve-name",
                        "--body-file", str(body), "--root", str(root)], capture_output=True, text=True, env=env)
    assert r.returncode == 0, r.stderr
    assert "ja/SV6" in out.read_text()
    bad = tmp_path / "bad.md"
    bad.write_text(body_for(make(english="http://x.y")), encoding="utf-8")
    err = tmp_path / "err.txt"
    r = subprocess.run([sys.executable, os.path.join(REPO, "scripts/approve_proposal.py"), "approve-name",
                        "--body-file", str(bad), "--root", str(root), "--error-file", str(err)],
                       capture_output=True, text=True)
    assert r.returncode == 1 and "english" in err.read_text()


def check(path):
    return subprocess.run([sys.executable, os.path.join(REPO, "scripts/check_extra.py"), str(path)],
                          capture_output=True, text=True)


def test_check_extra_on_overrides(tmp_path):
    good = tmp_path / "name-overrides.json"
    good.write_text(json.dumps({"version": 1, "sets": {"ja": {"SV6": "Mask of Change"}},
                                "cards": {"ja": {"SV1S-001": "Cacnea"}}}))
    assert check(good).returncode == 0
    bad = tmp_path / "bad" / "name-overrides.json"
    bad.parent.mkdir()
    bad.write_text(json.dumps({"version": 1, "sets": {"xx": {"SV6": "ok"}},
                               "cards": {"ja": {"a b": "Fine", "SV1": "http://x.io", "SV2": " Padded"}}}))
    r = check(bad)
    assert r.returncode == 1
    for needle in ("unknown language", "invalid id", "link", "SV2"):
        assert needle in r.stdout


def test_repo_catalog_overrides_valid():
    assert check(os.path.join(REPO, "catalog/name-overrides.json")).returncode == 0
