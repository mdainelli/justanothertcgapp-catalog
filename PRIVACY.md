# Informativa sulla privacy

*Ultimo aggiornamento: 23 novembre 2026* · [English version below](#privacy-policy-english)

JustAnotherTCGApp è un'app gratuita e open source per gestire la propria collezione di carte collezionabili. **Nessuna pubblicità, nessun tracciamento, nessuna analisi d'uso, nessuna vendita dei dati. Di default i tuoi dati restano sul telefono.** L'account è facoltativo e serve solo a sincronizzare i dati tra più telefoni e, se attivo, ad acquistare l'abbonamento.

## In breve

- Senza account, la collezione, la wishlist e le impostazioni restano solo sul telefono.
- Con l'account (facoltativo) i dati elencati sotto vengono sincronizzati su un server nell'Unione Europea (Francoforte).
- Nessuna pubblicità, nessun analytics, nessun report automatico dei crash, nessuna profilazione.
- I dati non vengono venduti né ceduti a terzi per fini propri. Vengono trattati solo dai fornitori elencati sotto, per far funzionare l'app.
- Nessuna foto (l'app non scatta né importa foto e non chiede permessi per fotocamera o file multimediali) e nessun invio di carte o nomi al progetto.
- Puoi eliminare l'account e i dati sul server in qualsiasi momento.

## Dove stanno i tuoi dati

I dati che crei (collezione, raccoglitori, wishlist, carte inserite a mano, avvisi, impostazioni) sono salvati sul dispositivo, nel database locale `user.db` e nelle preferenze dell'app. Escono dal telefono solo se: (a) esporti tu i dati (backup, CSV) verso una destinazione che scegli; (b) hai un account e la sincronizzazione è attiva (vedi sotto); (c) usi le funzioni facoltative descritte sotto. Il backup automatico di Android è disattivato.

## Account facoltativo

Puoi usare l'app senza account. Se ne crei uno (email e password) l'app contatta un progetto **Supabase** ospitato nell'Unione Europea (regione Francoforte, Germania).

**Dati dell'account**: indirizzo email, password (non la vediamo: Supabase conserva solo un hash), data di creazione e ruolo. La sessione sul telefono è cifrata con il Keystore di Android. Le email di conferma e di reimpostazione della password sono inviate tramite Supabase.

**Cosa viene sincronizzato** mentre sei connesso: collezione (carta, variante, quantità, condizione, grading), wishlist (con condizione desiderata e nota), carte inserite a mano (solo dati, senza foto), raccoglitori e le carte che contengono, avvisi eBay (carta, prezzo massimo, tipo, stato), carte di cui segui il prezzo (non lo storico dei prezzi) e preferenze (lingua dell'app, lingue del catalogo, sito eBay, impostazioni di aggiornamento). I dati sono visibili solo a te (sicurezza a livello di riga) e restano anche sul telefono. Se esci dall'account, i dati restano sul telefono. Le connessioni usano HTTPS (cifratura in transito).

**Conservazione**: i dati dell'account e sincronizzati restano sul server finché non elimini l'account. Quando cancelli un elemento, sul server resta un segno di eliminazione (*tombstone*: la chiave dell'elemento, senza altri contenuti utili) perché la cancellazione arrivi anche agli altri tuoi telefoni; anche questi segni spariscono con l'eliminazione dell'account.

**Eliminazione**: in Impostazioni > Account > "Elimina account" cancelli subito l'utente e tutte le sue righe dal server. Se hai disinstallato l'app, puoi chiedere l'eliminazione dalla pagina pubblica <https://mdainelli.github.io/justanothertcgapp-catalog/delete-account.html>. Senza account, nulla viene inviato.

## Abbonamento (Google Play)

Le funzioni a pagamento (se attivate) si acquistano con un abbonamento tramite **Google Play Billing**. Il pagamento è gestito interamente da Google, che è soggetto alla propria informativa: noi non riceviamo il tuo metodo di pagamento. Per verificare che l'abbonamento sia attivo, l'app invia il *token di acquisto* di Google Play al servizio Cloudflare Workers del progetto, che lo verifica con le API di Google Play. Il servizio conserva solo una versione cifrata (hash) del token, in una cache di circa 10 minuti, per evitare controlli ripetuti. Non conserviamo dati di pagamento.

## Servizi di terzi (fornitori)

L'app contatta solo questi servizi:

- **Supabase** (UE, Francoforte): account e sincronizzazione, solo se crei un account.
- **Google Play** (Google): acquisto e gestione dell'abbonamento; il token di acquisto viene verificato dal nostro Worker.
- **Cloudflare** (Workers): servizio del progetto che inoltra le ricerche eBay e verifica l'abbonamento. Riceve un codice anonimo di installazione (hash SHA-256 di un identificativo casuale generato dall'app, mai un identificativo del dispositivo o pubblicitario), usato solo per il limite di richieste. Come ogni servizio web, Cloudflare vede l'indirizzo IP della richiesta.
- **eBay (API Browse)**: se crei un avviso eBay, il Worker inoltra a eBay il testo di ricerca (nome della carta, set, numero), il prezzo massimo, il tipo di annuncio e il sito eBay scelto, **senza** il codice anonimo. Si applica l'informativa di eBay. Il Worker non conserva ciò che cerchi: tiene solo un contatore giornaliero per codice anonimo e una cache dei risultati di 15 minuti. Se non crei avvisi, nessuna di queste richieste viene fatta.
- **TCGdex** (`api.tcgdex.net`, `assets.tcgdex.net`): catalogo, immagini e prezzi Cardmarket. Le richieste non contengono dati personali.
- **GitHub** (release del progetto): ospita i pacchetti del catalogo che l'app scarica. Le richieste non contengono dati personali.

Come per qualsiasi sito web, questi server vedono le normali intestazioni HTTP, compreso l'indirizzo IP. Quando tocchi il pulsante eBay o un annuncio, il tuo browser apre eBay, soggetto alla informativa di eBay. Le notifiche sono locali: nessun servizio di notifiche push di terzi.

## Nessuna foto, nessun invio di contenuti

L'app non scatta né importa foto. Le foto salvate da versioni precedenti vengono cancellate all'aggiornamento. Non esistono proposte di carte al catalogo né suggerimenti di nomi.

## I tuoi diritti

Puoi accedere ai tuoi dati nell'app, esportarli (CSV, backup), correggerli ed eliminarli. Puoi eliminare l'account come descritto sopra. Per altre richieste (accesso, rettifica, cancellazione) apri una issue (vedi Contatti).

## Backup di Android

L'app disattiva il backup automatico di Android: `user.db` non è incluso nel backup Google. Per non perdere i dati, usa le funzioni di esportazione dell'app o l'account.

## Contatti

Per domande o richieste apri una issue su <https://github.com/mdainelli/justanothertcgapp-catalog/issues> (non inserire dati personali sensibili nella issue).

---

# Privacy policy (English)

*Last updated: 23 November 2026*

JustAnotherTCGApp is a free, open-source app to manage your trading card collection. **No ads, no tracking, no analytics, no selling of data. By default your data stays on your phone.** The account is optional and only serves to sync data between several phones and, if enabled, to buy the subscription.

## In short

- Without an account, your collection, wishlist and settings stay only on your phone.
- With the (optional) account, the data listed below is synced to a server in the European Union (Frankfurt).
- No ads, no analytics, no automatic crash reporting, no profiling.
- Your data is not sold or handed to third parties for their own purposes. It is processed only by the providers listed below, to make the app work.
- No photos (the app does not take or import photos and does not ask for camera or media permissions) and no submission of cards or names to the project.
- You can delete the account and the data on the server at any time.

## Where your data lives

The data you create (collection, binders, wishlist, manually added cards, alerts, settings) is stored on the device, in the local `user.db` database and the app preferences. It leaves the phone only if: (a) you export it (backup, CSV) to a destination you choose; (b) you have an account and sync is active (see below); (c) you use the optional features described below. Android automatic backup is disabled.

## Optional account

You can use the app without an account. If you create one (email and password) the app contacts a **Supabase** project hosted in the European Union (Frankfurt, Germany region).

**Account data**: email address, password (we never see it: Supabase stores only a hash), creation date and role. The session on the phone is encrypted with the Android Keystore. Confirmation and password-reset emails are sent through Supabase.

**What is synced** while you are signed in: collection (card, variant, quantity, condition, grading), wishlist (with wanted condition and note), manually added cards (data only, no photos), binders and the cards they hold, eBay alerts (card, maximum price, type, state), followed-price cards (not the price history) and preferences (app language, catalog languages, eBay site, update settings). Only you can see the data (row-level security) and it also stays on the phone. If you sign out, the data stays on the phone. Connections use HTTPS (encryption in transit).

**Retention**: account and synced data stay on the server until you delete the account. When you delete an item, a deletion marker (*tombstone*: the item's key, with no other useful content) remains on the server so the deletion reaches your other phones; these markers are also removed when you delete the account.

**Deletion**: in Settings > Account > "Delete account" you immediately remove the user and all its rows from the server. If you have uninstalled the app, you can request deletion from the public page <https://mdainelli.github.io/justanothertcgapp-catalog/delete-account.html>. Without an account, nothing is sent.

## Subscription (Google Play)

Paid features (if enabled) are bought as a subscription through **Google Play Billing**. Payment is handled entirely by Google, which is covered by its own privacy policy: we do not receive your payment method. To check that the subscription is active, the app sends the Google Play *purchase token* to the project's Cloudflare Workers service, which verifies it with the Google Play API. The service keeps only a hashed version of the token, in a cache of about 10 minutes, to avoid repeated checks. We store no payment data.

## Third-party services (processors)

The app only contacts these services:

- **Supabase** (EU, Frankfurt): account and sync, only if you create an account.
- **Google Play** (Google): subscription purchase and management; the purchase token is verified by our Worker.
- **Cloudflare** (Workers): the project's service that forwards eBay searches and verifies the subscription. It receives an anonymous install code (SHA-256 hash of a random identifier generated by the app, never a device or advertising identifier), used only for rate limiting. Like any web service, Cloudflare sees the request's IP address.
- **eBay (Browse API)**: if you create an eBay alert, the Worker forwards to eBay the search text (card name, set, number), the maximum price, the listing type and the chosen eBay site, **without** the anonymous code. eBay's privacy policy applies. The Worker does not store what you search: it only keeps a daily counter per anonymous code and a 15-minute cache of results. If you create no alerts, none of these requests are made.
- **TCGdex** (`api.tcgdex.net`, `assets.tcgdex.net`): catalog, images and Cardmarket prices. Requests contain no personal data.
- **GitHub** (project releases): hosts the catalog packs the app downloads. Requests contain no personal data.

As with any website, these servers see standard HTTP headers, including the IP address. When you tap the eBay button or a listing, your browser opens eBay, which is covered by eBay's privacy policy. Notifications are local: no third-party push service.

## No photos, no submissions

The app does not take or import photos. Photos stored by earlier versions are deleted on update. There are no catalog proposals and no name suggestions.

## Your rights

You can view your data in the app, export it (CSV, backup), correct it and delete it. You can delete the account as described above. For other requests (access, rectification, erasure) open an issue (see Contact).

## Android backup

The app disables Android automatic backup: `user.db` is not included in the Google backup. To avoid losing data, use the app's export features or the account.

## Contact

For questions or requests open an issue at <https://github.com/mdainelli/justanothertcgapp-catalog/issues> (do not put sensitive personal data in the issue).
