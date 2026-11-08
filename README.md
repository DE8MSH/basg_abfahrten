# BSAG Abfahrten · Web-App für GitHub Pages

Web-Port von [DE8MSH/BSAG_Abfahrten_Display](https://github.com/DE8MSH/BSAG_Abfahrten_Display).
Komplett statische Website für PC, Smartphone und einen 480×320-Infoscreen.

**Keine GitHub Actions, kein Docker, kein Node-Server, keine geheimen Tokens, kein Backend auf GitHub erforderlich.**
Die statischen Web-Dateien werden von GitHub Pages über HTTPS ausgeliefert. Live-Abfahrten benötigen aber weiter eine erreichbare externe Datenquelle.

## Inhalt

- `index.html` – sofort benutzbare Website mit deutscher Oberfläche.
- `assets/style.css` – Layout und Display-Farben, responsiv.
- `assets/app.mjs` – Haltestellen, Favoriten, API, Live-Anzeige und Fehlerbehandlung.
- `assets/core.mjs` – portable Dateninterpretation aus der Firmware (JSON v3, VBN, Zeit).
- `assets/departures.wasm` – **echte** 516-Byte-WebAssembly-Binärdatei für Countdown/Farben.
- `wasm/departures.c` – Quellcode des WASM-Kerns (aus ESP32-Countdown-Logik portiert).
- `BAUEN_WASM.sh` – erzeugt die WASM-Datei mit `emcc` oder bei fehlendem emcc mit Clang/LLVM.
- `PRUEFEN.sh` / `TESTEN.sh` / `LOKAL_STARTEN.sh` – Linux-Mint-22-Skripte.

## GitHub Pages: Veröffentlichung im bestehenden Repository

1. Lade das ZIP herunter und **entpacke** es.
2. Öffne das Repository https://github.com/DE8MSH/BSAG_Abfahrten_Display
3. Füge den **Inhalt des entpackten Ordners** ins Stammverzeichnis deines Repositories ein (über **Add file → Upload files** oder mit `git`), **nicht den übergeordneten Ordner**. Der Original-Sketch und `config.h` bleiben bestehen.
4. Unter **Settings → Pages** bei **Build and deployment** `Deploy from a branch` auswählen; Branch `main`, Ordner `/(root)` wählen und speichern.
5. Anschließend lautet die erwartete Adresse:

   [https://de8msh.github.io/BSAG_Abfahrten_Display/](https://de8msh.github.io/basg_abfahrten/)

   Die Site existiert erst, nachdem GitHub Pages tatsächlich aktiviert und veröffentlicht wurde.

**Für diese Variante ist kein eigenes Workflow-Skript nötig.** GitHub kann für die interne Pages-Auslieferung dennoch eigene Deployment-/Buildvorgänge ausführen; das Projekt selbst enthält keine GitHub-Actions-Workflows.

Ein Direktlink zu einer Haltestelle ist zum Beispiel:

`https://de8msh.github.io/BSAG_Abfahrten_Display/?stop=Bremen%20Domsheide`

## Browser- und API-Beschränkungen

Die Original-Firmware fragt folgende JSON-API ab:

`https://dbf.finalrewind.org/Bremen%20Marschstra%C3%9Fe.json?hafas=VBN&admode=dep&rt=1&version=3`

Die Web-App verwendet denselben Host, Provider, das Echtzeitflag und die JSON-v3-Version. Zusätzlich `limit=40`, damit nach Ausfilterung abgelaufener Fahrten **bis zu 20 Abfahrten** angezeigt werden können. Im Vollbild ist die Liste scrollbar; bei weniger als sechs Fahrten bleiben bis zur ursprünglichen Mindesthöhe leere Zeilen. Der Dienst bittet um **maximal eine Anfrage pro Haltestelle pro Minute** (siehe https://dbf.finalrewind.org/). Deshalb 60-Sekunden-Takt auch beim manuellen Refresh. Countdown und Blinken laufen lokal ohne weitere Abfragen.

**Wichtig: CORS!** Ein ESP32 kann die JSON-Datei über HTTPS abrufen, ein Browser auf GitHub Pages aber nur, wenn der fremde Server einen passenden `Access-Control-Allow-Origin`-Header sendet. JavaScript oder Emscripten können CORS nicht außer Kraft setzen. Ob dieser Header in der jeweiligen Live-Antwort enthalten ist, muss im veröffentlichten Browser geprüft werden.

- Bei freigegebenem CORS: eigener blauer BSAG-Infoscreen mit Countdown/Farben, Verspätung und Ausfall.
- Bei CORS-/Netzwerk-/API-Fehler: automatische Umschaltung auf eine **eingebettete DBF-HTML-Live-Tafel**. DBF gestattet ausdrücklich die `iframe`-Einbindung. Der Tab „DBF-Ansicht“ kann auch manuell geöffnet werden.
- Falls die HTML-Seite selbst nicht erreichbar ist oder im Browser nicht eingebettet werden darf, erscheint gegebenenfalls auch dort kein Inhalt. Der Link **„Im neuen Tab öffnen“** funktioniert unabhängig von CORS.

Die App fälscht keine Echtzeitdaten und benutzt keine öffentlichen, unbekannten CORS-Proxys. Die Seite ist unabhängig von einem eigenen Server, **die Echtzeitquelle bleibt jedoch extern**.

## Lokal testen

```bash
./PRUEFEN.sh
./TESTEN.sh
./LOKAL_STARTEN.sh
```

Im Browser `http://127.0.0.1:8000/` öffnen. Eine lokale HTML-Datei mit `file://` direkt aufzurufen, ist für ES-Module/WASM wegen Browsersicherheitsregeln ungeeignet.

## WASM aus Emscripten bauen (Linux Mint 22)

Mit installiertem [Emscripten-SDK](https://github.com/emscripten-core/emscripten):

```bash
source ~/emsdk/emsdk_env.sh  # Pfad ggf. anpassen
./BAUEN_WASM.sh
./TESTEN.sh
```

Das Skript verwendet automatisch `emcc`, sofern es in `PATH` gefunden wird. Andernfalls übersetzt es den portablen C-Code über `clang --target=wasm32` (LLVM). Die im Download enthaltene und getestete WASM-Datei wurde mit Clang/LLVM 17 erzeugt, **nicht mit emcc**; sie benötigt keinerlei fremde Laufzeit oder Netzwerklibrary. Da die Kernlogik aus reinem C ohne Arduino-Aufrufe besteht, kann sie mit Emscripten neu gebaut werden. Der restliche Browser-Code (HTTP, HTML, Benutzeroberfläche) bleibt JavaScript.

## Grenzen der Portierung

- Kein 1:1-Übersetzen von Arduino-GFX, `WiFiClientSecure`, ESP32-Hardware-Touch oder PSRAM: Diese Teile sind nicht für den Browser gedacht.
- Stand 2026-11-04: Die Darstellung, WASM-Funktionen und lokale Parser sind getestet. Live-Netzwerkzugriff auf `dbf.finalrewind.org` konnte in der Build-Umgebung nicht ausgeführt werden. Deshalb kein Anspruch, dass CORS im veröffentlichten Browser funktioniert; die Fallback-Ansicht ist vorgesehen.
- Keine Garantie für Verfügbarkeit, Fahrplandaten oder Aktualität des externen privaten DBF-Dienstes.

### Quellen

- Hardware/Logik: https://github.com/DE8MSH/BSAG_Abfahrten_Display
- Emscripten: https://github.com/emscripten-core/emscripten
- Öffentliche Live-Daten und API-Hinweise: https://dbf.finalrewind.org/
