#!/usr/bin/env python3
"""Approve a card proposal: parse the issue body, validate, convert photos, update the extra catalog.

Contract with the proposal Worker: see FORMAT.md ("Approvazione delle proposte").

CLI:
  approve_proposal.py approve --body-file F --issue N --photos-dir D [--root R] [--error-file E]
  approve_proposal.py approve-name --body-file F [--root R] [--error-file E]   # name suggestion (label `nome`)
  approve_proposal.py proposal-id --body-file F        # prints the proposalId (used by cleanup)

`--body-file` may be a plain text file or a GitHub event payload JSON (issue.body is used).
On failure: exit code 1 and the (Italian) reason is printed on stderr and written to --error-file;
nothing under catalog/ is modified.
"""
import argparse
import hashlib
import io
import json
import os
import re
import sys
import unicodedata
from datetime import datetime, timezone

MARKER = "<!-- justanothertcgapp-proposal v1 -->"
LANGS = ("en fr es es-mx it pt pt-br de nl pl ru ja ko zh-tw zh-cn id th").split()
CATEGORIES = ("Pokemon", "Trainer", "Energy")
VARIANT_KEYS = ("normal", "reverse", "holo", "firstEdition")
ID_RE = re.compile(r"^x-[a-z0-9]+(-[a-z0-9]+)*$")
SETREF_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
LOCALID_RE = re.compile(r"^[A-Za-z0-9\-/.]{1,20}$")
PROPOSAL_ID_RE = re.compile(r"^p-\d{8}-[0-9a-f]{8}$")
FENCE_RE = re.compile(r"^```json proposal[ \t]*\n(.*?)\n```[ \t]*$", re.S | re.M)
MAX_ID = 100
MAX_SIDE = 1200
WEBP_QUALITY = 85
CATALOG = "catalog/extra-cards.json"
NAME_MARKER = "<!-- justanothertcgapp-name-suggestion v1 -->"
NAME_FENCE_RE = re.compile(r"^```json name-suggestion[ \t]*\n(.*?)\n```[ \t]*$", re.S | re.M)
NAME_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9\-._]{0,59}$")
NAME_OVERRIDES = "catalog/name-overrides.json"
ENGLISH_PUNCT = " '\u2019.,:!?&+-\u2013()/\u00b7\u2640\u2642"


class ProposalError(Exception):
    """A problem with the proposal; the message is shown to the user (Italian)."""


# ---------------------------------------------------------------- slugs / ids

def _hash8(text):
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:8]


def slug(text, fallback_prefix="card", max_len=None):
    """Lowercase ASCII slug [a-z0-9-]. Text with no ASCII letters/digits left (e.g. Japanese)
    becomes `<fallback_prefix>-<hash8 of the original text>`."""
    norm = unicodedata.normalize("NFKD", text)
    norm = "".join(c for c in norm if not unicodedata.combining(c))
    norm = norm.encode("ascii", "ignore").decode("ascii").lower()
    s = re.sub(r"[^a-z0-9]+", "-", norm).strip("-")
    if not s:
        s = f"{fallback_prefix}-{_hash8(text)}"
    if max_len is not None and len(s) > max_len:
        s = s[:max_len].strip("-")
    return s


def set_slug_for(set_id):
    """Set part of a card id for an existing set id (x-<lang>- prefix dropped for extra sets)."""
    return slug(set_id, "set", 40)


def build_card_id(lang, set_part, local_id, name):
    head = f"x-{lang}-{set_part}-{slug(local_id, 'n')}-"
    room = MAX_ID - len(head)
    if room < 1:
        raise ProposalError("id carta troppo lungo (numero o set con nome eccessivo)")
    cid = head + slug(name, "card", room)
    if not ID_RE.match(cid) or len(cid) > MAX_ID:
        raise ProposalError(f"id carta generato non valido: {cid}")
    return cid


# ---------------------------------------------------------------- parsing

