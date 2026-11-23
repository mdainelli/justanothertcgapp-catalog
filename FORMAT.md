# Formato di `catalog/extra-cards.json` (v1)

*English summary at the bottom.*

File JSON UTF-8 (senza BOM), pubblicato in
`https://raw.githubusercontent.com/mdainelli/justanothertcgapp-catalog/main/catalog/extra-cards.json`.
Lo schema formale e' `schema/extra-cards.schema.json` (JSON Schema draft-07); i controlli che lo schema non
puo' esprimere sono in `scripts/check_extra.py`. Entrambi girano nella GitHub Action `validate.yml`.

## Documento

```json
{
  "formatVersion": 1,
  "updatedAt": "2026-11-23T10:00:00Z",
  "sets": [ /* ExtraSet */ ],
  "cards": [ /* ExtraCard */ ]
}
```

| Campo | Tipo | Obbligatorio | Note |
|---|---|---|---|
| `formatVersion` | intero | si | Oggi `1`. Vedi "Versioni". |
| `updatedAt` | stringa ISO-8601 (UTC) | si | Ultima modifica del file. Informativo. |
| `sets` | array di ExtraSet | si | Solo set che TCGdex NON ha. Puo' essere vuoto. |
| `cards` | array di ExtraCard | si | Puo' essere vuoto. |

Un documento con `sets` e `cards` vuoti e' valido ed e' lo stato iniziale. I campi sconosciuti (a ogni
livello) vengono ignorati dall'app.

## ExtraSet

Per i set che TCGdex non ha affatto. Chiave logica: (`lang`, `id`).

| Campo | Tipo | Obbl. | Note |
|---|---|---|---|
| `id` | stringa | si | Prefisso `x-`, vedi "Regole sugli id". |
| `lang` | stringa | si | Codice lingua del catalogo (vedi sotto). |
| `name` | stringa | si | Nome del set nella lingua. |
| `series` | stringa | no | Nome della serie, solo per la visualizzazione. |
| `releaseDate` | `YYYY-MM-DD` | no | Ordina l'elenco dei set e sceglie il dorso standard (soprattutto per `ja`). |
| `logo` | percorso | no | `catalog/images/<lang>/sets/<id>/logo.webp`. |
| `cardCountOfficial` | intero | no | Numero ufficiale di carte (il "/N" del numero). Se manca l'app usa il numero di carte presenti. |

## ExtraCard

Chiave logica nell'app: (`lang`, `id`).

| Campo | Tipo | Obbl. | Note |
|---|---|---|---|
| `id` | stringa | si | Globalmente univoco, prefisso `x-`, vedi sotto. |
| `lang` | stringa | si | Lingua della carta. |
| `setId` | stringa | si | O l'id di un set TCGdex nella stessa lingua (es. `base1`, `swsh3`) o l'id di un ExtraSet con la stessa `lang`. |
| `localId` | stringa | si | Numero nel set, come stampato (`4`, `004`, `SV12`, `TG05`). |
| `name` | stringa | si | Nome della carta. |
| `category` | `Pokemon` \| `Trainer` \| `Energy` | no | Senza accento. |
| `rarity` | stringa | no | Testo libero, nella lingua della carta. |
| `illustrator` | stringa | no | |
| `types` | array di stringhe | no | Tipi come mostrati nella lingua (max 4). |
| `hp` | intero | no | |
| `variants` | oggetto | no | Booleani `normal`, `reverse`, `holo`, `firstEdition`; quelli assenti valgono `false`. Se l'oggetto manca, l'app offre tutte le varianti. |
| `description` | stringa | no | Testo descrittivo / flavor text. |
| `images` | oggetto | no | `front` e `back`: percorsi relativi alla radice del repository, vedi "Immagini". |
| `source` | oggetto | no | Provenienza: `issue` (numero della issue) e `approvedAt` (ISO-8601). Scritto dalla Action. |

Una carta con `setId` di un set TCGdex che l'utente non ha (lingua non scaricata o set inesistente) viene
semplicemente ignorata dall'app.

## Regole sugli id

- Gli id di carte e set extra **iniziano per `x-`**: cosi' non possono mai coincidere con un id TCGdex
  (che non contiene mai `x-` iniziale) e l'app sa che i dettagli non vanno chiesti a TCGdex.
- Solo minuscole `a-z`, cifre e `-`; massimo 100 caratteri; regex `^x-[a-z0-9]+(-[a-z0-9]+)*$`.
- Un id di carta e' unico in tutto il file. Convenzione: `x-<lang>-<setId>-<localId>-<slug>`, ad esempio
  `x-it-base1-4-misprint`. `<slug>` descrive la particolarita' (e distingue due carte con lo stesso numero).
