# Push 3 User Mode → pravi MIDI kontroler

*(English: [README.en.md](README.en.md) · pisanje add-ona: [docs/ADDONS.md](docs/ADDONS.md))*

Max for Live device + editor koji od Push 3 **User moda** radi potpuno podesiv MIDI kontroler
(u stilu Novation Components / Launchpad Pro custom modea):

- **svaki pad, gumb, enkoder, jog i touch strip** možeš mapirati u editoru na računalu
- **čiste poruke**: u User modu se MPE (X/Y/Z poruke po kanalima) automatski isključi, a kad izađeš iz User moda vrati se točno ona postavka koju je Push imao
- **sve ide na kanal koji odabereš** (po stranici), na virtualni MIDI port **`Push3 UM`**
- **momentary / toggle / trigger** za svaki gumb i pad, radio grupe (jedan uključen u grupi)
- **boje i animacije** (pulsiranje/blinkanje) za uključeno i isključeno stanje
- **povratna informacija iz Livea**: ako nešto mutiraš drugim kontrolerom, LED na Pushu to pokaže; enkoderi prate vrijednost parametra (bez skokova)
- **stranice (do 16)**: gornji red gumba bira stranice 1–8, svaka stranica ima svoj kanal i boju
- **Rack varijacije**: padovi direktno pozivaju varijacije racka (odabrani track ili po imenu; rack po imenu, `first` ili `#2` = drugi rack), bez MIDI mapiranja; Shift + pad sprema novu varijaciju; predložak **Varijacije (8 rackova × 8)** = do 8 redova varijacija odjednom
- **Live funkcije bez mapiranja (v0.5)**: gumb može direktno raditi Mute/Solo/Arm/Select tracka (odabrani, po broju ili imenu; LED u boji tracka), Play, Stop, Session Record, Metronom, Overdub, Tap, Undo/Redo, Capture, pokretanje scene; enkoder može direktno vrtjeti volumen/pan/send tracka, makro racka, parametar odabranog devicea ili tempo, a **ekran pokazuje pravo ime i vrijednost** (npr. „-6.0 dB")
- **Bilo koji parametar bilo kojeg devicea po imenu (v0.6)**: npr. *Record* na Record.To.Simpleru, *Device On* na Beat Repeatu, *Dry/Wet* na reverbu; gumb kao toggle / momentary / trigger, enkoder za vrijednost; traži i unutar rackova
- **Predlošci stranica (v0.6)**: *Mixer (8 trackova)*, *Odabrani track (makroi + varijacije)*, *Transport* – jedan klik u postavkama stranice
- **Clip slotovi (v0.7)**: pad pokreće/snima clip (track + scena); LED u boji clipa, pulsira dok svira, crveno blinka dok snima; *Obriši clip*, *Stop tracka*; predložak **Clip grid 8×8** (Shift + pad = obriši)
- **Shift sloj (v0.4)**: svaka kontrola može imati drugu funkciju dok držiš Shift (vlastite boje i stanje); u editoru prekidač *Normalno / Shift sloj*
- **Drži za stranicu (v0.4)**: dok držiš gumb, prikazana je druga stranica (npr. FX stranica samo dok držiš Select)
- **Izražajnost prema Liveu (v0.15)**: touch strip i pritisak prsta na padu mogu direktno pokretati Live parametar (makro, filter, send…), bez mapiranja
- **Navigacija (v0.13)**: Live radnje prethodni/sljedeći track, scena i device; predlošci **Odabrani device (8 parametara)** i **Sendovi odabranog tracka** (strelice = navigacija)
- **Shift + enkoder = 10× finije**, **krivulja velocityja** po padu (meko/linearno/tvrdo), **Panic** gumb (v0.12)
- **Enkoder kao gumbi (v0.19)**: svaki korak (ili svakih N) šalje "gore"/"dolje" – za listanje preseta, scena, clipova (jog!)
- **Više poruka s jednog gumba (v0.19)**: do 4 dodatne CC/note poruke uz glavnu
- **Izvoz/uvoz .json** (Preseti ▾) i **kopiraj/zalijepi** kontrola (Cmd+C / Cmd+V, radi i između stranica)
- **preseti**, undo/redo, MIDI monitor, popis nepoznatih kontrola (za provjeru na hardveru)

## Instalacija (jednom)

1. Skini cijelu mapu (repo) i stavi je npr. u
   `~/Music/Ableton/User Library/Presets/Audio Effects/Max Audio Effect/Push3UserMode/`
   **Mapa mora ostati cijela** (device traži `p3um-main.js`, `p3um-live.js`, `engine/` i `editor/` pored sebe).
2. Povuci **`Push3UserMode.amxd`** na bilo koji track (preporuka: **Main/Master** track, jer je to audio efekt koji samo propušta zvuk).
3. Prvi put device sam pokrene `npm install` (skine MIDI biblioteku, ~30 s, treba internet).
   Status piše *Installing components…*, a nakon toga *Ready (Live Mode)*.
   Ako zapne, klikni **Restart** na deviceu.
4. Live → **Settings → Link, Tempo & MIDI**:
   - **Ableton Push 3 User Port** (In i Out): **Track OFF, Remote OFF**. Ovaj device koristi taj port umjesto Livea.
   - **Push3 UM** In: **Track ON** (sviranje padovima), **Remote ON** (MIDI mapiranje)
   - **Push3 UM** Out: **Remote ON** (povratna informacija za LED-ice i enkodere)
5. Spremi Live set (ili ga stavi u Default Set) da device bude uvijek tu.
6. U editoru **Postavke → Provjera** pokazuje ✓ za sve što radi i točno što uključiti za ono što ne radi.

## Korištenje

- Na Pushu pritisni **User**: LED-ice se odmah iscrtaju prema trenutnoj stranici. Ponovno **User** = nazad na normalni Push.
- **Editor**: klik na **Editor** na deviceu (otvara se prozor u Liveu) ili **Browser** (otvara http://127.0.0.1:47391/ u pregledniku).
- U editoru klikni kontrolu (ili je pritisni na Pushu, ako je uključeno *Prati Push*) i desno odaberi:
  funkciju (Nota / CC / Program Change / stranica / rack varijacija), broj, kanal, ponašanje, boje, animaciju.
- Više padova odabereš povlačenjem miša preko njih; *Redom…* dodijeli brojeve redom, *Pretvori u varijacije* napravi red varijacija.
- U Liveu uđi u MIDI Map mode (Cmd+M), klikni parametar i pritisni kontrolu na Pushu (u User modu). Gotovo.
- Enkoderi: zadano šalju **apsolutni CC** (0–127) i prate vrijednost iz Livea. Ako više voliš relativno, odaberi *Relativno – 2's complement* u editoru **i** isti Mapping Mode u Liveovoj statusnoj traci.
- **14-bit enkoderi** (v0.26): način *Apsolutno 14-bit* šalje par CC (npr. 20 + 52) = 16384 koraka umjesto 128. U Liveu nakon MIDI mapiranja odaberi Mapping Mode *Absolute (14-bit)*. Shift + enkoder ide u najfinijim koracima (idealno za filter, pitch, delay time).

Konfiguracija se sprema automatski u `~/Documents/Push3UserMode/config.json` (preseti u `presets/`, a najviše jednom u 10 minuta i automatske sigurnosne kopije u `backups/`, zadnjih 20).

### Editor s tableta (v0.25)
*Postavke → Pristup s tableta → Editor na mreži: Uključen.* Editor pokaže link (npr. `http://192.168.1.20:47392/?k=…`): otvori ga na tabletu u istoj Wi-Fi mreži. Link sadrži tajni ključ; *Novi ključ* poništi stari link. macOS može prvi put pitati smije li Max primati veze: dopusti. Uključiti/isključiti se može samo na računalu, a postavka se ne sprema u presete. Editor na računalu i dalje prima veze samo od sebe (web stranice drugih sajtova ne mogu upravljati tvojim Pushom).

## Zadano mapiranje

| Kontrola | Šalje |
|---|---|
| Padovi | Note 36–99 (isto kao Push), dinamički velocity, momentary |
| Gumbi | CC s istim brojem kao na Pushu, momentary |
| Enkoderi | CC 71–78, Volume CC 79, Tempo CC 14, Jog CC 70 (apsolutno) |
| Touch strip | Pitch bend |
| Gornji red (U1–U8) | odabir stranice 1–8 |
| Kanal | stranica 1 = kanal 5, stranica 2 = 6, … (mijenja se u Postavkama ili po stranici) |

## Add-oni (v0.8)

Dodatne funkcije koje nisu dio jezgre i mogu se isključiti (Postavke → Add-oni). Add-on ne može srušiti jezgru: ako baci grešku, samo ta kontrola ne radi.

- **Live Looper**: po tracku jednim gumbom *Snimi sljedeći loop* (snima u sljedeći prazni slot; drugi pritisak zatvara loop i on svira), *Play/Stop tracka*, *Poništi zadnji loop*, *Arm*, *Obriši sve loopove* (Shift + gumb, da ne obrišeš slučajno). LED blinka crveno dok snima, pulsira zeleno dok svira. Polje *Taktova* (npr. 4) = snima točno toliko taktova i sam zatvori loop (v0.21). Predložak **Looper (8 trackova)**.
- **Sampler**: *Snimi → sljedeći pad*: prvi pritisak snima s tvog mic/violin tracka u prazan slot, drugi zaustavi, a snimka se **automatski učita u sljedeći prazni Simpler u Drum Racku** (i taj pad se odabere). Npr. publika pljesne → dva pritiska → pljesak je snare na padu. Još: *Zadnji clip → sljedeći / odabrani pad*, *Snimi → odabrani pad* i *Odaberi ciljni pad* (Shift + pad bira u koji pad ide sljedeća snimka). Priprema: Drum Rack s praznim Simplerima na padovima koje želiš puniti. Snimke se učitaju kao **One-Shot** (cijeli zvuk na udarac; polje *Simpler način*: oneshot / classic / slice / keep). Nova akcija *Uredi uzorak na odabranom padu*: **Reverse, Crop, One-Shot, Classic, Slice, Warp** (v0.30; u predlošcima na gumbima ispod ekrana 1–5). Predlošci **Sampler** i **Sampler + Drum Rack 4×4** (padovi sviraju Drum Rack, Shift + pad = ciljni pad, Capture snima u njega).
- Add-oni pišu svoje stanje u **statusnoj liniji ekrana** (npr. `Seq D ▶ 5/32 traka 3 ● REC · Sampler cilj D1 · Looper VIO 3 loopa`), a gumbi ispod ekrana prikazuju ime akcije.
- **Step sekvencer**: padovi kao mreža koraka (8 traka × 8 ili 4 × 16), svira note u tempu Livea (MIDI clock), velocity = jačina udarca, Shift + pad briše traku, uzorak se pamti i nakon restarta. Spoji ga sa Samplerom: snimljeni zvukovi su na padovima Drum Racka, sekvencer ih svira. Postavi u Liveu: izlaz **Push3 UM → Sync ON**, MIDI track s **MIDI From = Push3 UM** i Drum Rackom. Predlošci **Step sekvencer**. Novo: **Drum sekvencer 16 padova + 32 koraka (+ Sampler)** – kao Pushov vlastiti: 4×4 drum padovi sviraju i odabiru traku, gornja 4 reda su 32 koraka odabrane trake, Scene 2 uključi **snimanje udaraca** (sviraš uživo dok Live svira, udarci se upisuju u najbliži korak), **swing** (50 = ravno, 66 = shuffle) se zadaje na Play gumbu, a Shift + drum pad + Capture puni taj pad novim samplom. Donji desni red (v0.27): drži **Length** + korak = duljina loopa, drži **Euclid** + korak N = N udaraca ravnomjerno raspoređenih (euklidski ritam), drži **Chance** + korak = vjerojatnost koraka 100/75/50/25 % (prigušena LED), **Double** = kopira loop i udvostruči ga. **Drži korak + enkoderi** (v0.29): enkoder 1 = velocity, 2 = vjerojatnost (5 %), 3 = duljina note; upaljeni korak se gasi na otpuštanje samo ako nisi okretao enkoder (kao na Pushu). Ekran pokazuje vrijednosti dok držiš korak.
- Novi add-on = nova mapa u `addons/` (vidi `addons/index.js` i `addons/looper/`).

## Ekran (v0.3, eksperimentalno)

Motor sam crta ekran od 960×160: imena stranica gore, oznake i vrijednosti enkodera, zadnju radnju u sredini i oznake donjih gumba s bojama LED-ica.

- U editoru je **uvijek** vidljiv pregled tog ekrana (u sredini Pusha).
- Po stranici biraš prikaz (postavke stranice → *Ekran*): **Kontrole** (enkoderi s imenima trackova/parametara i vrijednostima, gumbi s imenima trackova, tempo i ▶) ili **Veliko** (ime stranice i zadnja radnja velikim slovima, za pozornicu).
- Dok držiš Shift, ekran pokazuje Shift sloj.
- **Postavke → Push ekran → "Preuzmi ekran u User modu"**: kad uđeš u User mode, motor pokuša preuzeti USB ekran od Livea, a kad izađeš, vrati ga.
  Ako ga Live ne pusti, ništa se ne kvari: pod pregledom piše *Live drži ekran* i ostaje samo pregled u editoru.
- **Molim testiraj** i javi što piše pod pregledom ekrana u editoru (status) i što se vidi na Pushu.

## Stabilnost
Uz obične testove, **fuzz testovi** (`engine/test/fuzz.test.js`) pucaju tisuće nasumičnih konfiguracija, MIDI poruka, Live stanja i clocka kroz jezgru sa svim add-onima: ništa ne smije puknuti, sve poslano mora biti ispravan MIDI i nakon izlaska iz User moda ne smije ostati nijedna nota upaljena u Liveu (osim toggle gumba koji su namjerno upaljeni).

## Što još ne radi / ograničenja
- **Spremanje varijacije** (Shift + pad) radi samo na praznom mjestu: Live API može samo dodati novu varijaciju na kraj, ne prepisati postojeću.
- Kontrole označene **?** u editoru imaju MIDI brojeve koji još nisu potvrđeni na pravom Pushu 3 (vidi listu dolje).
- Device je testiran logikom i automatskim testovima, ali **ne na pravom Pushu 3**: prvo testiranje je kod tebe.

## Lista za testiranje (v0.11)

Osnove (iz v0.1) su potvrđene na tvom Pushu. Novo, po važnosti:

1. **Ekran**: Postavke → *Push ekran* → *Preuzmi ekran u User modu*, pa uđi u User mode. Javi što piše ispod pregleda ekrana u editoru (*prikazuje se na Pushu* ili *Live drži ekran*) i što se vidi na Pushu. Kad izađeš iz User moda, Push ekran mora opet raditi normalno.
2. **Shift sloj**: na nekom gumbu u editoru odaberi *Shift sloj* i postavi drugu funkciju; drži Shift na Pushu i probaj.
3. **Live funkcije**: predložak *Mixer (8 trackova)* na praznoj stranici, pa probaj mute (LED u boji tracka), volumen na enkoderima (ime i dB na ekranu/pregledu), scene.
4. **Varijacije (8 rackova × 8)**: predložak na tracku s više rackova.
5. **Looper**: predložak *Looper (8 trackova)*; gornji pad snimi → opet pritisni → loop svira.
6. **Sampler**: predložak *Sampler*; treba Drum Rack s praznim Simplerima. Capture: snimi → opet Capture → zvuk mora završiti na sljedećem praznom padu.
7. **Clip grid 8×8** i **Transport** predlošci.

Ako nešto ne radi, pošalji screenshot editora (Log u MIDI monitoru) i Max Console poruke koje počinju s `[p3um]` ili `p3um-live`.

## Struktura

```
Push3UserMode.amxd     Max for Live device (generira ga tools/build_device.py)
Push3UserMode.maxpat   isti patch kao običan Max patcher (rezerva)
p3um-main.js           ulaz za Node for Max (node.script)
p3um-live.js           Live API most (rack varijacije)
engine/src/            motor: push3.js (kontrole), engine.js (logika), midi-io.js, server.js, config.js, store.js
engine/test/           automatski testovi (npm test)
editor/                web editor (index.html, app.js, style.css)
docs/                  PROGRESS.md (stanje rada), ARCHITECTURE.md
```

Bez Livea: `npm install && npm start`, pa otvori http://127.0.0.1:47391/ (varijacije tada ne rade).
