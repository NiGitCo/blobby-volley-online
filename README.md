# Blobby Volley Online

Blobby Volley im Browser – online gegen Freunde (privater Raum per Einladungslink),
lokal zu zweit an einer Tastatur oder gegen den Computer (Einfach / Mittel / Schwer).

## So spielst du mit einem Freund

1. Öffne die Website.
2. Klicke auf **„Online-Spiel erstellen“**.
3. Klicke auf **„Link kopieren“**.
4. Schicke den Link deinem Freund (WhatsApp, Discord …).
5. Wartet, bis beide Spieler verbunden sind.
6. Klickt beide auf **„Bereit“**.
7. Spielt gegeneinander! Nach dem Spiel: **„Revanche“**.

**Steuerung:** Rot (links) A / D / W · Blau (rechts) Pfeiltasten · Online steuerst du
deinen Blobby mit beiden Tastengruppen · Esc = Pause (nur lokal).

## Regeln (wie Blobby Volley 2, Standardregeln)

- Fällt der Ball auf deiner Seite auf den Boden, bekommt der Gegner den Punkt und den Aufschlag.
- Höchstens 3 Ballkontakte pro Seite – der 4. Kontakt ist ein Fehler.
- Netz und Wände sind kein Fehler.
- Gewonnen hat, wer zuerst 15 Punkte mit mindestens 2 Punkten Vorsprung hat (einstellbar).

## Herkunft der Spielphysik

Physik, Kollisionen und Regeln sind eine TypeScript-Portierung des Open-Source-Spiels
[Blobby Volley 2](https://github.com/danielknobe/blobbyvolley2) (GPL-2.0-or-later):

| Wert | Quelle |
|---|---|
| Spielfeld 800 breit, Boden bei 500, Netz bei x=400 (Kugel oben bei y=284, Radius 7) | `GameConstants.h` (verifiziert) |
| Blobby aus 2 Kreisen (Radius 25 / 33), Laufgeschwindigkeit 4,5, Sprung −15,1, Schwerkraft 0,915, Sprungpuffer beim Halten | `GameConstants.h`, `PhysicWorld.cpp` (verifiziert) |
| Ball Radius 31,5, Schwerkraft 0,287, Abprallgeschwindigkeit √(0,75·800·0,287) ≈ 13,1 | `GameConstants.h`, `PhysicWorld.cpp` (verifiziert) |
| Netzkugel dämpft Ball (0,7 / 0,9), Boden 0,95 | `PhysicWorld.cpp` (verifiziert) |
| 75 Physikschritte pro Sekunde, 15 Gewinnpunkte | `data/config.xml` (verifiziert) |
| 3-Kontakte-Regel, 11 Schritte Sperre gegen Doppelzählung, Punkt + Aufschlag an Gegner | `GameLogic.cpp`, `rules/default.lua` (verifiziert) |
| Wer den allerersten Aufschlag macht (hier: Rot) | eigene Festlegung |
| Grafik, Sounds, Computergegner, Online-Netzcode | eigene Umsetzung |

Es werden **keine** Original-Grafiken oder -Sounds verwendet. Da Code-Teile aus Blobby Volley 2
portiert sind, steht dieses Projekt ebenfalls unter der **GPL-2.0-or-later** (siehe `LICENSE`).
Wer die Website betreibt, sollte den Quellcode öffentlich zugänglich halten (z. B. öffentliches GitHub-Repository).

## Technik

- `shared/` – Spiel-Engine (Physik + Regeln), Computergegner, Netzwerk-Nachrichten
- `server/` – Node.js-Server: liefert die Website aus und berechnet alle Online-Spiele (Socket.IO)
- `client/` – Browser-Spiel (TypeScript, HTML5 Canvas, Vite)
- `tests/` – automatische Tests (Engine + echter Online-Test mit zwei Verbindungen)

Der Server ist maßgeblich (berechnet Ball, Treffer, Punkte). Der Browser sagt die eigene Bewegung
voraus, damit sich die Steuerung trotz Internet-Verzögerung direkt anfühlt.

```bash
npm install
npm run build
npm start          # http://localhost:3000
npm test           # nach dem Build
```

Online-Test gegen die veröffentlichte Seite: `TEST_URL=https://deine-adresse npx tsx tests/online.test.ts`

## Veröffentlichung

`render.yaml` richtet auf [Render](https://render.com) einen kostenlosen Webservice ein
(Node.js, HTTPS, WebSockets). Hinweis: Der kostenlose Server schläft nach 15 Minuten ohne Besucher ein;
der erste Aufruf danach dauert ca. 1 Minute.
