# Changelog

Svaka verzija ima svoju granu `release/vX.Y.Z` na GitHubu (Code -> Download ZIP).

## v0.29.0 – 2026-10-22
Sekvencer: drži korak + enkoderi 1–3 (velocity, vjerojatnost, duljina note); add-on API: turn.

## v0.28.0 – 2026-10-22
Stabilnost: fuzz testovi; nema zaglavljenih nota (dodir enkodera, add-on padovi, toggle pri uređivanju i u grupama).

## v0.27.0 – 2026-10-22
Sekvencer: duljina loopa, Euclid, vjerojatnost koraka, Double (modifikatori u predlošku Drum sekvencer).

## v0.26.0 – 2026-10-22
14-bit enkoderi (CC par MSB + LSB, Shift = najfiniji koraci, povratna info iz Livea).

## v0.25.0 – 2026-10-22
Editor s tableta (opt-in, link s tajnim ključem); lokalni editor odbija veze s drugih web stranica.

## v0.24.0 – 2026-10-22
Ekran: status add-ona (sekvencer korak/REC, sampler cilj, looper broj loopova), imena akcija na gumbima; Looper: obriši sve (Shift).

## v0.23.0 – 2026-10-22
Sekvencer: drum padovi (sviraju, biraju traku, snimanje udaraca uživo), koraci odabrane trake, swing; predložak Drum sekvencer 16 + 32 (+ Sampler).

## v0.22.0 – 2026-10-22
Sampler: Shift + pad bira ciljni pad, Capture snima u odabrani pad; predložak Sampler + Drum Rack 4×4.

## v0.21.0 – 2026-10-22
Looper: snimanje fiksne duljine (polje Taktova) – snimi točno N taktova i sam zatvori loop.

## v0.20.0 – 2026-10-22
Dokumentacija za community: README na engleskom i vodič za pisanje add-ona (docs/ADDONS.md).

## v0.19.0 – 2026-10-22
Enkoder kao gumbi (gore/dolje koraci, npr. jog za listanje) i do 4 dodatne poruke s jednog gumba.

## v0.18.0 – 2026-10-22
Provjera postavljanja u editoru (Postavke → Provjera): Push, virtualni port, Live most, povratna info, MIDI clock, User mode – s uputom što uključiti. Verzija u zaglavlju editora.

## v0.17.0 – 2026-10-22
Step sekvencer add-on: padovi kao mreža koraka (8×8 ili 4×16), svira u tempu Livea, velocity po koraku, pamti uzorke; predlošci. Add-on API: clock, slanje nota, trajno stanje.

## v0.16.0 – 2026-10-22
Stabilnost: test cijele aplikacije, automatske sigurnosne kopije konfiguracije (zadnjih 20), mjerenje brzine (≈1 µs po događaju).

## v0.15.0 – 2026-10-22
Touch strip i pritisak na padu mogu direktno pokretati Live parametar (makro, filter, send…) bez mapiranja.

## v0.14.0 – 2026-10-22
Ekran: izbor prikaza po stranici (Kontrole / Veliko), imena trackova na enkoderima i gumbima, tempo i ▶, Shift sloj na ekranu dok držiš Shift.

## v0.13.0 – 2026-10-22
Navigacija: prethodni/sljedeći track, scena i device kao Live radnje; predlošci Odabrani device (8 parametara) i Sendovi odabranog tracka.

## v0.12.0 – 2026-10-22
Shift + enkoder = 10× finije; krivulja velocityja za padove; Panic gumb; ime racka na ekranu pri pozivu varijacije.

## v0.11.0 – 2026-10-22
Editor: izvoz/uvoz konfiguracije (.json) i kopiraj/zalijepi kontrola (Cmd+C / Cmd+V), i između stranica.

## v0.10.0 – 2026-10-22
Varijacije za više rackova: rack se bira i kao #2, #3…; predložak Varijacije (8 rackova × 8) – svaki red padova je jedan rack.

## v0.9.0 – 2026-10-22
Sampler add-on: snimi zvuk (mic/violina) i automatski ga učitaj u sljedeći prazni Simpler u Drum Racku; zadnji clip → sljedeći/odabrani pad; obavijest na ekranu; predložak Sampler.

## v0.8.0 – 2026-10-22
Add-oni: okvir (addons/, izolirani pozivi, uključi/isključi u Postavkama) i prvi add-on Live Looper — snimi sljedeći loop / zatvori loop, play/stop, poništi zadnji, arm; predložak Looper (8 trackova).

## v0.7.0 – 2026-10-22
Clip slotovi kao Live funkcija: pokreni/snimi, obriši, stop tracka; LED pokazuje stanje (boja clipa, svira, snima, čeka). Predložak Clip grid 8×8 (Shift + pad = obriši).

## v0.6.0 – 2026-10-22
Parametri bilo kojeg devicea po imenu (gumbi toggle/momentary/trigger, enkoderi), i unutar rackova — npr. Record na Record.To.Simpleru. Predlošci stranica: Mixer, Odabrani track, Transport.

## v0.5.0 – 2026-10-22
Live funkcije bez MIDI mapiranja: Mute/Solo/Arm/Select tracka (LED u boji tracka), transport, scene; enkoderi na volumen/pan/send, makro racka, parametar devicea, tempo — s imenom i vrijednošću na ekranu.

## v0.4.0 – 2026-10-22
Shift sloj: svaka kontrola može imati drugu funkciju dok držiš Shift (vlastite boje, stanje i povratna info). Nova funkcija 'Drži za stranicu'. Shift je modifikator (može se isključiti u Postavkama).

## v0.3.0 – 2026-10-22
Ekran: motor crta vlastiti ekran (stranice, enkoderi s vrijednostima, zadnja radnja, donji gumbi); pregled uživo u editoru; eksperimentalno preuzimanje Push 3 USB ekrana u User modu (Postavke → Push ekran).

## v0.2.0 – 2026-10-22
Kontrole potvrđene na hardveru (jog touch = nota 11, D-pad touch = nota 13, Lock/New/Capture/Add/Swap/Delete/Center/Tempo press); dodiri D-pada i touch stripa kao mapabilne kontrole; CLAUDE.md s pravilima rada.
