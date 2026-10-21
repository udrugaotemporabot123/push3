# Arhitektura

```
 Push 3 (User Port) ──► midi-io ──► Engine ──► virtualni port "Push3 UM" ──► Live (Track/Remote, MIDI mapiranje)
        ▲                              │  ▲                                        │
        └──── LED / sysex ◄────────────┘  └──── povratna info (Remote out) ◄────────┘
                                       │
                         editor (WebSocket, 127.0.0.1:47391)
                                       │
                 Max: node.script ◄──► js p3um-live.js (Live API: rack varijacije)
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

## Izvori

- Ableton *Push 2 MIDI and Display Interface Manual* (github.com/Ableton/push-interface): MIDI mode, LED paleta, animacije, aftertouch, touch strip.
- Push 3 manual, poglavlje 16 (User Mode).
- DrivenByMoss (Push 3 podrška za Bitwig): Push 3 CC brojevi i MPE sysex (`1E 01` / `1E 02`).
