# Catalog prices / Prezzi catalogo

## Italiano

Ogni giorno (00:41 UTC, dopo l'aggiornamento prezzi di TCGdex delle ~22:16 UTC) e a richiesta (Actions, "Build catalog
prices", Run workflow) la GitHub Action [`build-prices.yml`](.github/workflows/build-prices.yml) legge da TCGdex
(`https://api.tcgdex.net/v2/{lang}/cards/{id}`, campo `pricing`) i prezzi Cardmarket (EUR) e TCGplayer (USD) di ogni
carta e li pubblica in piccoli file JSON gzip, uno per set, cosi' l'app scarica i prezzi da qui invece di chiamare
TCGdex carta per carta. Se i file mancano, l'app ripiega su TCGdex. I file non contengono alcun dato utente.

### URL (senza autenticazione)

- indice stabile (release `catalog-prices`, sostituito sul posto): <https://github.com/mdainelli/justanothertcgapp-catalog/releases/download/catalog-prices/prices-index.json>
- file di un set: `https://github.com/mdainelli/justanothertcgapp-catalog/releases/download/{tag}/{file}`, con `tag` e `file` presi dall'indice

(Gli URL fanno redirect a un CDN: l'app deve seguire i redirect. Il repo deve restare pubblico.) I file stanno in una
prerelease datata `prices-YYYY-MM-DD`; l'indice viene caricato per ultimo, cosi' non punta mai a file mancanti. Restano
le 3 release piu' recenti piu' quella dell'indice corrente, le altre vengono cancellate.

### Gruppi

I codici di `languages.json` sono raggruppati: ogni lingua asiatica (`ja, ko, zh-tw, zh-cn, th, id`) e' un gruppo con il
proprio nome (gli id giapponesi possono coincidere con quelli internazionali, es. `neo1`, ma sono carte diverse); tutte
le altre lingue formano il gruppo `intl` (i prezzi sono gli stessi in en e it). Per un gruppo si uniscono i set e le
carte di tutte le sue lingue e ogni carta viene chiesta una volta sola, alla prima lingua (nell'ordine di
`languages.json`) che la elenca.

### Indice (`prices-index.json`)

```json
{ "schemaVersion": 1, "date": "2026-11-25", "tag": "prices-2026-11-25",
  "groups": { "intl": { "langs": ["en", "it"], "sets": { "swsh3": "intl-swsh3.json.gz" } },
              "ja":   { "langs": ["ja"], "sets": { "SV1S": "ja-SV1S.json.gz" } } },
  "cardCount": 43000, "pricedCount": 40000 }
```

I nomi file sono `{gruppo}-{setId}.json.gz` con i caratteri fuori da `[A-Za-z0-9._-]` sostituiti da `_` (e `-2`, `-3` in
caso di doppioni senza distinzione maiuscole/minuscole): usare sempre il nome scritto nell'indice.

### File di set (`{gruppo}-{setId}.json.gz`)

JSON UTF-8 gzip, chiavi ordinate, senza spazi:

```json
{ "schemaVersion": 1, "group": "intl", "set": "swsh3", "date": "2026-11-25",
  "cards": { "swsh3-1": { "cardmarket": { "updated": "...", "unit": "EUR", "avg": 2.03, "low": 0.95, "trend": 2.17,
                                          "avg1": 3.38, "avg7": 2.12, "avg30": 2.01, "avg-holo": 0.47 },
                          "tcgplayer": { "updated": "...", "unit": "USD",
                                         "holofoil": { "lowPrice": 0.71, "midPrice": 1.55, "highPrice": 4321, "marketPrice": 1.32 } } },
             "swsh3-2": null } }
```

Ogni carta del set e' presente; `null` = nessun prezzo. Rispetto a TCGdex sono tolti `idProduct`/`productId` e i campi
`null`; un fornitore senza numeri sparisce, e senza fornitori la carta e' `null`. Una carta senza endpoint (404) e' `null`.
`schemaVersion` cresce solo per cambi non retrocompatibili.

### Sicurezza

Se oltre il 2% delle richieste carta di un gruppo fallisce (dopo i tentativi) o se `pricedCount` scende sotto il 50% di
quello pubblicato, la build termina con errore e non pubblica nulla. Richieste: User-Agent proprio, 8 in parallelo,
retry con backoff su 429/5xx. Circa 43.000 richieste al giorno.

### Fonte

Prezzi da [TCGdex](https://tcgdex.dev) (Cardmarket, TCGplayer): vanno attribuiti a loro. Build locale di prova:
`python3 scripts/build_prices.py --only-set swsh3 --out /tmp/prices` (mai da pubblicare). Test (senza rete):
`python3 -m pytest scripts/tests/test_build_prices.py`.

## English

Every day (00:41 UTC, after TCGdex's ~22:16 UTC price update) and on demand, the `build-prices.yml` Action reads the
Cardmarket (EUR) and TCGplayer (USD) prices of every card from TCGdex (`/v2/{lang}/cards/{id}`, `pricing` field) and
publishes them as small gzipped JSON files, one per set, so the app downloads prices from here instead of calling
TCGdex per card. If the files are missing, the app falls back to TCGdex. The files contain no user data.

- Stable index (release `catalog-prices`, replaced in place): `https://github.com/mdainelli/justanothertcgapp-catalog/releases/download/catalog-prices/prices-index.json`
- Set file: `https://github.com/mdainelli/justanothertcgapp-catalog/releases/download/{tag}/{file}` (`tag` and `file` come from the index). Follow redirects.
- Files live in a dated prerelease `prices-YYYY-MM-DD`; the index is uploaded last. The 3 newest dated releases plus the one the index points to are kept.
- Groups: each Asian language (`ja, ko, zh-tw, zh-cn, th, id`) is its own group (Japanese ids can collide with international ones such as `neo1`); every other language is in `intl`. A group's cards are the union of its languages' sets, each card fetched once from the first language listing it.
- Index: `{schemaVersion, date, tag, groups: {name: {langs[], sets: {setId: file}}}, cardCount, pricedCount}`. Always use the file names from the index (unsafe characters become `_`).
- Set file: `{schemaVersion, group, set, date, cards: {cardId: pricing | null}}` with every card of the set; `pricing` is TCGdex's `pricing` without product ids and null fields, `null` when there is no price.
- Safety: the build fails and publishes nothing if more than 2% of a group's card fetches fail or `pricedCount` falls below 50% of the published one.
- Source: prices from TCGdex (Cardmarket, TCGplayer); attribute accordingly.
