# Contratto delle proposte (app → Worker → issue → Action)

*English summary at the bottom.*

Come una carta proposta dall'app arriva in questo repository. Implementazione del server: [`worker/`](worker/README.md).

## Flusso

1. L'app (scheda carta manuale, "Proponi al catalogo") mostra un **consenso esplicito**, ricodifica le foto
   (JPEG, max 1600 px sul lato lungo, **senza EXIF/metadati**), risolve Cloudflare Turnstile in una WebView
   servita dal Worker e invia la proposta.
2. Il Worker (Cloudflare Workers, piano gratuito) verifica tutto, salva le foto nel branch `proposals` e apre
   una issue con l'etichetta `proposta`. Non conserva altro.
3. La GitHub Action del ticket 15, all'etichetta `approvata` messa da `mdainelli`, legge la issue, converte le
   foto in WebP (max 1200 px), aggiorna `catalog/extra-cards.json` e `catalog/images/` su `main`, cancella
   `proposals/<proposalId>/` dal branch `proposals`, commenta e chiude la issue. In caso di errore commenta
   `❌ Proposta non valida: <motivo>`, lascia la issue aperta con l'etichetta `errore` e non committa mai un
   catalogo rotto. Se la issue viene chiusa senza `approvata`, le foto vengono cancellate dal branch.

## Endpoint del Worker

| Metodo e percorso | Scopo |
|---|---|
| `GET /turnstile` | Pagina HTML minima con il widget Turnstile (chiave pubblica da `TURNSTILE_SITE_KEY`). A verifica riuscita chiama `window.Android.onToken(token)`. Nessun altro script, CSP che ammette solo `challenges.cloudflare.com`. |
| `POST /v1/proposals` | Crea la proposta (multipart, vedi sotto). |
| `GET /health` | `{ "ok": true }`. |

### `POST /v1/proposals` (multipart/form-data)

| Campo | Obbligatorio | Contenuto |
|---|---|---|
| `proposal` | si | JSON della proposta (schema sotto) |
| `front` | si | `image/jpeg`, max 2 MB |
| `back` | no | `image/jpeg`, max 2 MB |
| `turnstileToken` | si | token ottenuto da `/turnstile` |
| `installHash` | si | SHA-256 esadecimale minuscolo (64 caratteri) di un UUID casuale generato dall'app per installazione; mai un id hardware |
| `consent` | si | la stringa `true`: l'utente ha dato il consenso esplicito (il Worker rifiuta senza) |

Controlli del Worker, in ordine: dimensione dichiarata, `consent`, JSON e campi della proposta (i campi
sconosciuti sono rifiutati), `installHash`, immagini (magic bytes `FF D8`, max 2 MB, **nessun segmento APP1
Exif/XMP**), Turnstile (siteverify), limite giornaliero, poi le chiamate a GitHub.

Risposta `201`: `{ "proposalId": "p-YYYYMMDD-<8 hex>", "issueNumber": 12, "issueUrl": "https://github.com/..." }`

| HTTP | `error` | Quando |
|---|---|---|
| 400 | `invalid_consent` | `consent` assente o diverso da `true` |
| 400 | `invalid_json` | `proposal` assente o non e' JSON |
| 400 | `invalid_proposal` (+ `detail`) | regole sui campi violate, campi sconosciuti |
| 400 | `invalid_install_hash`, `invalid_turnstile_token`, `invalid_request` | campo mancante/malformato, corpo non multipart |
| 400 | `invalid_image` | non e' un JPEG valido, `front` mancante |
| 400 | `invalid_image_metadata` | il JPEG contiene un segmento APP1 (Exif o XMP) |
| 403 | `turnstile_failed` | verifica Turnstile fallita (o non raggiungibile) |
| 413 | `too_large` | immagine oltre 2 MB o richiesta troppo grande |
| 429 | `daily_limit` | superato `DAILY_LIMIT` (default 3) tentativi nelle 24 ore |
| 502 | `github_error` | errore nelle chiamate a GitHub |
| 404/405 | `not_found`, `method_not_allowed` | percorso o metodo sbagliato |

Il corpo degli errori e' `{ "error": "<codice>" }` (piu' `"detail"` dove indicato).

### Limite giornaliero

