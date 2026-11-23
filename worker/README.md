# Worker delle proposte (`justanothertcgapp-proposals`)

*Short English version at the bottom.*

Cloudflare Worker (TypeScript, zero dipendenze a runtime) che riceve le carte proposte dall'app e apre una
issue su `mdainelli/justanothertcgapp-catalog`. Il contratto completo e' in [`../PROPOSALS.md`](../PROPOSALS.md).

Endpoint: `GET /turnstile` (pagina del widget per la WebView), `POST /v1/proposals`, `GET /health`.

## Cosa fa e cosa non fa (privacy)

- Verifica Turnstile, il consenso (`consent=true`), il JSON, i JPEG (magic bytes, max 2 MB, **rifiuta Exif/XMP**
  con `invalid_image_metadata`) e il limite giornaliero.
- Salva le foto nel branch `proposals` e crea la issue con etichetta `proposta`. Poi dimentica tutto.
- L'unico dato conservato e' il contatore KV: chiave = hash SHA-256 di un UUID casuale per installazione,
  valore = numero di tentativi, scadenza 24 ore. Nessun id hardware, nessun account.
- Nessun log di contenuti o IP: l'osservabilita' e' disattivata in `wrangler.toml` e il codice non usa
  `console.*`. L'IP del client non viene inoltrato a Turnstile ne' a GitHub. (Cloudflare, come ogni
  infrastruttura, vede le richieste; non c'e' modo di impedirlo.)
- Il limite e' contato dopo Turnstile e validazione, **prima** delle chiamate a GitHub: un errore GitHub
  consuma comunque un tentativo (scelta anti-abuso). KV e' eventualmente consistente, il limite e' best-effort.

## Pubblicazione dal browser con GitHub Actions (consigliata)

Non serve installare niente: tutto si fa dalla dashboard Cloudflare e da GitHub, anche dal telefono.

1. **Account Cloudflare** gratuito su <https://dash.cloudflare.com/sign-up>. Apri *Workers & Pages* e scegli il
   sottodominio `workers.dev` (es. `marco`). Il Worker sara' `https://justanothertcgapp-proposals.<sottodominio>.workers.dev`.
2. **Turnstile**: *Turnstile*, *Add widget*, hostname = `justanothertcgapp-proposals.<sottodominio>.workers.dev`,
   modalita' *Managed*. Annota **site key** e **secret key**.
3. **Token Cloudflare**: icona profilo, *My Profile*, *API Tokens*, *Create Token*, modello **Edit Cloudflare Workers**,
   *Account Resources* = il tuo account, *Zone Resources* = *All zones*. Annota il token. L'**Account ID** e' nella
   home della dashboard (menu del tuo account, *Copy account ID*).
4. **Token GitHub** fine-grained: solo questo repository, *Contents: Read and write* e *Issues: Read and write*.
5. In questo repository, *Settings*, *Secrets and variables*, *Actions*:
   - secret `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `TURNSTILE_SECRET`, `CATALOG_GITHUB_TOKEN` (il token GitHub;
     GitHub non permette secret che iniziano con `GITHUB_`, il workflow lo passa al Worker come `GITHUB_TOKEN`);
   - variabile `TURNSTILE_SITE_KEY`.
6. *Actions*, **Worker deploy**, *Run workflow*. Il workflow esegue i test, crea il namespace KV alla prima
   esecuzione, pubblica, imposta i secret del Worker e controlla `/health`. L'indirizzo compare nel riepilogo.
7. Nel repository dell'app imposta la variabile `PROPOSAL_WORKER_URL` con quell'indirizzo (la usa il workflow Release).

Per aggiornare il Worker o cambiare un secret, rilancia lo stesso workflow.

## Pubblicazione da terminale (alternativa)

Servono Node.js 22+ e un account GitHub con accesso al repository del catalogo.

1. **Account Cloudflare**: crea un account gratuito su <https://dash.cloudflare.com/sign-up>. Non serve la
   carta di credito. Scegli un sottodominio `workers.dev` quando richiesto (es. `marco`): l'indirizzo sara'
   `https://justanothertcgapp-proposals.<sottodominio>.workers.dev`.
2. **Dipendenze e login**:
   ```sh
   cd worker
   npm ci
   npx wrangler login
   ```