def parse_issue_body(body):
    """Return the proposal dict found in the issue body (marker + ```json proposal block)."""
    if not isinstance(body, str) or not body.strip():
        raise ProposalError("il corpo della issue e' vuoto")
    body = body.replace("\r\n", "\n").replace("\r", "\n")
    pos = body.find(MARKER)
    if pos < 0:
        raise ProposalError(f"manca il marcatore `{MARKER}` all'inizio del corpo")
    m = FENCE_RE.search(body, pos + len(MARKER))
    if not m:
        raise ProposalError("manca il blocco ```json proposal ... ``` dopo il marcatore")
    try:
        data = json.loads(m.group(1))
    except json.JSONDecodeError as e:
        raise ProposalError(f"JSON non valido nel blocco `json proposal` (riga {e.lineno}, colonna {e.colno}: {e.msg})")
    if not isinstance(data, dict):
        raise ProposalError("il blocco `json proposal` deve contenere un oggetto JSON")
    return data


def _str(data, key, required=False, max_len=200, min_len=1):
    v = data.get(key)
    if v is None or (isinstance(v, str) and not v.strip() and not required):
        if required:
            raise ProposalError(f"campo `{key}` obbligatorio mancante")
        return None
    if not isinstance(v, str):
        raise ProposalError(f"campo `{key}` deve essere una stringa")
    v = v.strip()
    if len(v) < min_len or len(v) > max_len:
        raise ProposalError(f"campo `{key}` deve avere tra {min_len} e {max_len} caratteri")
    return v


def validate_proposal(data):
    """Return a normalized proposal dict, or raise ProposalError. Unknown fields are ignored."""
    if data.get("formatVersion") != 1 or isinstance(data.get("formatVersion"), bool):
        raise ProposalError("`formatVersion` deve essere 1")
    lang = data.get("lang")
    if lang not in LANGS:
        raise ProposalError(f"`lang` non valida: {lang!r} (ammesse: {' '.join(LANGS)})")
    set_id = _str(data, "setId", max_len=100)
    if set_id is not None and not SETREF_RE.match(set_id):
        raise ProposalError(f"`setId` non valido: {set_id!r}")
    set_name = _str(data, "setName", required=set_id is None, max_len=200)
    local_id = _str(data, "localId", required=True, max_len=20)
    if not LOCALID_RE.match(local_id) or not re.search(r"[A-Za-z0-9]", local_id):
        raise ProposalError(f"`localId` non valido: {local_id!r} (ammessi lettere, cifre e - / .)")
    name = _str(data, "name", required=True, max_len=100)
    category = data.get("category")
    if category is not None and category not in CATEGORIES:
        raise ProposalError(f"`category` non valida: {category!r} (Pokemon, Trainer, Energy o null)")
    types = data.get("types")
    if types is not None:
        if not isinstance(types, list) or len(types) > 4 or not all(
                isinstance(t, str) and 1 <= len(t.strip()) <= 50 for t in types):
            raise ProposalError("`types` deve essere una lista di al massimo 4 stringhe non vuote")
        types = [t.strip() for t in types]
    hp = data.get("hp")
    if hp is not None and (isinstance(hp, bool) or not isinstance(hp, int) or not 0 <= hp <= 9999):
        raise ProposalError("`hp` deve essere un intero tra 0 e 9999 oppure null")
    variants = data.get("variants")
    if variants is not None:
        if not isinstance(variants, dict):
            raise ProposalError("`variants` deve essere un oggetto")
        for k in VARIANT_KEYS:
            if k in variants and not isinstance(variants[k], bool):
                raise ProposalError(f"`variants.{k}` deve essere true o false")
        variants = {k: variants[k] for k in VARIANT_KEYS if k in variants}
    description = _str(data, "description", max_len=1000)
    proposal_id = data.get("proposalId")
    if not isinstance(proposal_id, str) or not PROPOSAL_ID_RE.match(proposal_id):
        raise ProposalError("`proposalId` mancante o non valido (atteso p-YYYYMMDD-<8 hex>)")
    images = data.get("images")
    if not isinstance(images, dict):
        raise ProposalError("`images` mancante")
    if images.get("front") != f"proposals/{proposal_id}/front.jpg":
        raise ProposalError(f"`images.front` deve essere proposals/{proposal_id}/front.jpg")
    back = images.get("back")
    if back is not None and back != f"proposals/{proposal_id}/back.jpg":
        raise ProposalError(f"`images.back` deve essere proposals/{proposal_id}/back.jpg oppure null")
    return {
        "lang": lang, "setId": set_id, "setName": set_name, "localId": local_id, "name": name,
        "category": category, "rarity": _str(data, "rarity", max_len=100),
        "illustrator": _str(data, "illustrator", max_len=200), "types": types or None,
        "hp": hp, "variants": variants, "description": description,
        "proposalId": proposal_id, "hasBack": back is not None,
    }


