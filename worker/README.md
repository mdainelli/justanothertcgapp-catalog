# Worker eBay (`justanothertcgapp-proposals`)

*Short English version at the bottom.*

Cloudflare Worker (TypeScript, zero dipendenze a runtime) che fa da proxy per gli avvisi eBay dell'app. Il nome
`justanothertcgapp-proposals` resta quello storico (cambiarlo creerebbe un Worker nuovo con un altro indirizzo):
le proposte di carte e di nomi sono state rimosse, il Worker non apre piu' issue ne' usa GitHub o Turnstile.

Endpoint: `GET /health`, `GET /ebay/search`, `/ebay/account-deletion` (vedi *Avvisi eBay*).

## Privacy

- Nessun log di contenuti o IP: l'osservabilita' e' disattivata in `wrangler.toml` e il codice non usa `console.*`.
- Dati conservati in KV (`LIMITS`): solo il token applicativo eBay in cache (~12 scritture al giorno).
- Il limite per installazione e' il binding Workers Rate Limiting `EBAY_RATE_LIMITER` (nessuna scrittura KV).

## Pubblicazione dal browser con GitHub Actions (consigliata)

1. **Account Cloudflare** gratuito su <https://dash.cloudflare.com/sign-up>. Apri *Workers & Pages* e scegli il
   sottodominio `workers.dev`. Il Worker sara' `https://justanothertcgapp-proposals.<sottodominio>.workers.dev`.
2. **Token Cloudflare**: icona profilo, *My Profile*, *API Tokens*, *Create Token*, modello **Edit Cloudflare Workers**,
   *Account Resources* = il tuo account, *Zone Resources* = *All zones*. L'**Account ID** e' nella home della dashboard.
