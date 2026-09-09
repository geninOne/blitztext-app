# Anpassbare Tastenkuerzel (Design)

Datum: 2026-09-09
Status: abgestimmt, bereit fuer den Implementierungsplan

## Ziel

Nutzer koennen die Tastenkuerzel aller Workflows selbst vergeben und
jederzeit auf die Werkseinstellung zuruecksetzen, einzeln pro Kuerzel und
gesammelt fuer alle.

## Ausgangslage

Die sechs Kuerzel sind heute in `HotkeyService.handleFlags` als feste
`if`-Bloecke verdrahtet, die Anzeigetexte stecken als statisches
`WorkflowType.hotkeyLabel` im Modell. Beides ist nicht konfigurierbar.

Beim Lesen fiel ein bestehender Fehler auf: `handleFlags` feuert sofort,
sobald eine Kombination exakt passt. Da `fn + Shift` echte Teilmenge von
`fn + Shift + Option` und `fn + Shift + Control` ist, gewinnt je nach
Eintreffreihenfolge der einzelnen Modifier oft die kuerzere Kombination.
Mit frei vergebbaren Kuerzeln wird dieses Praefix-Problem haeufiger, es
wird deshalb mit behandelt.

## Entscheidungen

1. Erlaubt sind ausschliesslich reine Modifier-Kombinationen aus fn,
   Shift, Control, Option und Command. Keine normalen Tasten. Damit
   bleibt die bestehende `flagsChanged`-Mechanik gueltig, der
   Halten-Modus funktioniert unveraendert, und es gibt keine Konflikte
   mit normalen Tippeingaben.
2. Mindestens zwei Modifier pro Kombination. Ein einzelner Modifier wird
   abgelehnt, auch fn allein.
3. Doppelbelegungen werden hart abgelehnt, mit Nennung des Workflows, der
   die Kombination belegt.
4. Jeder Workflow behaelt immer ein Kuerzel. Es gibt kein "kein Kuerzel".
5. Zuruecksetzen gibt es pro Kuerzel und gesammelt fuer alle.
6. Praefix-Kombinationen werden per kurzer Wartezeit aufgeloest, nicht
   verboten.

Aus Entscheidung 3 folgt, dass zwei Kuerzel nicht direkt getauscht werden
koennen. Eines muss zuerst auf eine dritte Kombination. Das ist die
uebliche Folge harter Konfliktpruefung und wird bewusst so belassen.

## Architektur

Gewaehlt wurde ein Wert-Modell im bestehenden Einstellungscontainer mit
datengetriebenem Matching. Verworfen wurden ein eigener Persistenzpfad
(zweiter Speicherort ohne Gewinn, `hotkeyMode` liegt schon in
`AppSettings`) und eine Drittbibliothek beziehungsweise `CGEventTap`
(gaengige Bibliotheken kennen keine reinen Modifier-Kombinationen,
`CGEventTap` bringt zusaetzliche Berechtigungs- und Stabilitaetsrisiken).

### Datenmodell

Neue Datei `Services/HotkeyBinding.swift`:

- `HotkeyModifier: String, Codable, CaseIterable` mit den Faellen `fn`,
  `shift`, `control`, `option`, `command`. Die rawValues sind stabil, sie
  landen im gespeicherten JSON.
- `HotkeyCombo: Codable, Hashable` mit `modifiers: Set<HotkeyModifier>`.
  Der Typ kennt die Umrechnung von und nach `NSEvent.ModifierFlags`, ein
  Anzeigelabel in fester Reihenfolge (fn, Shift, Ctrl, Option, Cmd) und
  eine Codable-Form als sortiertes Array, damit das JSON stabil bleibt.
  Die Kurzformen der Labels bleiben erhalten, weil das Badge in der
  340pt breiten Menueleisten-Ansicht sonst zu breit wird.
- `HotkeyBindings: Codable` mit `overrides: [WorkflowType: HotkeyCombo]`.
  Gespeichert werden nur Abweichungen vom Standard. Das macht
  `isDefault(for:)` und `reset(_:)` trivial und laesst Bestandsnutzer
  kuenftige Standardaenderungen automatisch erben.

Schnittstelle von `HotkeyBindings`:

- `static func defaultCombo(for: WorkflowType) -> HotkeyCombo`, die
  heutigen sechs Kombinationen.
