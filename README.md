# Push 3 User Mode → pravi MIDI kontroler

Max for Live device + editor koji od Push 3 **User moda** radi potpuno podesiv MIDI kontroler
(u stilu Novation Components / Launchpad Pro custom modea):

- **svaki pad, gumb, enkoder, jog i touch strip** možeš mapirati u editoru na računalu
- **čiste poruke**: u User modu se MPE (X/Y/Z poruke po kanalima) automatski isključi, a kad izađeš iz User moda vrati se točno ona postavka koju je Push imao
- **sve ide na kanal koji odabereš** (po stranici), na virtualni MIDI port **`Push3 UM`**
- **momentary / toggle / trigger** za svaki gumb i pad, radio grupe (jedan uključen u grupi)
- **boje i animacije** (pulsiranje/blinkanje) za uključeno i isključeno stanje
- **povratna informacija iz Livea**: ako nešto mutiraš drugim kontrolerom, LED na Pushu to pokaže; enkoderi prate vrijednost parametra (bez skokova)
- **stranice (do 16)**: gornji red gumba bira stranice 1–8, svaka stranica ima svoj kanal i boju
- **Rack varijacije**: padovi direktno pozivaju varijacije racka (odabrani track ili po imenu), bez MIDI mapiranja; Shift + pad sprema novu varijaciju; može više redova i više rackova
- **Live funkcije bez mapiranja (v0.5)**: gumb može direktno raditi Mute/Solo/Arm/Select tracka (odabrani, po broju ili imenu; LED u boji tracka), Play, Stop, Session Record, Metronom, Overdub, Tap, Undo/Redo, Capture, pokretanje scene; enkoder može direktno vrtjeti volumen/pan/send tracka, makro racka, parametar odabranog devicea ili tempo, a **ekran pokazuje pravo ime i vrijednost** (npr. „-6.0 dB")
- **Bilo koji parametar bilo kojeg devicea po imenu (v0.6)**: npr. *Record* na Record.To.Simpleru, *Device On* na Beat Repeatu, *Dry/Wet* na reverbu; gumb kao toggle / momentary / trigger, enkoder za vrijednost; traži i unutar rackova
- **Predlošci stranica (v0.6)**: *Mixer (8 trackova)*, *Odabrani track (makroi + varijacije)*, *Transport* – jedan klik u postavkama stranice
- **Shift sloj (v0.4)**: svaka kontrola može imati drugu funkciju dok držiš Shift (vlastite boje i stanje); u editoru prekidač *Normalno / Shift sloj*
- **Drži za stranicu (v0.4)**: dok držiš gumb, prikazana je druga stranica (npr. FX stranica samo dok držiš Select)
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

## Korištenje

- Na Pushu pritisni **User**: LED-ice se odmah iscrtaju prema trenutnoj stranici. Ponovno **User** = nazad na normalni Push.
- **Editor**: klik na **Editor** na deviceu (otvara se prozor u Liveu) ili **Browser** (otvara http://127.0.0.1:47391/ u pregledniku).
- U editoru klikni kontrolu (ili je pritisni na Pushu, ako je uključeno *Prati Push*) i desno odaberi:
  funkciju (Nota / CC / Program Change / stranica / rack varijacija), broj, kanal, ponašanje, boje, animaciju.
- Više padova odabereš povlačenjem miša preko njih; *Redom…* dodijeli brojeve redom, *Pretvori u varijacije* napravi red varijacija.
- U Liveu uđi u MIDI Map mode (Cmd+M), klikni parametar i pritisni kontrolu na Pushu (u User modu). Gotovo.
- Enkoderi: zadano šalju **apsolutni CC** (0–127) i prate vrijednost iz Livea. Ako više voliš relativno, odaberi *Relativno – 2's complement* u editoru **i** isti Mapping Mode u Liveovoj statusnoj traci.

Konfiguracija se sprema automatski u `~/Documents/Push3UserMode/config.json` (preseti u `presets/`).

## Zadano mapiranje

| Kontrola | Šalje |
|---|---|
| Padovi | Note 36–99 (isto kao Push), dinamički velocity, momentary |
| Gumbi | CC s istim brojem kao na Pushu, momentary |
| Enkoderi | CC 71–78, Volume CC 79, Tempo CC 14, Jog CC 70 (apsolutno) |
| Touch strip | Pitch bend |
| Gornji red (U1–U8) | odabir stranice 1–8 |
| Kanal | stranica 1 = kanal 5, stranica 2 = 6, … (mijenja se u Postavkama ili po stranici) |

## Ekran (v0.3, eksperimentalno)

Motor sam crta ekran od 960×160: imena stranica gore, oznake i vrijednosti enkodera, zadnju radnju u sredini i oznake donjih gumba s bojama LED-ica.

- U editoru je **uvijek** vidljiv pregled tog ekrana (u sredini Pusha).
- **Postavke → Push ekran → "Preuzmi ekran u User modu"**: kad uđeš u User mode, motor pokuša preuzeti USB ekran od Livea, a kad izađeš, vrati ga.
  Ako ga Live ne pusti, ništa se ne kvari: pod pregledom piše *Live drži ekran* i ostaje samo pregled u editoru.
- **Molim testiraj** i javi što piše pod pregledom ekrana u editoru (status) i što se vidi na Pushu.

## Što još ne radi / ograničenja
- **Spremanje varijacije** (Shift + pad) radi samo na praznom mjestu: Live API može samo dodati novu varijaciju na kraj, ne prepisati postojeću.
- Kontrole označene **?** u editoru imaju MIDI brojeve koji još nisu potvrđeni na pravom Pushu 3 (vidi listu dolje).
- Device je testiran logikom i automatskim testovima, ali **ne na pravom Pushu 3**: prvo testiranje je kod tebe.

## Lista za prvo testiranje

1. Device se učita, status dođe do *Ready (Live Mode)*. (Ako ne: Max Console poruke `[p3um]`.)
2. Pritisni **User**: status prelazi u *USER MODE*, padovi se zasvijetle u boji stranice.
3. Otvori **MIDI monitor** u editoru i pritisni nekoliko padova: moraju ići `Push → note … ch1` i `→ Live note … ch5`, **bez** pitch bend / CC74 poruka.
4. Pritisni gumbe označene **?**: u monitoru provjeri da se pojavljuju kao poznate kontrole. Ako nešto završi pod *Nepoznate kontrole*, pošalji mi screenshot.
5. Mapiraj jedan gumb kao *Toggle CC* na Mute nekog tracka; mutiraj taj track mišem: LED na Pushu mora pratiti.
6. Pritisni **User** opet: Push se vraća u normalni mod, a pad sviranje opet ima MPE.

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