3. In questo repository, *Settings*, *Secrets and variables*, *Actions*: secret `CLOUDFLARE_API_TOKEN` e
   `CLOUDFLARE_ACCOUNT_ID` (piu' i secret eBay, vedi sotto).
4. *Actions*, **Worker deploy**, *Run workflow*. Il workflow esegue i test, crea il namespace KV alla prima
   esecuzione, pubblica, imposta i secret del Worker e controlla `/health`. L'indirizzo compare nel riepilogo.
5. L'indirizzo del Worker va nella variabile `EBAY_WORKER_URL` del repository dell'app (la usa il workflow Release).

## Pubblicazione da terminale (alternativa)

```sh
cd worker
npm ci
npx wrangler login
npx wrangler kv namespace create LIMITS   # copia l'id in wrangler.toml al posto di REPLACE_WITH_KV_NAMESPACE_ID
npx wrangler deploy
curl https://<host>/health
```

## Avvisi eBay

L'app avvisa quando compaiono nuove inserzioni eBay sotto una soglia di prezzo. Le chiavi eBay stanno solo nel
Worker (mai nell'app open source). Funzione opzionale: senza chiavi `GET /ebay/search` risponde `503 not_configured`
e `/health` mostra `"ebay": false`.

1. Registrati su <https://developer.ebay.com> (gratis) e accedi al portale.
2. *Application Keys*: crea un **Production keyset** (App ID = `EBAY_CLIENT_ID`, Cert ID = `EBAY_CLIENT_SECRET`).
3. Genera un **verification token** di 32-80 caratteri (lettere, numeri, `_`, `-`), ad esempio:
   ```sh
   openssl rand -hex 24   # 48 caratteri esadecimali
   ```
4. In questo repository, *Settings*, *Secrets and variables*, *Actions*:
   - (l'App ID `EBAY_CLIENT_ID` è già in `worker/wrangler.toml`, è pubblico);
   - secret `EBAY_CLIENT_SECRET` e `EBAY_VERIFICATION_TOKEN`.
5. Lancia **Worker deploy** (*Actions*, *Run workflow*): i valori non vuoti vengono impostati sul Worker e il
   riepilogo mostra l'endpoint di cancellazione account.
6. Nel portale eBay: *Alerts & Notifications*, *Marketplace Account Deletion*. Inserisci come endpoint
   `https://justanothertcgapp-proposals.marcod.workers.dev/ebay/account-deletion` e lo **stesso verification token**,
   poi premi *Send Test Notification* e *Save*. Il Worker risponde alla sfida e restituisce `204` alle notifiche
   (non conserva dati utente eBay). Senza questo passaggio le chiavi Production non si attivano.
   Alternativa: richiedere l'esenzione (*exemption*) dalla notifica nella stessa pagina, se non si conservano dati eBay.
7. Verifica: `curl https://<host>/health` deve rispondere `{"ok":true,"ebay":true}`.

Contratto di `GET /ebay/search`: parametri `q` (2-200 caratteri), `max` (> 0 e <= 100000), `opts` (`auction`, `bin`,
`both`; default `both`), `site` (dominio eBay, default `www.ebay.it`), header `X-Install-Hash` (64 hex).
Risposta `200`: `{"items":[{"id","title","price":{"value","currency"},"buyingOptions","endTime","image","url","listedAt"}],"fetchedAt","marketplace"}`.
Errori: `400 invalid_q|invalid_max|invalid_opts|invalid_site|invalid_install_hash`, `429 rate_limited` (10 ricerche
al minuto per installazione), `503 quota_exhausted` (eBay ha risposto 429: quota di 5000 chiamate/giorno esaurita), `503 not_configured`,
`502 upstream`. I risultati identici (q, max, opts, site) sono messi in cache per 15 minuti e non contano nel limite.
Limite per installazione: binding Workers Rate Limiting `EBAY_RATE_LIMITER` (gratuito, in `wrangler.toml`).
Cache dei risultati e token eBay stanno in memoria dell'isolate (al massimo 500 voci): e' best-effort, un isolate
riciclato o parallelo puo' rifare la chiamata. Il token viene scritto in KV solo quando se ne ottiene uno nuovo (~12 scritture al giorno).

## Verifica dell'abbonamento (spenta fino al rilascio)

Quando l'app sara' a pagamento (abbonamento Google Play), `GET /ebay/search` puo' richiedere un abbonamento attivo.
L'interruttore e' la variabile `SUBSCRIPTION_CHECK_ENABLED` in `worker/wrangler.toml`: con `"false"` (predefinito)
il Worker si comporta come prima e non chiama Google. Non attivarla finche' l'app con l'abbonamento non e' pubblicata.

Come funziona quando e' `"true"`:

- l'app invia l'header `X-Play-Purchase-Token` (token d'acquisto Play); il Worker lo verifica con
  `purchases.subscriptionsv2.get` (pacchetto `io.github.mdainelli.justanothertcgapp`);
- stati accettati: `SUBSCRIPTION_STATE_ACTIVE` e `SUBSCRIPTION_STATE_IN_GRACE_PERIOD`; `ON_HOLD`, scaduto, annullato e
  in pausa non sono attivi;
- risposte: token mancante `402 subscription_required`, non attivo o non valido `403 subscription_inactive`,
  Google non raggiungibile `502 upstream`, service account mancante o errato `503 not_configured`;
- bypass amministratore: se l'app invia `Authorization: Bearer <JWT Supabase>` e la funzione RPC `my_role` risponde
  `admin`, la richiesta passa senza abbonamento (servono `SUPABASE_URL` e `SUPABASE_ANON_KEY` in `[vars]`, sono pubblici);
- i risultati si conservano in KV per 10 minuti con chiave `sha256(token)` (il token non e' mai salvato ne' scritto nei log).
  Il token di accesso Google resta in cache (memoria e KV) fino a poco prima della scadenza.

Passi per il proprietario:

1. **Google Cloud**: <https://console.cloud.google.com>, crea (o scegli) un progetto, *API e servizi*, *Libreria*,
   abilita **Google Play Android Developer API**.
2. *IAM e amministrazione*, *Account di servizio*, *Crea account di servizio* (nome ad esempio `play-verifica`, nessun
   ruolo di progetto necessario). Aprilo, scheda *Chiavi*, *Aggiungi chiave*, *Crea nuova chiave*, formato **JSON**:
   si scarica un file `.json`. Tienilo riservato.
3. **Play Console** (<https://play.google.com/console>): *Utenti e autorizzazioni*, *Invita nuovi utenti*, incolla
   l'email dell'account di servizio (`...@...iam.gserviceaccount.com`). Nelle autorizzazioni dell'app concedi
   *Visualizza i dati finanziari* e *Gestisci ordini e abbonamenti*, poi *Invita*. L'attivazione puo' richiedere
   fino a qualche ora.
4. In questo repository, *Settings*, *Secrets and variables*, *Actions*: nuovo secret `GOOGLE_PLAY_SERVICE_ACCOUNT`
   con **tutto il contenuto** del file JSON.
5. In `worker/wrangler.toml` imposta `SUPABASE_URL` e `SUPABASE_ANON_KEY` (per il bypass amministratore) e, solo al
   rilascio, `SUBSCRIPTION_CHECK_ENABLED = "true"`.
6. Lancia **Worker deploy** (*Actions*, *Run workflow*): imposta il secret sul Worker.
7. Prova: senza header `curl "https://<host>/ebay/search?q=pikachu&max=20" -H "X-Install-Hash: $(printf 'a%.0s' {1..64})"`
   deve dare `402`; con un token di un abbonato attivo `200`.

## Sviluppo

```sh
npm ci && npm test && npx tsc --noEmit
```

I test (vitest, nessuna chiamata di rete reale) coprono gli endpoint eBay `/health` e la verifica abbonamento con fetch simulato e KV
in memoria. La CI e' in `.github/workflows/worker.yml`.

## English

A zero-dependency Cloudflare Worker (free plan) that proxies the app's eBay price alerts (`/ebay/search`,
`/ebay/account-deletion`, `/health`). Card and name proposals, GitHub issues and Turnstile were removed; the
Worker keeps its historical name `justanothertcgapp-proposals` so its URL does not change. It logs nothing
(observability disabled). Optional subscription check on `/ebay/search` (`SUBSCRIPTION_CHECK_ENABLED`, off by default): requires
the `X-Play-Purchase-Token` header, verified with the Google Play Developer API (`402` missing, `403` inactive), with a Supabase admin
bypass. See the Italian steps above. Deploy: `npm ci`, `npx wrangler login`, create the KV namespace and paste its id in
`wrangler.toml`, then `npx wrangler deploy` (or run the **Worker deploy** workflow).