# ---------------------------------------------------------------- catalog

def natural_key(s):
    return [(0, int(p), "") if p.isdigit() else (1, 0, p.lower()) for p in re.findall(r"\d+|\D+", s)]


def sort_catalog(doc):
    doc["sets"].sort(key=lambda s: (s["lang"], s["id"]))
    doc["cards"].sort(key=lambda c: (c["lang"], c["setId"], natural_key(c["localId"]), c["id"]))


def dump_catalog(doc):
    return json.dumps(doc, indent=2, ensure_ascii=False) + "\n"


def utc_iso(now):
    return now.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def add_to_catalog(doc, p, issue_number, now):
    """Mutate doc in place; return (card, new_set_or_None). Raises ProposalError on conflicts."""
    lang = p["lang"]
    new_set = None
    if p["setId"] is None:
        set_id = f"x-{lang}-{slug(p['setName'], 'set', 60)}"
        set_part = set_id[len(f"x-{lang}-"):]
        if not any(s["lang"] == lang and s["id"] == set_id for s in doc["sets"]):
            new_set = {"id": set_id, "lang": lang, "name": p["setName"]}
    else:
        set_id = p["setId"]
        if set_id.startswith("x-"):
            if not any(s["lang"] == lang and s["id"] == set_id for s in doc["sets"]):
                raise ProposalError(f"il set extra `{set_id}` ({lang}) non esiste nel catalogo")
            set_part = set_id[len(f"x-{lang}-"):] if set_id.startswith(f"x-{lang}-") else set_id[2:]
            set_part = slug(set_part, "set", 40)
        else:
            set_part = set_slug_for(set_id)
    card_id = build_card_id(lang, set_part, p["localId"], p["name"])
    for c in doc["cards"]:
        if c["id"] == card_id:
            raise ProposalError(f"esiste gia' una carta con id `{card_id}` (carta duplicata)")
        if (c["lang"], c["setId"], c["localId"]) == (lang, set_id, p["localId"]):
            raise ProposalError(
                f"nel set `{set_id}` ({lang}) il numero `{p['localId']}` e' gia' usato dalla carta `{c['id']}`")
    card = {"id": card_id, "lang": lang, "setId": set_id, "localId": p["localId"], "name": p["name"]}
    for key in ("category", "rarity", "illustrator", "types", "hp", "variants", "description"):
        if p[key] is not None:
            card[key] = p[key]
    images = {"front": f"catalog/images/{lang}/{card_id}/front.webp"}
    if p["hasBack"]:
        images["back"] = f"catalog/images/{lang}/{card_id}/back.webp"
    card["images"] = images
    card["source"] = {"issue": issue_number, "approvedAt": utc_iso(now)}
    if new_set:
        doc["sets"].append(new_set)
    doc["cards"].append(card)
    doc["updatedAt"] = utc_iso(now)
    sort_catalog(doc)
    return card, new_set


# ---------------------------------------------------------------- images

def convert_to_webp(jpeg_bytes, label="foto"):
    """JPEG bytes -> WebP bytes: orientation applied, max 1200 px long side, q85, no EXIF/ICC."""
    from PIL import Image, ImageOps  # lazy: not needed by the `proposal-id` command
    try:
        img = Image.open(io.BytesIO(jpeg_bytes))
        if img.format != "JPEG":
            raise ProposalError(f"{label}: il file non e' un JPEG (formato {img.format})")
        img.load()
    except ProposalError:
        raise
    except Exception as e:
        raise ProposalError(f"{label}: immagine illeggibile ({type(e).__name__})")
    img = ImageOps.exif_transpose(img)  # bake the rotation in, since the EXIF is dropped
    img = img.convert("RGB")
    img.thumbnail((MAX_SIDE, MAX_SIDE), Image.LANCZOS)
    out = io.BytesIO()
    img.save(out, "WEBP", quality=WEBP_QUALITY, method=6, exif=b"", icc_profile=None)
    return out.getvalue()


def read_photo(photos_dir, rel, label):
    path = os.path.join(photos_dir, rel)
    if not os.path.isfile(path):
        raise ProposalError(f"{label} mancante sul branch `proposals` ({rel})")
    with open(path, "rb") as f:
        data = f.read()
    if len(data) > 5 * 1024 * 1024:
        raise ProposalError(f"{label} troppo grande")
    return data


