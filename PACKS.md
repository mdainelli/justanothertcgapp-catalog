# Catalog packs / Pacchetti catalogo

## Italiano

Ogni settimana (lunedi' 03:17 UTC) e a richiesta (Actions, "Build catalog packs", Run workflow) la GitHub Action
[`build-packs.yml`](.github/workflows/build-packs.yml) scarica da TCGdex (`https://api.tcgdex.net/v2/{lang}/sets`,
`/sets/{id}`, `/cards/{id}`) tutti i set e le carte con il dettaglio completo, per ogni lingua elencata in
[`languages.json`](languages.json), e pubblica un pacchetto per lingua piu' un indice. Le immagini non sono incluse
(restano su TCGdex, l'app compone gli URL dal campo `image`), i prezzi nemmeno (sono in [`PRICES.md`](PRICES.md), aggiornati ogni giorno: `pricing` e' rimosso
dalle carte, e anche `updated`, che cambierebbe l'hash senza che cambi il contenuto).

Per aggiungere o togliere una lingua basta modificare `languages.json` (`{"languages":[{"code":"en"},...]}`,
codici TCGdex) e rilanciare il workflow: la lingua aggiunta viene costruita, quella tolta sparisce dall'indice e il
suo file viene cancellato dalla release.

### URL stabile (senza autenticazione)

Release GitHub con tag fisso `catalog-packs`; gli asset vengono sostituiti sul posto:

- indice: <https://github.com/mdainelli/justanothertcgapp-catalog/releases/download/catalog-packs/index.json>
- pacchetto: `https://github.com/mdainelli/justanothertcgapp-catalog/releases/download/catalog-packs/{lang}.json.gz`

(Gli URL fanno redirect a un CDN: l'app deve seguire i redirect. Il repo deve restare pubblico.)

### Indice (`index.json`)

```json
{ "schemaVersion": 1, "generated": "2026-11-23",
  "packs": [ { "lang": "en", "file": "en.json.gz", "schemaVersion": 1, "version": "2026-11-23",
               "date": "2026-11-23", "contentHash": "<sha256 del JSON non compresso>",
               "sha256": "<sha256 del file .gz>", "size": 1234567, "uncompressedSize": 12345678,
               "setCount": 200, "cardCount": 20000 } ] }
```

- `version`/`date`: giorno (UTC) dell'ultima volta in cui il contenuto di quella lingua e' cambiato. Un pacchetto
  invariato mantiene voce, versione e file: l'app scarica solo se `version` (o `sha256`) e' diverso da quello locale.
- `sha256`: hash del file `.gz` scaricato, per verificare il download. `contentHash`: hash del contenuto (e' quello
  usato per decidere se ripubblicare). `size`: byte del `.gz`.
- `schemaVersion`: versione del formato; l'app ignora i pacchetti con schema maggiore di quello che conosce.
  Cambi retrocompatibili (campi nuovi) non lo incrementano.

### Pacchetto (`{lang}.json.gz`)

JSON UTF-8 compresso con gzip, chiavi ordinate, senza spazi:

```json
{ "schemaVersion": 1, "lang": "en",
  "sets":  [ <risposta di GET /v2/{lang}/sets/{id}>, ... ],
  "cards": [ <risposta di GET /v2/{lang}/cards/{id}, senza pricing/updated>, ... ] }
```

Entrambe le liste sono ordinate per `id`. Sono le risposte TCGdex invariate (stessi nomi di campo di `Dtos.kt`
dell'app): per i set `id, name, logo, symbol, releaseDate, serie, cardCount, cards[{id, localId, name, image}]`
(piu' `abbreviation, legal`); per le carte `id, localId, name, image` (URL base, senza qualita'/estensione),
`category, rarity, illustrator, hp, types, stage, evolveFrom, regulationMark, dexId, description, variants,
attacks, abilities, weaknesses, resistances, retreat, level, suffix, energyType, trainerType, effect, set`, e tutti
gli altri campi che TCGdex aggiunge. I campi assenti mancano; `hp`, `level`, `damage` possono essere numero o stringa.

### Ripubblicazione

La Action scarica l'`index.json` pubblicato, ricostruisce tutto e carica solo le lingue il cui `contentHash` e'
cambiato (l'indice per ultimo). Se il numero di carte di una lingua scende sotto il 50% del precedente la build
fallisce senza pubblicare. Le richieste usano User-Agent proprio, 8 richieste in parallelo e ritentano 429/5xx
(TCGdex da' ~8% di 503) con backoff.

Build locale di prova: `python3 scripts/build_packs.py --only-set swsh12.5 --out /tmp/dist` (mai da pubblicare).
Test (senza rete): `python3 -m pytest scripts/tests/test_build_packs.py`.

## English

Weekly (Mondays 03:17 UTC) and on demand, the `build-packs.yml` Action downloads every set and full card details
from TCGdex for each language in `languages.json` and publishes one gzipped JSON pack per language plus an
`index.json` to the GitHub Release with the fixed tag `catalog-packs` (assets replaced in place). Stable,
auth-free URLs:

- `https://github.com/mdainelli/justanothertcgapp-catalog/releases/download/catalog-packs/index.json`
- `https://github.com/mdainelli/justanothertcgapp-catalog/releases/download/catalog-packs/{lang}.json.gz`

Follow redirects. Each index entry has `lang, file, schemaVersion, version, date, contentHash, sha256, size,
uncompressedSize, setCount, cardCount`; a language is re-uploaded only when its `contentHash` changed, otherwise
its entry (and version) is kept. Pack = `{schemaVersion, lang, sets[], cards[]}` with the unmodified TCGdex set and
card documents (cards without `pricing`/`updated`), sorted by id. No images; prices are in [PRICES.md](PRICES.md) (daily). Formats are versioned by
`schemaVersion`; additive changes keep it.
