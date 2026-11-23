# Informativa sulla privacy

*Ultimo aggiornamento: 23 novembre 2026* · [English version below](#privacy-policy-english)

JustAnotherTCGApp è un'app gratuita per gestire la propria collezione di carte collezionabili. È pensata per rispettare la tua privacy: **niente account, pubblicità o tracciamento, e i tuoi dati restano sul telefono**. Le uniche eccezioni sono le funzioni facoltative "Proponi al catalogo" (invia solo ciò che scegli di proporre, dopo il tuo consenso) e "Avvisi eBay" (invia la ricerca che imposti tu), descritte sotto.

## In breve

- Nessun account, nessuna registrazione.
- **Nessun dato viene raccolto** dallo sviluppatore.
- Nessuna analisi d'uso (analytics), nessun report automatico dei crash, nessuna pubblicità.
- Nessun dato viene venduto o condiviso con terzi.
- La tua collezione, le raccolte e la wishlist restano solo sul tuo telefono.

## Dove stanno i tuoi dati

I dati che crei (collezione, raccolte, wishlist, impostazioni) sono salvati solo sul dispositivo, nel database locale `user.db` e nelle preferenze dell'app. Escono dal telefono solo se sei tu a esportarli (backup, CSV) verso una destinazione che scegli tu.

## Connessioni di rete

L'app contatta solo questi servizi:

- **api.tcgdex.net** e **assets.tcgdex.net** (TCGdex): catalogo delle carte, immagini e prezzi Cardmarket della wishlist. Le richieste non contengono dati personali. Come per qualsiasi sito web, questi server vedono le normali intestazioni HTTP, compreso il tuo indirizzo IP.
- **raw.githubusercontent.com**: catalogo aggiuntivo del progetto (un file pubblico).
- Il tuo browser, quando tocchi il pulsante eBay o un annuncio: apre eBay, che è soggetto alla informativa di eBay. L'app stessa non comunica direttamente con eBay: lo fa solo tramite il servizio del progetto se crei un avviso (vedi sotto).

### Funzione facoltativa: "Proponi al catalogo"

Da una carta inserita a mano puoi proporla al catalogo condiviso. L'invio parte **solo dopo il tuo consenso esplicito** e contiene **solo**: i dati della carta, le foto fronte/retro ricodificate senza metadati (niente EXIF né posizione), un codice anonimo di installazione (hash SHA-256 di un identificativo casuale generato dall'app, mai un identificativo del dispositivo) usato solo per il limite di 3 proposte al giorno, e il token della verifica anti-bot Cloudflare Turnstile.
I dati passano da un piccolo servizio su Cloudflare Workers che non conserva log né indirizzi IP: il codice anonimo resta al massimo 24 ore per il limite giornaliero. La proposta diventa una issue **pubblica** nel repository <https://github.com/mdainelli/justanothertcgapp-catalog>, con le foto. La verifica Turnstile è soggetta all'informativa di Cloudflare.

Analogamente, dalla schermata di un set o di una carta giapponese puoi **suggerire il nome inglese** ("Suggerisci nome inglese"). Anche questo parte solo dopo il tuo consenso esplicito e contiene **solo**: il nome giapponese, l'identificativo del set o della carta, la lingua, il nome inglese che hai scritto, lo stesso codice anonimo di installazione (con un proprio limite giornaliero) e il token Turnstile; nessuna foto. Diventa una issue **pubblica** nello stesso repository; se approvato, compare nell'app per tutti. L'app scarica periodicamente da `raw.githubusercontent.com` l'elenco dei nomi approvati (sola lettura, non invia nulla).

### Funzione facoltativa: "Avvisi eBay"

Se crei un avviso eBay per una carta della wishlist, l'app controlla periodicamente (circa ogni ora, in background) se ci sono nuovi annunci sotto il prezzo massimo che hai scelto. A ogni controllo invia al servizio Cloudflare Workers del progetto **solo**: il testo di ricerca (nome della carta, set e numero), il prezzo massimo, il tipo di annuncio (asta / Compralo subito), il sito eBay scelto nelle impostazioni e il codice anonimo di installazione descritto sopra. Il servizio inoltra la ricerca (**senza** il codice anonimo) all'API Browse di eBay, soggetta all'informativa di eBay.
Il servizio non conserva nulla di ciò che cerchi: tiene solo un contatore giornaliero per codice anonimo, usato per il limite di richieste, e una cache dei risultati di 15 minuti. L'elenco degli avvisi e degli annunci già visti resta solo sul telefono, in `user.db`. Se non crei avvisi, nessuna di queste richieste viene fatta. Le notifiche sono locali: nessun servizio di notifiche push di terzi.