# ---------------------------------------------------------------- main flow

def approve(body, issue_number, root, photos_dir, now=None):
    """Full approval. Returns (card_id, proposal_id). Writes nothing unless everything checked out."""
    now = now or datetime.now(timezone.utc)
    p = validate_proposal(parse_issue_body(body))
    path = os.path.join(root, CATALOG)
    try:
        with open(path, encoding="utf-8") as f:
            doc = json.load(f)
        if doc.get("formatVersion") != 1 or not isinstance(doc.get("sets"), list) \
                or not isinstance(doc.get("cards"), list):
            raise ValueError
    except (OSError, ValueError):
        raise ProposalError("il catalogo attuale non e' leggibile (errore di sistema, non della proposta)")
    card, _ = add_to_catalog(doc, p, issue_number, now)
    blobs = {"front": convert_to_webp(read_photo(photos_dir, f"proposals/{p['proposalId']}/front.jpg", "foto fronte"), "foto fronte")}
    if p["hasBack"]:
        blobs["back"] = convert_to_webp(read_photo(photos_dir, f"proposals/{p['proposalId']}/back.jpg", "foto retro"), "foto retro")
    for side, data in blobs.items():
        dest = os.path.join(root, card["images"][side])
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest, "wb") as f:
            f.write(data)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(dump_catalog(doc))
    return card["id"], p["proposalId"]


# ---------------------------------------------------------------- name suggestions

def validate_english_name(name):
    """Return the English name or raise ProposalError. Same rules as the Worker: 1-100 chars, Latin/Greek
    letters, ASCII digits and basic punctuation, no links."""
    if not isinstance(name, str):
        raise ProposalError("`english` deve essere una stringa")
    name = unicodedata.normalize("NFC", name.strip())
    if not 1 <= len(name) <= 100:
        raise ProposalError("`english` deve avere tra 1 e 100 caratteri")

    def ok(c):
        if c in ENGLISH_PUNCT:
            return True
        if c in "0123456789":
            return True
        if unicodedata.category(c).startswith("L"):
            return unicodedata.name(c, "").startswith(("LATIN", "GREEK"))
        return False

    if not all(ok(c) for c in name) or not (name[0].isalnum() and ok(name[0])):
        raise ProposalError("`english` ammette solo lettere latine, cifre e punteggiatura semplice")
    if re.search(r"://|www\.|\b[\w-]+\.(com|net|org|io|dev|app|me|it|co|gg|ly|xyz|info|biz|ru|cn|jp)\b", name, re.I):
        raise ProposalError("`english` non puo' contenere link")
    return name


def parse_name_issue_body(body):
    """Return the name-suggestion dict found in the issue body (marker + ```json name-suggestion block)."""
    if not isinstance(body, str) or not body.strip():
        raise ProposalError("il corpo della issue e' vuoto")
    body = body.replace("\r\n", "\n").replace("\r", "\n")
    pos = body.find(NAME_MARKER)
    if pos < 0:
        raise ProposalError(f"manca il marcatore `{NAME_MARKER}` all'inizio del corpo")
    m = NAME_FENCE_RE.search(body, pos + len(NAME_MARKER))
    if not m:
        raise ProposalError("manca il blocco ```json name-suggestion ... ``` dopo il marcatore")
    try:
        data = json.loads(m.group(1))
    except json.JSONDecodeError as e:
        raise ProposalError(f"JSON non valido nel blocco `json name-suggestion` (riga {e.lineno}, colonna {e.colno}: {e.msg})")
    if not isinstance(data, dict):
        raise ProposalError("il blocco `json name-suggestion` deve contenere un oggetto JSON")
    return data


def validate_name_suggestion(data):
    if data.get("formatVersion") != 1 or isinstance(data.get("formatVersion"), bool):
        raise ProposalError("`formatVersion` deve essere 1")
    target = data.get("target")
    if target not in ("set", "card"):
        raise ProposalError(f"`target` non valido: {target!r} (set o card)")
    lang = data.get("lang")
    if lang not in LANGS:
        raise ProposalError(f"`lang` non valida: {lang!r} (ammesse: {' '.join(LANGS)})")
    id_ = data.get("id")
    if not isinstance(id_, str) or not NAME_ID_RE.match(id_):
        raise ProposalError(f"`id` non valido: {id_!r}")
    original = _str(data, "original", required=True, max_len=100)
    proposal_id = data.get("proposalId")
    if not isinstance(proposal_id, str) or not re.match(r"^n-\d{8}-[0-9a-f]{8}$", proposal_id):
        raise ProposalError("`proposalId` mancante o non valido (atteso n-YYYYMMDD-<8 hex>)")
    return {"target": target, "lang": lang, "id": id_, "original": original,
            "english": validate_english_name(data.get("english")), "proposalId": proposal_id}