KV `LIMITS`, chiave = `installHash`, valore = contatore, `expirationTtl` 86400. Un tentativo viene contato
quando Turnstile e validazione sono passati, **prima** delle chiamate a GitHub (anche se GitHub poi
fallisce: niente rimborso). Il TTL riparte a ogni tentativo contato. KV e' eventualmente consistente: il limite
e' una protezione best-effort, non un contatore esatto.

## JSON della proposta (formatVersion 1)

```json
{
  "formatVersion": 1,
  "lang": "it",
  "setId": "base1",
  "setName": "Set Base",
  "localId": "4",
  "name": "Charizard",
  "category": "Pokemon",
  "rarity": "Rara Holo",
  "illustrator": "Mitsuhiro Arita",
  "types": ["Fire"],
  "hp": 120,
  "variants": { "normal": false, "reverse": false, "holo": true, "firstEdition": false },
  "description": "Misprint ..."
}
```

- `lang`: `en fr es es-mx it pt pt-br de nl pl ru ja ko zh-tw zh-cn id th`.
- `setId`: id TCGdex del set in quella lingua, oppure `null`; `setName` e' obbligatorio se `setId` e' `null`.
- `name` 1-100 caratteri; `localId` 1-20 caratteri `[A-Za-z0-9\-/.]`; le stringhe sono rifilate (trim) e non
  possono contenere caratteri di controllo (`description` puo' andare a capo).
- `category`: `Pokemon`, `Trainer`, `Energy` o `null`. `rarity`, `illustrator`: testo libero (max 100) o `null`.
- `types`: al massimo 4 codici TCGdex inglesi (`Colorless Darkness Dragon Fairy Fighting Fire Grass Lightning
  Metal Psychic Water`). `hp`: intero 1-999 o `null`.
- `variants`: i quattro booleani sono tutti obbligatori. `description`: facoltativa, max 1000 caratteri.
- Campi sconosciuti: rifiutati. Il Worker normalizza: i campi facoltativi assenti diventano `null` / `[]`.

## Formato della issue (fisso, leggibile da macchina)

Titolo: `Proposta: <name> (<lang> · <setId oppure setName> <localId>)`, etichetta `proposta`. Corpo:

````
<!-- justanothertcgapp-proposal v1 -->
**Carta proposta**: <name> — <setName oppure setId> <localId> (<lang>)

Foto: [fronte](https://raw.githubusercontent.com/mdainelli/justanothertcgapp-catalog/proposals/proposals/<proposalId>/front.jpg) · [retro](.../back.jpg)

![fronte](<stesso url del fronte>)

```json proposal
{ ...il JSON della proposta, piu' "proposalId": "<proposalId>", "images": { "front": "proposals/<proposalId>/front.jpg", "back": "proposals/<proposalId>/back.jpg" oppure null } }
```

Per approvare aggiungi l'etichetta `approvata`.
````

Senza foto del retro la riga `Foto:` contiene solo il link al fronte e `images.back` e' `null`. L'Action legge
**solo** il blocco `json proposal` che segue il commento marcatore; il JSON e' stampato con indentazione di 2
spazi. Le foto stanno sul branch `proposals` in `proposals/<proposalId>/front.jpg|back.jpg`.
Il Worker e' coperto da un test che rilegge il blocco dal corpo della issue.

## Privacy

Il Worker non conserva nulla oltre alla issue e alle foto su GitHub: solo il contatore KV (24 ore, chiave =
hash casuale dell'installazione). Nessun log di contenuti o IP (osservabilita' disattivata), l'IP non viene
inoltrato nemmeno a Turnstile. Dettagli in [`worker/README.md`](worker/README.md).

## English summary

The app sends a multipart `POST /v1/proposals` to a Cloudflare Worker with `proposal` (JSON), `front`/`back`
(JPEG, <= 2 MB, no APP1 Exif/XMP), `turnstileToken`, `installHash` (SHA-256 hex of a random per-install UUID)
and `consent=true`. The Worker verifies Turnstile, validates, enforces `DAILY_LIMIT` (default 3 per 24 h, KV,
HTTP 429 `daily_limit`), commits the photos to the `proposals` branch and opens an issue labelled `proposta`
in the fixed format above. Approval (label `approvata`, by the owner) is handled by a GitHub Action
(ticket 15). The Worker keeps no data beyond the issue.