- Un id, una volta pubblicato, non va riusato per un'altra carta: la collezione dell'utente lo referenzia.
- In uno stesso set, la coppia (`lang`, `localId`) non puo' ripetersi.

Lingue ammesse (`lang`): `en fr es es-mx it pt pt-br de nl pl ru ja ko zh-tw zh-cn id th`.

## Immagini

- Percorsi **relativi** alla radice del repository, mai URL assoluti: l'app li risolve contro
  `https://raw.githubusercontent.com/mdainelli/justanothertcgapp-catalog/main/`. Altri host non sono ammessi.
- Carta: `catalog/images/<lang>/<idCarta>/front.webp` e `back.webp`.
  Logo di un set extra: `catalog/images/<lang>/sets/<idSet>/logo.webp`.
- Formato **WebP**, lato lungo al massimo **1200 px**, **senza metadati EXIF** (niente posizione GPS, modello
  di telefono, data di scatto): vanno rimossi prima del commit (la pipeline di proposta lo fa).
- `front` obbligatoria in pratica (senza, l'app mostra "nessuna immagine"). `back` facoltativa: se manca
  l'app usa il dorso standard scelto dalla lingua e dall'epoca del set.
- La Action `validate.yml` controlla che ogni file referenziato esista e che il percorso corrisponda a id e
  lingua della carta.

## Versioni

- `formatVersion` e' un intero. Le modifiche **compatibili** (nuovi campi facoltativi) non cambiano la versione:
  i lettori ignorano i campi che non conoscono.
- Una modifica incompatibile incrementa `formatVersion`. Un'app che trova una versione **maggiore** di quella
  che supporta ignora il file (nessuna carta extra nuova, quelle gia' scaricate restano) finche' non viene
  aggiornata. Lo stesso vale se `formatVersion` manca o non e' un intero.
- Quando si introduce la v2, mantenere v1 pubblicato finche' le app vecchie sono in uso richiederebbe un file
  separato (`extra-cards.v2.json`); fino ad allora esiste solo la v1.

## Come la usa l'app

1. Dopo il download del catalogo TCGdex di ogni lingua selezionata (e nel controllo settimanale) l'app fa una
   GET condizionale (`If-None-Match`/ETag) del file e tiene solo set e carte della propria lingua.
2. Set e carte extra vengono salvati nel database del catalogo con origine "extra", sostituendo in una sola
   transazione le righe extra precedenti di quella lingua: **togliere una carta dal file la fa sparire** dall'app.
   Le carte che l'utente possiede restano nella sua collezione ma non si vedono finche' non tornano nel catalogo.
3. Le carte extra compaiono nella ricerca, nella vista del set (anche in un set TCGdex) e nel dettaglio, con il
   badge "Catalogo extra". I loro dettagli sono gia' tutti nel file: l'app non li chiede mai a TCGdex.
   Contano nel completamento del set a cui appartengono.
4. File assente (404), errore di rete, JSON non valido, versione non supportata: l'app non fa nulla e tiene
   le carte extra che aveva. Un documento valido ma vuoto, invece, rimuove tutte le carte extra.
   Voci singole non valide (id senza `x-`, lingua sconosciuta, campi obbligatori mancanti, id duplicato)
   vengono scartate senza invalidare le altre.

## Per chi scrive la pipeline (proposte e approvazioni)

- Una carta si aggiunge appendendo un oggetto a `cards` (e, se serve, uno a `sets`), copiando le immagini nei
  percorsi sopra e aggiornando `updatedAt`. Mantenere l'ordine dell'array stabile (append) per diff leggibili.
- Prima di committare: `npx -p ajv-cli@5.0.0 -p ajv-formats@2.1.1 ajv validate --spec=draft7 -c ajv-formats -s schema/extra-cards.schema.json -d catalog/extra-cards.json`
  e `python3 scripts/check_extra.py`. Se uno dei due fallisce, rispondere alla issue con l'errore invece di committare.

---

## English summary

`catalog/extra-cards.json` is a UTF-8 JSON document `{formatVersion, updatedAt, sets[], cards[]}` listing
maintainer-approved cards and sets that TCGdex lacks. Ids are prefixed `x-` and globally unique
(`x-<lang>-<setId>-<localId>-<slug>`); a card's `setId` is either a TCGdex set id in the same language or an
`ExtraSet` id. Images are relative repository paths (`catalog/images/<lang>/<cardId>/front.webp`, `back.webp`),
WebP, at most 1200 px on the long side, EXIF stripped. Unknown fields are ignored; a `formatVersion` greater
than the one the app supports makes the app ignore the file. A missing/malformed/unsupported file never breaks
the app (previously stored extra cards are kept); a valid empty document removes all extra cards. All fields are
documented in the tables above and enforced by `schema/extra-cards.schema.json` plus `scripts/check_extra.py`.