def empty_overrides():
    return {"version": 1, "sets": {}, "cards": {}}


def load_overrides(path):
    """Read name-overrides.json; a missing file is an empty document."""
    if not os.path.exists(path):
        return empty_overrides()
    try:
        with open(path, encoding="utf-8") as f:
            doc = json.load(f)
    except (OSError, ValueError):
        raise ProposalError("`catalog/name-overrides.json` non e' leggibile (errore di sistema, non della proposta)")
    if not isinstance(doc, dict) or doc.get("version") != 1 or not isinstance(doc.get("sets"), dict) \
            or not isinstance(doc.get("cards"), dict):
        raise ProposalError("`catalog/name-overrides.json` ha un formato non valido (errore di sistema)")
    return doc


def dump_overrides(doc):
    """Stable output: keys sorted at every level below the top, top-level order version/sets/cards."""
    out = {"version": 1}
    for kind in ("sets", "cards"):
        out[kind] = {lang: {k: doc[kind][lang][k] for k in sorted(doc[kind][lang])} for lang in sorted(doc[kind])}
    return json.dumps(out, indent=2, ensure_ascii=False) + "\n"


def approve_name(body, root):
    """Apply a name suggestion; the later approval for the same (kind, lang, id) replaces the earlier one.
    Returns (kind, lang, id, english, proposal_id). Writes nothing unless everything checked out."""
    p = validate_name_suggestion(parse_name_issue_body(body))
    path = os.path.join(root, NAME_OVERRIDES)
    doc = load_overrides(path)
    kind = "sets" if p["target"] == "set" else "cards"
    doc[kind].setdefault(p["lang"], {})[p["id"]] = p["english"]
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(dump_overrides(doc))
    return kind, p["lang"], p["id"], p["english"], p["proposalId"]


def _load_body(path):
    with open(path, encoding="utf-8") as f:
        text = f.read()
    try:
        ev = json.loads(text)
        if isinstance(ev, dict) and isinstance(ev.get("issue"), dict):
            return ev["issue"].get("body") or ""
    except ValueError:
        pass
    return text


def _set_output(name, value):
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a", encoding="utf-8") as f:
            f.write(f"{name}={value}\n")


def main(argv=None):
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("approve")
    a.add_argument("--body-file", required=True)
    a.add_argument("--issue", type=int, required=True)
    a.add_argument("--photos-dir", required=True)
    a.add_argument("--root", default=os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    a.add_argument("--error-file")
    n = sub.add_parser("approve-name")
    n.add_argument("--body-file", required=True)
    n.add_argument("--root", default=os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    n.add_argument("--error-file")
    c = sub.add_parser("proposal-id")
    c.add_argument("--body-file", required=True)
    args = ap.parse_args(argv)
    try:
        body = _load_body(args.body_file)
        if args.cmd == "proposal-id":
            pid = parse_issue_body(body).get("proposalId")
            if not isinstance(pid, str) or not PROPOSAL_ID_RE.match(pid):
                raise ProposalError("`proposalId` mancante o non valido")
            print(pid)
            _set_output("proposal_id", pid)
            return 0
        if args.cmd == "approve-name":
            kind, lang, id_, english, pid = approve_name(body, args.root)
            print(f"{lang}/{id_} {english}")
            _set_output("name_key", f"{lang}/{id_}")
            _set_output("english", english)
            _set_output("proposal_id", pid)
            return 0
        card_id, pid = approve(body, args.issue, args.root, args.photos_dir)
    except ProposalError as e:
        msg = str(e)
        print(msg, file=sys.stderr)
        if args.cmd in ("approve", "approve-name") and args.error_file:
            with open(args.error_file, "w", encoding="utf-8") as f:
                f.write(msg)
        return 1
    print(f"{card_id} {pid}")
    _set_output("card_id", card_id)
    _set_output("proposal_id", pid)
    return 0


if __name__ == "__main__":
    sys.exit(main())
