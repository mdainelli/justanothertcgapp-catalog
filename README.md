# justanothertcgapp-catalog

## Italiano

Repository di supporto di [JustAnotherTCGApp](https://github.com/mdainelli/justanothertcgapp). Contiene solo il
Worker Cloudflare in [`worker/`](worker/README.md) (piano gratuito) che serve gli avvisi eBay dell'app
(`/ebay/search`, `/ebay/account-deletion`).

Non esistono piu' il catalogo extra, le proposte di carte, i suggerimenti di nome inglese e le relative GitHub
Action: l'app non invia piu' nulla e usa solo il catalogo TCGdex piu' i nomi giapponesi inclusi nell'app.
Non viene raccolto alcun dato personale.

## English

Support repository of [JustAnotherTCGApp](https://github.com/mdainelli/justanothertcgapp). It only holds the
Cloudflare Worker in [`worker/`](worker/README.md) (free plan) that serves the app's eBay alerts
(`/ebay/search`, `/ebay/account-deletion`). The extra catalog, card proposals, English name suggestions and
their GitHub Actions were removed: the app submits nothing any more. No personal data is collected.