- `func combo(for: WorkflowType) -> HotkeyCombo`, Abweichung oder
  Standard.
- `func isDefault(for: WorkflowType) -> Bool`
- `var hasOverrides: Bool`
- `mutating func set(_: HotkeyCombo, for: WorkflowType)`
- `mutating func reset(_: WorkflowType)`, `mutating func resetAll()`.
  `reset` setzt kaskadierend zurueck: belegt ein anderer Workflow den
  Standard des zurueckgesetzten, wird er selbst zurueckgesetzt, bis
  keine Doppelbelegung bleibt. Das terminiert, weil jeder Schritt eine
  Abweichung entfernt und die sechs Standards untereinander
  konfliktfrei sind.
- `func owner(of: HotkeyCombo, excluding: WorkflowType) -> WorkflowType?`
- `func validate(_: HotkeyCombo, for: WorkflowType) -> HotkeyComboValidation`

`HotkeyComboValidation` ist ein Enum aus `.ok` und Fehlerfaellen fuer zu
wenige Modifier und Doppelbelegung. Der Doppelbelegungsfall traegt den
belegenden `WorkflowType`. Den Anzeigenamen loest die UI ueber
`AppState.displayName(for:)` auf, damit eigene Workflow-Namen korrekt
erscheinen.

`WorkflowType.hotkeyLabel` entfaellt, die Standards leben in
`HotkeyBindings.defaultCombo(for:)`.

### Matching

Die Entscheidungslogik liegt in einem reinen Wertetyp `HotkeyMatcher`,
damit sie ohne echte Tastaturereignisse testbar ist:

```
Eingabe:  aktuelle Modifier-Flags, Bindings, aktueller Zustand
Ausgabe:  .fire(WorkflowType)
        | .defer(WorkflowType, TimeInterval)
        | .release(WorkflowType)
        | .none
```

`.defer` entsteht genau dann, wenn die gedrueckte Kombination exakt passt
und echte Teilmenge einer anderen vergebenen Kombination ist. Die
Wartezeit betraegt 150 ms.

Wird waehrend der Wartezeit ein Modifier gelockert, statt einen weiteren
zu druecken, ist die Frage beantwortet: die ausstehende Entscheidung
feuert dann sofort, bevor die neuen Flags verarbeitet werden. Sonst
wuerde ein kurzer Tipp auf ein Praefix-Kuerzel im Druecken-Modus wirkungslos
bleiben, und der Druecken-Modus soll sich nicht aendern.

`HotkeyService` behaelt nur die Mechanik: die beiden `flagsChanged`
-Monitore, den Escape-Monitor, einen `Task` fuer die Wartezeit, den
Abbruch dieses Tasks bei jeder Flag-Aenderung und beim Loslassen, sowie
eine Pruefung beim Ablauf der Wartezeit, dass die Flags unveraendert
gehalten werden. Diese Pruefung vergleicht gegen die zuletzt in
`handleFlags` gesehenen Flags, nicht gegen `NSEvent.modifierFlags`, damit
Entscheidung und Nachpruefung dieselbe Wahrheitsquelle haben. Die sechs festen `if`-Bloecke verschwinden.

Zusaetzlich bekommt `HotkeyService`:

- `var bindings: HotkeyBindings`, gesetzt aus `AppState`
- `func suspend()` und `func resume()` fuer den Aufnahmemodus der
  Einstellungen. Im stillgelegten Zustand bleiben die Monitore
  registriert, liefern aber kein `HotkeyEvent`, auch nicht fuer Escape,
  und eine laufende Wartezeit wird abgebrochen.

### Persistenz

`AppSettings` bekommt `hotkeyBindings: HotkeyBindings` mit
`decodeIfPresent` und leerem Standard, nach dem Muster der bestehenden
Felder. Bestandsinstallationen ohne den Schluessel laufen auf den
Standards, eine Migration ist nicht notwendig. Gespeichert wird weiter
ueber den bestehenden `SettingsContainer`.

`AppState.appSettings.didSet` uebergibt die Bindings an den
`HotkeyService`, `AppState.init` setzt die geladenen Kuerzel einmal beim
Start, weil `didSet` im Init nicht feuert.

## UI

Abschnitt "Tastenkuerzel" in `SettingsContentView`:

