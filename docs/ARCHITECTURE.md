# Arhitektura

```
 Push 3 (User Port) ──► midi-io ──► Engine ──► virtualni port "Push3 UM" ──► Live (Track/Remote, MIDI mapiranje)
        ▲                              │  ▲                                        │
        └──── LED / sysex ◄────────────┘  └──── povratna info (Remote out) ◄────────┘
                                       │
      editor (WebSocket, 127.0.0.1:47391; opcija: LAN :47392 s tajnim ključem)
                                       │
        Max: node.script ◄──► js p3um-live.js (Live API: trackovi, parametri, clipovi, varijacije, Drum Rack / Simpler)
                                       │
                       add-oni (addons/*: looper, sampler, stepseq, xyfx)
                                       │
               ekran: vlastiti renderer 960×160 → pregled u editoru / USB (eksperimentalno)
```

## Ključne odluke

- **Motor je čisti JS s ubrizganim I/O** (`engine/src/engine.js`), pa je sva logika pokrivena testovima bez hardvera.
- **Detekcija User moda**: Push na oba porta šalje sysex odgovor `F0 00 21 1D 01 01 0A <mode> F7` kad Live promijeni mod.
  Rezerva: bilo koja poruka na User portu (osim User gumba CC 59) znači da je User mode aktivan, jer u Live modu Push na User port ne šalje ništa.
- **MPE prekidač**: na ulazu u User mode motor pita Push za aftertouch mod (`1F`), prebaci na poly (`1E 01`), a na izlazu vrati zapamćenu vrijednost (`1E 02` za MPE).
  Sysex se šalje samo kad je User mode potvrđen, da se nikad ne poremeti Live mode.
  Za svaki slučaj, MPE poruke (pitch bend, CC74, pressure na kanalima 2–16) se svejedno filtriraju u softveru.
- **LED diff cache**: ulazak u User mode jednom iscrta sve (oko 150 poruka), poslije se šalju samo promjene.
- **Stanje po stranici**: povratna informacija iz Livea ažurira i stranice koje se trenutno ne vide; promjena stranice je trenutna.
- **Ništa ne ostaje "zaglavljeno"**: promjena stranice, izlaz iz User moda i gašenje šalju note-off/off za sve što se drži.
- **Jedna instanca**: port editora (47391) služi kao lock; drugi device u setu ostaje neaktivan.
- **Portovi se skeniraju svake 2 s**: isključivanje/uključivanje Pusha ne traži restart.
- **Add-oni su odvojeni od jezgre**: svaki poziv (press/release/led/watch/clock/status/turn) je u try/catch; pokvaren add-on gasi samo svoje kontrole. Release uvijek ide mapiranju koje je dobilo press (i kad se u međuvremenu promijeni stranica, Shift ili konfiguracija).
- **Live API most je ES5** (Max `[js]`), testira se u Nodeu na lažnom Live Object Modelu (`engine/test/live-bridge.test.js`); promjene u Liveu se nikad ne rade iz callbacka promatrača (Live to zabranjuje), nego iz poruka ili Taska.
- **Fuzz testovi** (`engine/test/fuzz.test.js`): nasumične konfiguracije, MIDI, Live stanje i clock; provjerava da nema iznimki, da je sav MIDI ispravan i da nakon izlaska iz User moda nema zaglavljenih nota.
- **Sigurnost editora**: WebSocket s tuđih web stranica (Origin) se odbija; LAN pristup je isključen dok ga ne uključiš na računalu i traži ključ (cookie HttpOnly), a ne sprema se u presete.

## Izvori

- Ableton *Push 2 MIDI and Display Interface Manual* (github.com/Ableton/push-interface): MIDI mode, LED paleta, animacije, aftertouch, touch strip.
- Push 3 manual, poglavlje 16 (User Mode).
- DrivenByMoss (Push 3 podrška za Bitwig): Push 3 CC brojevi i MPE sysex (`1E 01` / `1E 02`).