## Backup di Android

L'app disattiva il backup automatico di Android (`allowBackup="false"` e regole di esclusione per il trasferimento dati): il database `user.db` non viene incluso nel backup Google e resta solo sul telefono. Per non perdere i dati, usa le funzioni di esportazione dell'app.

## Contatti

Per domande o segnalazioni apri una issue su <https://github.com/mdainelli/justanothertcgapp-catalog/issues>.

---

# Privacy policy (English)

*Last updated: 23 November 2026*

JustAnotherTCGApp is a free app to manage your trading card collection. It is designed to respect your privacy: **no accounts, ads or tracking, and your data stays on your phone**. The only exceptions are the optional "Propose to catalog" feature (it sends only what you choose to propose, after your consent) and "eBay alerts" (it sends the search you set up), both described below.

## In short

- No account, no sign-up.
- **No data is collected** by the developer.
- No analytics, no automatic crash reporting, no ads.
- No data is sold or shared with anyone.
- Your collection, binders and wishlist stay only on your phone.

## Where your data lives

The data you create (collection, binders, wishlist, settings) is stored on the device only, in the local `user.db` database and the app preferences. It leaves the phone only if you export it yourself (backup, CSV) to a destination you choose.

## Network requests

The app only contacts:

- **api.tcgdex.net** and **assets.tcgdex.net** (TCGdex): card catalog, images and Cardmarket wishlist prices. Requests contain no personal data. As with any website, these servers see standard HTTP headers, including your IP address.
- **raw.githubusercontent.com**: the project's extra catalog (a public file).
- Your browser, when you tap the eBay button or a listing: it opens eBay, which is covered by eBay's own privacy policy. The app does not talk to eBay directly: it only does so through the project's service if you create an alert (see below).

### Optional feature: "Propose to catalog"

From a manually added card you can propose it to the shared catalog. It is sent **only after your explicit consent** and contains **only**: the card data, the front/back photos re-encoded without metadata (no EXIF or location), an anonymous install code (SHA-256 hash of a random identifier generated by the app, never a device identifier) used only for the limit of 3 proposals per day, and the Cloudflare Turnstile anti-bot token.
The data goes through a small Cloudflare Workers service that keeps no logs or IP addresses: the anonymous code is kept for at most 24 hours for the daily limit. The proposal becomes a **public** issue in <https://github.com/mdainelli/justanothertcgapp-catalog>, with the photos. The Turnstile check is covered by Cloudflare's privacy policy.

Likewise, from the screen of a Japanese set or card you can **suggest the English name** ("Suggest English name"). It is also sent only after your explicit consent and contains **only**: the Japanese name, the identifier of the set or card, the language, the English name you typed, the same anonymous install code (with its own daily limit) and the Turnstile token; no photos. It becomes a **public** issue in the same repository; if approved, it appears in the app for everyone. The app periodically downloads the list of approved names from `raw.githubusercontent.com` (read-only, it sends nothing).

### Optional feature: "eBay alerts"

If you create an eBay alert for a wishlist card, the app periodically checks (about every hour, in the background) for new listings under the maximum price you chose. Each check sends to the project's Cloudflare Workers service **only**: the search text (card name, set and number), the maximum price, the listing type (auction / Buy It Now), the eBay site chosen in settings and the anonymous install code described above. The service forwards the search (**without** the anonymous code) to eBay's Browse API, which is covered by eBay's privacy policy.
The service stores nothing about what you search: it only keeps a daily counter per anonymous code, used for rate limiting, and a 15-minute cache of results. The list of your alerts and of the listings already seen stays only on the phone, in `user.db`. If you create no alerts, none of these requests are made. Notifications are local: no third-party push service is involved.

## Android backup

The app turns off Android automatic backup (`allowBackup="false"` plus exclusion rules for device transfer): `user.db` is not included in your Google backup and stays only on the phone. To avoid losing your data, use the app's export features.

## Contact

For questions or reports, open an issue at <https://github.com/mdainelli/justanothertcgapp-catalog/issues>.