3. **KV**: `npx wrangler kv namespace create LIMITS`. Copia l'`id` stampato in `wrangler.toml`, al posto di
   `REPLACE_WITH_KV_NAMESPACE_ID`.
4. **Turnstile**: dashboard Cloudflare, Turnstile, *Add widget*. Come hostname metti l'host del Worker
   (`justanothertcgapp-proposals.<sottodominio>.workers.dev`), modalita' *Managed*. Copia la **site key** in
   `wrangler.toml` (`TURNSTILE_SITE_KEY`, e' pubblica) e imposta la **secret key**:
   ```sh
   npx wrangler secret put TURNSTILE_SECRET
   ```
5. **Token GitHub**: GitHub, Settings, Developer settings, *Fine-grained personal access tokens*, nuovo token:
   *Repository access* = solo `mdainelli/justanothertcgapp-catalog`; permessi *Contents: Read and write* e
   *Issues: Read and write* (Metadata read e' automatico). Scadenza a tua scelta (annota quando rinnovarlo).
   ```sh
   npx wrangler secret put GITHUB_TOKEN
   ```
6. **Etichette** nel repository del catalogo (Issues, Labels): `proposta`, `approvata`, `errore`. Senza
   `proposta` la creazione della issue fallirebbe.
7. **Deploy**: `npx wrangler deploy`. Verifica con `curl https://<host>/health` (risposta `{"ok":true}`).
8. Comunica all'app l'URL base del Worker (e quindi la pagina `/turnstile`).

Il branch `proposals` viene creato dal Worker alla prima proposta, a partire da `main`.

Limite giornaliero: variabile `DAILY_LIMIT` in `wrangler.toml` (default `"3"`). Piano gratuito: 100.000
richieste al giorno, KV 1.000 scritture al giorno (ogni proposta ne usa una: bastano per ~1.000 proposte/giorno).

## Provare con curl

Turnstile non si risolve da curl. Per un test reale apri `https://<host>/turnstile` in un browser, risolvi il
widget e leggi il token dalla console (oppure usa le chiavi di test Cloudflare in un Worker di prova: site key
`1x00000000000000000000AA`, secret `1x0000000000000000000000000000000AA`). Poi, con un JPEG senza metadati:

```sh
HASH=$(uuidgen | tr -d '\n' | sha256sum | cut -d' ' -f1)
curl -i https://<host>/v1/proposals \
  --form-string 'consent=true' \
  --form-string "installHash=$HASH" \
  --form-string "turnstileToken=<token>" \
  --form-string 'proposal={"formatVersion":1,"lang":"it","setId":null,"setName":"Promo di prova","localId":"1","name":"Prova","variants":{"normal":true,"reverse":false,"holo":false,"firstEdition":false}}' \
  -F 'front=@front.jpg;type=image/jpeg'
```

Attesi: `201` con `proposalId` e `issueUrl`. Dopo il test chiudi la issue e cancella a mano la cartella
`proposals/<id>/` dal branch `proposals`.

## Sviluppo

```sh
npm ci && npm test && npx tsc --noEmit
```

I test (vitest, nessuna chiamata di rete reale) coprono validazione, scanner JPEG, corpo della issue (stringa
esatta e andata e ritorno) e il gestore con fetch simulato e KV in memoria. La CI e' in
`.github/workflows/worker.yml`.

## English

A zero-dependency Cloudflare Worker (free plan) that turns app card proposals into GitHub issues on the
catalog repo: Turnstile check, `consent=true` required, strict JSON validation, JPEG checks (rejects Exif/XMP),
KV daily limit (`DAILY_LIMIT`, 24 h TTL, key = hashed random install id), photos committed to the `proposals`
branch, issue labelled `proposta`. It stores nothing else and logs nothing (observability disabled).
Deploy: `npm ci`, `npx wrangler login`, create the KV namespace and paste its id, create a Turnstile widget
for the workers.dev host (site key in `wrangler.toml`, `wrangler secret put TURNSTILE_SECRET`), create a
fine-grained GitHub token (catalog repo only, Contents RW + Issues RW, `wrangler secret put GITHUB_TOKEN`),
create the labels `proposta`/`approvata`/`errore`, then `npx wrangler deploy`. Contract: [`../PROPOSALS.md`](../PROPOSALS.md).
