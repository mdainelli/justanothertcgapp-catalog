# justanothertcgapp-catalog

## Italiano

Catalogo extra di [JustAnotherTCGApp](https://github.com/mdainelli/justanothertcgapp): le carte (e gli
eventuali set) che TCGdex non ha, per esempio errori di stampa, promo rare o carte mancanti, approvate a
mano dal maintainer. L'app scarica questo file insieme al catalogo TCGdex e mostra queste carte come tutte
le altre, con un piccolo badge "Catalogo extra".

- `catalog/extra-cards.json`: il file pubblicato (formato v1).
  URL: <https://raw.githubusercontent.com/mdainelli/justanothertcgapp-catalog/main/catalog/extra-cards.json>
- `catalog/images/<lingua>/<idCarta>/front.webp` e `back.webp`: immagini delle carte.
- `schema/extra-cards.schema.json`: JSON Schema del formato.
- [`FORMAT.md`](FORMAT.md): specifica completa (campi, regole sugli id, immagini, versioni, come la usa l'app).
- [`PROPOSALS.md`](PROPOSALS.md): contratto delle proposte dall'app (endpoint, campi, formato della issue); il
  server e' in [`worker/`](worker/README.md) (Cloudflare Worker, piano gratuito).
- `.github/workflows/validate.yml`: controlla schema, id e presenza delle immagini a ogni push e pull request.

Come si arriva qui: dall'app si propone una carta (dati e foto senza EXIF) e si apre una issue; quando il
maintainer la etichetta `approvata`, una GitHub Action aggiunge la carta al JSON e le foto alla cartella
`catalog/images/`. Non serve modificare il JSON a mano, ma si puo' fare: basta una pull request che passi
la validazione.

Nessun dato personale viene raccolto: l'app scarica solo questo file e le immagini da
`raw.githubusercontent.com`.

## English

Extra catalog for [JustAnotherTCGApp](https://github.com/mdainelli/justanothertcgapp): cards (and sets) that
TCGdex lacks, such as misprints, rare promos or missing cards, approved by hand by the maintainer. The app
downloads `catalog/extra-cards.json` together with the TCGdex catalog and shows these cards like any other,
with a small "Extra catalog" badge. The format is specified in [`FORMAT.md`](FORMAT.md) and validated by
`schema/extra-cards.schema.json`; images live under `catalog/images/<lang>/<cardId>/`. The proposal pipeline (app → Worker → issue → approval) is described in [`PROPOSALS.md`](PROPOSALS.md). An empty document is
valid and the app copes with a missing or broken file.