- Pro Workflow eine Zeile, alle Workflows einschliesslich des lokalen
  Modus. Dessen Kuerzel ist sein einziger Zugang, und ohne Zeile
  verweist die Konfliktmeldung auf etwas Unsichtbares. Jede Zeile
  zeigt Name, Kuerzel-Badge, Knopf "Aendern" und
  einem kleinen Zuruecksetzen-Symbol, das nur bei Abweichung vom
  Standard erscheint.
- Am Abschnittsende "Alle Tastenkuerzel zuruecksetzen", nur aktiv wenn
  Abweichungen bestehen, mit kurzer Rueckfrage, weil eigene
  Kombinationen dabei verloren gehen.
- Der Modus-Umschalter (Halten / Druecken) bleibt unveraendert.

Aufnahmeablauf:

1. Klick auf "Aendern" schaltet die Zeile in den Aufnahmezustand, das
   Badge zeigt "Tasten druecken".
2. `HotkeyService.suspend()` legt den globalen Monitor still.
3. Ein lokaler `flagsChanged`-Monitor merkt sich die groesste
   gleichzeitig gehaltene Modifier-Menge der laufenden Aufnahme. Bei
   gleicher Groesse gewinnt die zuletzt gehaltene Menge, damit keine
   Kombination uebernommen wird, deren Tasten nicht mehr anliegen.
4. Beim Loslassen aller Modifier wird diese Menge geprueft und bei
   Erfolg gespeichert. Bei reinen Modifier-Kombinationen ist das
   Loslassen die natuerliche Bestaetigung, ein Enter braucht es nicht.
5. Escape oder ein Klick ausserhalb bricht ab.
6. `resume()` laeuft beim Verlassen des Aufnahmezustands und zusaetzlich
   in `onDisappear`, damit ein geschlossenes Popover den Dienst nicht
   dauerhaft stilllegt.

Ungueltige Eingaben aendern die gespeicherte Kombination nicht. Die Zeile
bleibt im Aufnahmezustand und zeigt den Grund darunter in Rot, etwa
"Mindestens zwei Modifier" oder "Belegt von Blitztext Notiz".

### Weitere betroffene Anzeigen

- Das Badge in `WorkflowRowView` nutzt statt `type.hotkeyLabel` das
  Label der aktuellen Bindung.
- Der fest getippte Hinweis "fn + Shift + Option haelt einen Gedanken in
  einer Tagesdatei fest" im Diktat-Abschnitt setzt das aktuelle Kuerzel
  des Diktat-Workflows ein.

## Tests

XCTest, wie die bestehenden Tests unter `Tests/`.

`HotkeyBindingsTests`:

- Standards sind fuer alle `WorkflowType`-Faelle vorhanden und
  untereinander konfliktfrei.
- Setzen, Abweichungserkennung, Zuruecksetzen einzeln und gesammelt.
- Validierung lehnt einen einzelnen Modifier ab, auch fn allein.
- Validierung lehnt eine bereits belegte Kombination ab und nennt den
  belegenden Workflow.
- Validierung erlaubt die eigene, unveraenderte Kombination.
- Codable-Rundlauf, dazu Laden ohne den Schluessel und mit unbekanntem
  Modifier-Wert.

`HotkeyMatcherTests`:

- Exakter Treffer liefert `.fire`.
- Praefix-Fall liefert `.defer` mit 150 ms.
- Die laengere Kombination feuert sofort.
- Loslassen liefert `.release` fuer die aktive Kombination.
- Nicht belegte Flag-Kombinationen liefern `.none`.
- Laeuft schon eine Aufnahme, aendert eine andere Kombination nichts.

Das Verwerfen einer verzoegerten Entscheidung bei einer Flag-Aenderung
liegt in `HotkeyService` und wird manuell geprueft, nicht per Unit-Test.

## Nicht Teil dieser Aenderung

- Kuerzel mit normalen Tasten.
- Abschaltbare Kuerzel ohne Zuweisung.
- Erkennung von Konflikten mit System- oder Fremd-App-Kuerzeln.
- Aenderungen am Halten- und Druecken-Modus selbst.
- Der Windows-Ableger unter `BlitztextWin`.

## Folgeschritt

Nach dem Umbau ist ein XcodeGen-Lauf notwendig, weil neue Dateien
hinzukommen.
