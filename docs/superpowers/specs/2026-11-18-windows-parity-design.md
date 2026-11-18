# Windows-App auf den Funktionsstand des Macs: Entwurf

**Datum:** 2026-11-18
**Stand Mac:** 1.18.1 (nach dem Upstream-Abgleich, PR #23)
**Stand Windows:** funktional auf dem Niveau von 1.6.2, Version nur mitgezogen

## Ziel

Die Windows-App (`BlitztextWin/`, Tauri v2) soll den Funktionsumfang der
macOS-App erreichen. Entschieden ist das volle Programm, also einschliesslich
Meetings und lokalem Sprachmodell.

Die Windows-App ist kein Port des Swift-Codes, sondern eine eigenstaendige App
mit gleichem Verhalten. Gemeinsam ist nur der Inhalt von `shared/`: Prompts,
Gateway-Vertrag, Konfigurationsschema. Gleichstand heisst deshalb
Verhaltensgleichheit, nicht Codegleichheit.

## Ausgangslage

Was die Windows-App heute kann: vier fest verdrahtete Workflows, Tastenkuerzel
je Workflow mit Halten oder Druecken, Tray-Popover mit zwei Ansichten, native
Aufnahme ueber `cpal` nach WAV, Transkription und Umschreiben ueber das
LiteLLM-Gateway, Einfuegen in die Vordergrund-App, Autostart, Verlauf nur
innerhalb der Sitzung, Installer aus der CI.

Was fehlt, gemessen am Mac 1.18.1:

| Bereich | Mac 1.18.1 | Windows heute |
| --- | --- | --- |
| Modi | frei anlegbare eigene Modi | vier feste Workflows |
| Einstellungen | eigenes Fenster | Ansicht im Popover |
| Verlauf | dauerhaft, 30 Eintraege, Aufbewahrungsfrist | nur Sitzung, 10 Eintraege |
| Mikrofon | auswaehlbar, Pegelpruefung | folgt dem Systemstandard |
| Transkription | lokal (Whisper, Parakeet) oder Anbieter | nur Gateway |
| Sprachmodell | lokal (MLX) oder Anbieter | nur Gateway |
| Meetings | Aufnahme, Sprechertrennung, Live-Notizen, Zusammenfassung | fehlt |
| Diktat in die Inbox | ja (Fork-Funktion) | fehlt |
| Aufnahmeanzeige | Pille am Bildschirmrand | nur Tray-Symbol |
| Tests | 369 Unit-Tests | keine |

## Technikabbildung

Der Mac stuetzt sich auf Apple-eigene Rahmenwerke, die es auf Windows nicht
gibt. Jede Zeile hier ist eine Entscheidung, keine Uebersetzung.

| Aufgabe | Mac | Windows | Begruendung |
| --- | --- | --- | --- |
| Transkription lokal | WhisperKit (CoreML) | `whisper-rs` (whisper.cpp) | Einzige ausgereifte Rust-Anbindung; GGUF-Modelle laufen auf CPU, Vulkan oder CUDA |
| Transkription schnell | Parakeet (FluidAudio, CoreML) | entfaellt | Kein Windows-Build; Whisper deckt den Fall mit |
| Sprachmodell lokal | MLX (nur Apple Silicon) | `llama-cpp-2` (llama.cpp) | Gleiche GGUF-Welt wie Whisper, eine Laufzeit fuer beides |
| Sprechertrennung | FluidAudio Diarizer | `sherpa-onnx` oder pyannote ueber `ort` | Beide liefern fertige ONNX-Modelle fuer Windows |
| Systemton aufnehmen | ScreenCaptureKit | WASAPI-Loopback ueber `cpal` | `cpal` kann Loopback auf Windows und ist bereits Abhaengigkeit |
| Schluesselablage | Keychain | Credential Manager ueber `keyring` | Bereits im Einsatz |
| Aktualisierung | Sparkle | `tauri-plugin-updater` | Bereits im Einsatz, `latest.json` liegt an den Releases |
| Symbole | SF Symbols | Lucide (SVG, eingebettet) | SF Symbols sind Apple-gebunden; Modi speichern Symbolnamen, die Zuordnung liegt in `shared/` |

## Teilprojekte

Jedes Teilprojekt ergibt fuer sich eine lauffaehige, pruefbare App. Die
Reihenfolge ergibt sich aus den Abhaengigkeiten, nicht aus dem Aufwand.

### TP1: Testfundament und eigene Modi

Zuerst, weil das Modell "Modus" alles spaeter Folgende traegt: Tastenkuerzel,
Verlauf, Inbox, Meetings-Nachbearbeitung haengen daran. Ohne Tests waere jede
weitere Stufe ein Blindflug, deshalb kommt das Testfundament in dieselbe Stufe.

Umfang: Vitest fuer TypeScript, `cargo test` fuer Rust, beides in der CI.
`CustomMode` als gemeinsames Schema in `shared/`, Ablage der Einstellungen in
einer JSON-Datei im Konfigurationsordner statt in `localStorage` (einmalige
Uebernahme der Altdaten), Modusverwaltung in der Oberflaeche, Tastenkuerzel je
Modus. Ein Modus ohne Anweisung bleibt wortwoertlich und ruft kein
Sprachmodell. Die vier eingebauten Modi bleiben eingebaut, eigene Modi kommen
dazu, wie auf dem Mac (`WorkflowType` mit `case custom(String)`). Startbestand
wie auf dem Mac: einmalig "Als E-Mail" und "Stichpunkte".

Nachlauf zu TP1, als eigener Plan: die Prompts der eingebauten Modi stammen
unter Windows noch aus der Zeit von 1.6. Der Mac 1.18 gibt ihnen zusaetzlich
`transcriptIsNotARequest`, die Rahmenregel aus `RewriteGuard`, die
Diktatregeln und englische Fassungen. Ohne diesen Nachlauf beantwortet
Blitztext+ unter Windows eine diktierte Frage, statt sie zu bearbeiten.

### TP2: Einstellungsfenster, dauerhafter Verlauf, Mikrofonauswahl

Umfang: eigenes Tauri-Fenster fuer die Einstellungen, der Popover behaelt nur
das Menue. Verlauf dauerhaft in einer Datei, 30 Eintraege, Aufbewahrungsfrist
wie auf dem Mac. Mikrofonauswahl ueber die Geraeteliste von `cpal` samt
Pegelpruefung vor der Aufnahme.

### TP3: Diktat in die Inbox

Die evia-eigene Funktion aus dem Fork. Umfang: Zielordner waehlen, Modus
festlegen, der in die Inbox schreibt, Frontmatter, Warteschlange fuer
fehlgeschlagene Schreibvorgaenge, Hinweis in der Oberflaeche. Verhalten und
Dateiformat folgen `BlitztextMac/Services/VaultInboxDocument.swift`, damit
beide Plattformen in denselben Vault schreiben koennen.

### TP4: Lokale Transkription

Umfang: `whisper-rs` im Rust-Kern, Modellverwaltung (Auswahl, Download,
Fortschritt, Pruefsumme, Loeschen), Sprache je Diktat, Rueckfall auf das
Gateway, Halluzinationsfilter wie auf dem Mac. Auch der Gateway-Weg braucht die
Sprache je Diktat: heute schickt die Windows-App fest `language: "de"` mit,
englische Diktate werden dadurch ins Deutsche gezwungen. Grosse Stufe, erstmals eigene
Modelldateien und Hardwareerkennung.

### TP5: Lokales Sprachmodell

Umfang: `llama-cpp-2`, Modellverwaltung gemeinsam mit TP4, Auswahl zwischen
lokalem Modell und Anbieter je Aufgabe, Abbruch bei Zeitueberschreitung.

### TP6: Meetings

Groesste Stufe, setzt TP4 und TP5 voraus. Umfang: Aufnahme von Mikrofon und
Systemton gleichzeitig (WASAPI-Loopback), Echofilter, Sprechertrennung,
Live-Notizen waehrend der Aufnahme, Zusammenfassung danach, Meeting-Liste,
Umbenennen von Sprechern, Freigeben.

### TP7: Feinschliff

Umfang: Aufnahmepille am Bildschirmrand, Einrichtungsassistent beim ersten
Start, Schweizer Rechtschreibung, Authenticode-Signierung der Installer.

## Durchgaengige Vorgaben

- Oberflaeche auf Deutsch, Wortwahl wie in der Mac-App.
- `shared/` bleibt die einzige Quelle fuer Prompts, Gateway-Vertrag und
  Konfigurationsschema. Aenderungen dort betreffen beide Apps und werden im
  selben Commit auf beiden Seiten nachgezogen.
- Das Gateway bleibt erreichbar und vorausgewaehlt, auch nachdem lokale
  Modelle moeglich sind. Kein Zwang zu lokaler Verarbeitung.
- Geheimnisse ausschliesslich ueber `keyring`, nie in der Einstellungsdatei
  und nie im Frontend.
- Beim Gateway kein `temperature` senden, die Antwort auf Transkription als
  JSON mit Feld `text` lesen, notfalls den Rohtext nehmen.
- Jede Stufe endet mit gruener CI auf `windows-latest` und einem Installer,
  der sich auf echtem Windows starten laesst.

## Nicht im Umfang

- Der iOS-Teil des Upstreams.
- Linux.
- Gemeinsamer Code zwischen Swift und Rust ueber `shared/` hinaus.
- Ein Nachbau der Mac-Oberflaeche Pixel fuer Pixel. Gleiches Verhalten,
  gleiche Benennung, eigene Umsetzung.

## Offene Risiken

- Die App wurde nie auf echtem Windows benutzt. Schritt 9 der alten Liste ist
  bis heute offen. Hier steht nur ein Mac zur Verfuegung, deshalb braucht jede
  Stufe eine Abnahme auf einem Windows-Rechner.
- `whisper-rs` und `llama-cpp-2` binden C++ ein. Die CI auf `windows-latest`
  braucht dafuer eine passende Toolchain, und die Installer werden deutlich
  groesser.
- Die Sprechertrennung ist auf dem Mac ein fertiges Apple-nahes Modell. Auf
  Windows ist sie eigene Arbeit mit eigener Qualitaetsfrage.
