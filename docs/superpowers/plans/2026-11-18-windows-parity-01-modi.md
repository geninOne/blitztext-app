# TP1: Testfundament und eigene Modi (Windows)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Windows-App bekommt frei anlegbare eigene Modi neben den vier
eingebauten, wie der Mac 1.18.1, auf einem Testfundament, das die folgenden
Stufen traegt.

> **Korrektur waehrend der Ausfuehrung (nach Task 4):** Urspruenglich sollten
> die vier Workflows in eigene Modi umgewandelt werden. Der Mac tut das nicht:
> `WorkflowType` kennt eingebaute Modi und eigene (`case custom(String)`), das
> Menue zeigt die eingebauten zuerst. Die eingebauten bekommen Schutzregeln,
> die eigene Modi nicht bekommen (`transcriptIsNotARequest`, Rahmenregel). Eine
> Umwandlung haette diese Regeln entfernt. Task 6 und Task 7 sind deshalb neu
> gefasst, die eingebauten Modi bleiben unveraendert.

**Architecture:** Das Modell `CustomMode` kommt aus `shared/`, damit Mac und
Windows dieselben Vorlagen und dieselbe Prompt-Zusammensetzung benutzen. Die
Einstellungen wandern von `localStorage` in eine JSON-Datei im
Konfigurationsordner, geschrieben vom Rust-Kern, weil spaetere Stufen
(Verlauf, Inbox, Meetings) ebenfalls Dateien brauchen und `localStorage` im
Tray-Popover nicht zuverlaessig ueberlebt. Tastenkuerzel haengen danach an
Modus-IDs statt an vier festen Namen.

**Tech Stack:** Tauri v2, Rust (serde, tauri-plugin-global-shortcut), TypeScript,
Vite, Vitest, `cargo test`.

**Spec:** `docs/superpowers/specs/2026-11-18-windows-parity-design.md`

## Global Constraints

- Oberflaeche auf Deutsch, Benennung wie in der Mac-App.
- `shared/prompts.json` ist die einzige Quelle fuer Vorlagen und Prompttexte.
- Geheimnisse nur ueber `keyring`, nie in `settings.json`.
- Ein Modus ohne Anweisung ruft kein Sprachmodell und gibt den Text
  wortwoertlich weiter.
- Modus-IDs haben die Form `custom-<uuid>`, wie auf dem Mac
  (`BlitztextShared/Modes/CustomMode.swift`).
- Die Einstellungsdatei liegt unter `app_config_dir()/settings.json`.
- Jede Task endet mit gruenem `npm test` und `cargo test`.

## Review Focus

- Modus ohne Anweisung: kein Aufruf des Sprachmodells, Text unveraendert
  (Task 2).
- Zwei Modi mit demselben Tastenkuerzel: das zuletzt gesetzte gewinnt, das
  vorige wird freigegeben, kein doppelt registriertes Kuerzel (Task 4).
- Beschaedigte oder halb geschriebene `settings.json`: die App startet mit den
  Standardwerten statt mit leerem Zustand (Task 3).
- Geloeschter Modus mit registriertem Kuerzel: das Kuerzel wird freigegeben
  und loest nichts mehr aus (Task 5).
- Startmodi: genau einmal angelegt, ein geloeschter Startmodus kommt nach
  einem Neustart nicht wieder (Task 7).
- Eigener Modus und eingebauter Modus mit demselben Kuerzel: das Abzeichen des
  vorigen Halters verschwindet, nach Neustart loest nur der neue aus (Task 5).
- Erster Start nach dem Update: Gateway-Adresse und Kuerzel sind noch da,
  obwohl die Ablage gewechselt hat (Task 3).
- Modellschritt schlaegt fehl oder antwortet leer: das Gesagte wird trotzdem
  eingefuegt (Task 6).
- Englisches Diktat: die Diktatregeln gehen auf Englisch mit, nicht auf
  Deutsch, sonst zieht das Modell die Antwort in die falsche Sprache (Task 6).

---

### Task 1: Testfundament

**Files:**
- Modify: `BlitztextWin/package.json` (devDependency `vitest`, Skript `test`)
- Create: `BlitztextWin/vitest.config.ts`
- Create: `BlitztextWin/src/smoke.test.ts`
- Modify: `BlitztextWin/src-tauri/src/lib.rs` (Modul `settings` anmelden, leer)
- Create: `BlitztextWin/src-tauri/src/settings.rs` (zunaechst nur `normalize_base` samt Tests, aus `lib.rs` verschoben)
- Modify: `.github/workflows/ci.yml:118-150` (Schritte `npm test` und `cargo test` im Job `build-windows`)

**Interfaces:**
- Consumes: nichts.
- Produces: `npm test` und `cargo test` laufen lokal und in der CI.
  `settings::normalize_base(base: &str) -> String` ist aus `lib.rs` nach
  `settings.rs` gezogen und oeffentlich im Crate.

- [ ] **Schritt 1: Vitest einrichten**

`npm install -D vitest` in `BlitztextWin`, Skript `"test": "vitest run"`,
`vitest.config.ts` mit `test.environment: "node"`.

- [ ] **Schritt 2: Fehlschlagenden Testlauf erzeugen**

`src/smoke.test.ts` prueft `normalizeBaseUrl` aus `src/config.ts`, eine
Funktion, die es dort noch nicht gibt:

```ts
import { describe, it, expect } from "vitest";
import { normalizeBaseUrl } from "./config";

describe("normalizeBaseUrl", () => {
  it("entfernt abschliessenden Schraegstrich und /v1", () => {
    expect(normalizeBaseUrl("http://host:4000/v1/")).toBe("http://host:4000");
  });
});
```

- [ ] **Schritt 3: Lauf pruefen**

Run: `cd BlitztextWin && npm test`
Expected: FAIL, `normalizeBaseUrl` ist nicht exportiert.

- [ ] **Schritt 4: `normalizeBaseUrl(raw: string): string` in `src/config.ts` ergaenzen**

Gleiche Regel wie `normalize_base` in Rust: abschliessende Schraegstriche und
ein abschliessendes `/v1` entfernen.

- [ ] **Schritt 5: Lauf pruefen**

Run: `cd BlitztextWin && npm test`
Expected: PASS.

- [ ] **Schritt 6: `normalize_base` nach `settings.rs` verschieben und testen**

`settings.rs` anlegen, `normalize_base` samt `#[cfg(test)] mod tests` mit drei
Faellen: mit `/v1`, ohne `/v1`, mit mehreren Schraegstrichen. In `lib.rs`
`mod settings;` ergaenzen und die alte Definition entfernen.

- [ ] **Schritt 7: Lauf pruefen**

Run: `cd BlitztextWin/src-tauri && cargo test`
Expected: PASS, drei Tests.

- [ ] **Schritt 8: CI ergaenzen**

Im Job `build-windows` nach `npm ci` den Schritt `npm test`, nach dem
Rust-Cache den Schritt `cargo test --manifest-path BlitztextWin/src-tauri/Cargo.toml`.

- [ ] **Schritt 9: Commit**

```bash
git add BlitztextWin/package.json BlitztextWin/package-lock.json BlitztextWin/vitest.config.ts BlitztextWin/src/smoke.test.ts BlitztextWin/src/config.ts BlitztextWin/src-tauri/src/settings.rs BlitztextWin/src-tauri/src/lib.rs .github/workflows/ci.yml
git commit -m "Windows: Testfundament fuer TypeScript und Rust"
```

---

### Task 2: Modusmodell und Prompt-Zusammenbau

**Files:**
- Modify: `shared/prompts.json` (Schluessel `modeTemplates`)
- Modify: `BlitztextWin/src/config.ts` (Feld `modes`, `hotkeys` nach Modus-ID)
- Create: `BlitztextWin/src/modes.ts`
- Create: `BlitztextWin/src/modes.test.ts`

**Interfaces:**
- Consumes: Task 1 (Testlauf).
- Produces:
  - `interface CustomMode { id: string; name: string; icon: string; prompt: string; color?: "day" | "evening" | "night" }`
  - `newMode(name?: string, icon?: string, prompt?: string): CustomMode`
  - `hasInstruction(mode: CustomMode): boolean`
  - `modeTemplates(): CustomMode[]`
  - `systemPromptForMode(mode: CustomMode, terms: string[], context: string): string | null`
    (`null`, wenn der Modus keine Anweisung hat)
  - `Settings` in `src/config.ts` bekommt `modes: CustomMode[]` (Standard: leer)
    und `hotkeys: Record<string, string>` (Schluessel ist die Modus-ID statt
    des festen Workflow-Namens). Alle spaeteren Aufgaben bauen darauf auf.

- [ ] **Schritt 1: Fehlschlagende Tests schreiben**

`src/modes.test.ts`:

```ts
it("vergibt eine ID in der Form custom-<uuid>", () => {
  expect(newMode("Antwort").id).toMatch(/^custom-[0-9a-f-]{36}$/);
});

it("ein Modus ohne Anweisung braucht kein Sprachmodell", () => {
  expect(hasInstruction(newMode("Diktat", "wand.and.stars", "   "))).toBe(false);
  expect(systemPromptForMode(newMode("Diktat"), [], "")).toBeNull();
});

it("haengt Eigennamen und Kontext an die Anweisung", () => {
  const prompt = systemPromptForMode(newMode("Mail", "envelope.fill", "Schreib eine Mail."), ["n8n"], "Team evia");
  expect(prompt).toContain("Schreib eine Mail.");
  expect(prompt).toContain("n8n");
  expect(prompt).toContain("Team evia");
});

it("liefert die fuenf Vorlagen aus shared/prompts.json", () => {
  const namen = modeTemplates().map((m) => m.name);
  expect(namen).toEqual(["Als E-Mail", "Stichpunkte", "Antworten", "Auf Englisch", "Kurzfassung"]);
});
```

- [ ] **Schritt 2: Lauf pruefen**

Run: `cd BlitztextWin && npm test`
Expected: FAIL, `src/modes.ts` fehlt.

- [ ] **Schritt 3: Vorlagen in `shared/prompts.json` ergaenzen**

Neuer Schluessel `modeTemplates`, ein Eintrag je Vorlage mit `id`, `name`,
`icon`, `prompt`. Die Vorlagen und ihre Texte werden aus
`BlitztextShared/Modes/CustomMode.swift` (`CustomModeTemplate`) uebernommen,
damit beide Apps dieselben anbieten. Es sind genau fuenf, in dieser Reihenfolge:
`email` ("Als E-Mail"), `bullets` ("Stichpunkte"), `reply` ("Antworten"),
`english` ("Auf Englisch"), `summary` ("Kurzfassung"). Prompttexte und
Symbolnamen Zeichen fuer Zeichen aus der Swift-Datei uebernehmen.

- [ ] **Schritt 4: `src/modes.ts` umsetzen und `Settings` erweitern**

In `src/config.ts` bekommt `Settings` das Feld `modes: CustomMode[]`
(Standard leer), und `hotkeys` wird von `Record<WorkflowType, string>` auf
`Record<string, string>` umgestellt, Schluessel ist die Modus-ID. `WorkflowType`
bleibt vorerst stehen, Task 7 braucht ihn fuer die Uebernahme.

Die vier Funktionen aus dem Interfaces-Block. `systemPromptForMode` setzt
zusammen wie `ModePrompts` auf dem Mac: die Anweisung des Modus, danach die
geschuetzten Eigennamen, danach der Kontext, jeweils nur wenn gefuellt.

- [ ] **Schritt 5: Lauf pruefen**

Run: `cd BlitztextWin && npm test`
Expected: PASS, vier Tests.

- [ ] **Schritt 6: Commit**

```bash
git add shared/prompts.json BlitztextWin/src/config.ts BlitztextWin/src/modes.ts BlitztextWin/src/modes.test.ts
git commit -m "Windows: Modusmodell und Vorlagen aus shared/"
```

---

### Task 3: Einstellungen als Datei im Rust-Kern

**Files:**
- Modify: `BlitztextWin/src-tauri/src/settings.rs`
- Modify: `BlitztextWin/src-tauri/src/lib.rs` (zwei Kommandos im `invoke_handler`)
- Create: `BlitztextWin/src/settings-store.ts`
- Create: `BlitztextWin/src/settings-store.test.ts`
- Modify: `BlitztextWin/src/config.ts` (Altleser, `settingsVersion`, alte Ablage raus)
- Modify: `BlitztextWin/src/popover.ts` (auf die Dateiablage umstellen)

**Interfaces:**
- Consumes: Task 1 (`settings.rs`), Task 2 (`Settings.modes`).
- Produces:
  - Rust: `settings_load(app: AppHandle) -> Result<String, String>` gibt den
    Dateiinhalt als JSON-Text zurueck, bei fehlender oder unlesbarer Datei
    `"{}"`. `settings_save(app: AppHandle, json: String) -> Result<(), String>`
    schreibt ueber eine Nebendatei und benennt danach um.
  - TS: `loadSettings(): Promise<Settings>`, `saveSettings(s: Settings): Promise<void>`
  - TS: `readLegacySettings(): unknown | null` in `config.ts`, liest das rohe
    Objekt aus `localStorage` (`null`, wenn nichts da oder unlesbar).
  - `Settings.settingsVersion: number`, Standard `1`.

**Nachtrag aus der Pruefung von Task 2 (bindend):**

- Bisher liest und schreibt `popover.ts` an sechs Stellen synchron ueber
  `loadSettings`/`saveSettings` aus `config.ts`, also `localStorage`. Ohne
  Umstellung waere die Dateiablage toter Code. Diese Task stellt `popover.ts`
  um: einmal beim Start `await loadSettings()`, danach eine Kopie im Speicher;
  `persist` speichert ohne zu warten und protokolliert Fehler. Die alten
  Funktionen in `config.ts` verschwinden; uebrig bleibt nur
  `readLegacySettings()`.
- Kein Nutzer darf zwischen Task 3 und Task 7 seine Einstellungen verlieren.
  Gibt `settings_load` `"{}"` zurueck (noch keine Datei), uebernimmt
  `loadSettings` einmalig das Altobjekt aus `readLegacySettings()`, mit denselben
  verschachtelten Zusammenfuehrungen wie das bisherige `loadSettings` in
  `config.ts` (`liteLLM`, `hotkeys`, `improve`, `dampf` mit Rueckfall auf den
  Standardtext, `emoji`), und speichert das Ergebnis sofort in die Datei.
  `localStorage` wird nicht geloescht, es bleibt als Rueckweg.
- Gespeicherte Werte vom falschen Typ duerfen die Standardwerte nicht
  zerstoeren: ist `modes` kein Array, gilt `[]`.
- Zusaetzliche Tests in `settings-store.test.ts`:

```ts
it("uebernimmt beim ersten Start die Einstellungen aus dem localStorage", async () => {
  /* settings_load liefert "{}", readLegacySettings liefert { liteLLM: { baseURL: "http://gw:4000" } }:
     Ergebnis hat diese baseURL, settings_save wurde genau einmal aufgerufen */
});
it("eine vorhandene Datei hat Vorrang, das Altobjekt wird nicht gelesen", async () => { /* ... */ });
it("ein gespeichertes modes: null faellt auf die leere Liste zurueck", async () => { /* ... */ });
```

- [ ] **Schritt 1: Fehlschlagende Rust-Tests schreiben**

In `settings.rs`, gegen reine Dateifunktionen ohne `AppHandle`:

```rust
#[test]
fn beschaedigte_datei_liefert_leeres_objekt() { /* schreibt "{ kaputt", erwartet "{}" */ }

#[test]
fn schreiben_ersetzt_atomar() { /* schreibt zweimal, erwartet den zweiten Inhalt und keine Nebendatei */ }
```

Dafuer `read_settings_file(path: &Path) -> String` und
`write_settings_file(path: &Path, json: &str) -> std::io::Result<()>` in
`settings.rs`; die Tauri-Kommandos sind duenne Huellen darum.

- [ ] **Schritt 2: Lauf pruefen**

Run: `cd BlitztextWin/src-tauri && cargo test`
Expected: FAIL, Funktionen fehlen.

- [ ] **Schritt 3: Die beiden Dateifunktionen und die Kommandos umsetzen**

`write_settings_file` schreibt nach `<path>.neu` und ruft danach
`std::fs::rename`, damit ein Absturz mitten im Schreiben die alte Datei nicht
zerstoert. Kommandos in `lib.rs` registrieren.

- [ ] **Schritt 4: Lauf pruefen**

Run: `cd BlitztextWin/src-tauri && cargo test`
Expected: PASS.

- [ ] **Schritt 5: Fehlschlagenden TS-Test schreiben**

`settings-store.test.ts` mit gemocktem `invoke`:

```ts
it("ergaenzt fehlende Felder mit den Standardwerten", async () => {
  mockInvoke("settings_load", '{"hotkeyMode":"toggle"}');
  const s = await loadSettings();
  expect(s.hotkeyMode).toBe("toggle");
  expect(s.liteLLM.baseURL).toBe("");
});
```

- [ ] **Schritt 6: Lauf pruefen**

Run: `cd BlitztextWin && npm test`
Expected: FAIL.

- [ ] **Schritt 7: `src/settings-store.ts` umsetzen**

`loadSettings` ruft `settings_load`, legt das Ergebnis ueber
`defaultSettings` und gibt das Ganze zurueck. `saveSettings` serialisiert und
ruft `settings_save`.

- [ ] **Schritt 8: Lauf pruefen**

Run: `cd BlitztextWin && npm test`
Expected: PASS.

- [ ] **Schritt 9: Commit**

```bash
git add BlitztextWin/src-tauri/src/settings.rs BlitztextWin/src-tauri/src/lib.rs BlitztextWin/src/settings-store.ts BlitztextWin/src/settings-store.test.ts BlitztextWin/src/config.ts BlitztextWin/src/popover.ts
git commit -m "Windows: Einstellungen liegen in einer Datei statt im localStorage"
```

---

### Task 4: Tastenkuerzel je Modus

**Files:**
- Create: `BlitztextWin/src-tauri/src/hotkeys.rs`
- Modify: `BlitztextWin/src-tauri/src/lib.rs` (`HotkeyMap` dorthin verschieben, `set_hotkey`, `clear_hotkey`, Handler)
- Modify: `BlitztextWin/src/popover.ts` (zwei Aufrufe von `set_hotkey`, Parametername)

**Ausgangslage:** `lib.rs` hat bereits `struct HotkeyMap(Mutex<HashMap<Shortcut, String>>)`
und ein `set_hotkey(workflow, accelerator)`, das die alte Belegung des Workflows
und jede Belegung eines anderen Workflows mit demselben Kuerzel freigibt. Der
gespeicherte Wert ist schon eine beliebige Zeichenkette, die Logik ist also
bereits fuer Modus-IDs geeignet. Diese Task zieht sie in ein testbares Modul,
benennt den Parameter um, ergaenzt `clear_hotkey` und behebt einen Fehler: heute
sind die alten Kuerzel schon abgemeldet und aus der Map entfernt, bevor das neue
registriert wird. Scheitert die Registrierung (zum Beispiel ein vom System
belegtes Kuerzel), steht der Modus ohne Kuerzel da.

**Interfaces:**
- Consumes: Task 2 (Modus-IDs).
- Produces in `hotkeys.rs`, rein und ohne Tauri testbar (`Shortcut` laesst sich
  per `Shortcut::from_str` ohne App erzeugen):
  - `#[derive(Default)] pub struct HotkeyMap { .. }` (ohne Mutex; den legt
    `lib.rs` als verwalteten Zustand darum)
  - `pub fn freed_by(&self, mode_id: &str, shortcut: &Shortcut) -> Vec<Shortcut>`:
    alle Kuerzel, die frei werden, wenn `mode_id` das Kuerzel bekommt (die
    bisherige Belegung des Modus und eine fremde Belegung desselben Kuerzels),
    ohne die Map zu aendern
  - `pub fn assign(&mut self, mode_id: &str, shortcut: Shortcut)`
  - `pub fn clear(&mut self, mode_id: &str) -> Option<Shortcut>`
  - `pub fn mode_for(&self, shortcut: &Shortcut) -> Option<&str>`
- Produces als Tauri-Kommandos:
  - `set_hotkey(mode_id: String, accelerator: String) -> Result<(), String>`,
    im Frontend `invoke("set_hotkey", { modeId, accelerator })`
  - `clear_hotkey(mode_id: String) -> Result<(), String>`, im Frontend
    `invoke("clear_hotkey", { modeId })`
- Ablauf in `set_hotkey`: `freed_by` abfragen, diese Kuerzel abmelden, das neue
  registrieren. Scheitert das, die eben abgemeldeten wieder anmelden (so gut es
  geht), die Map unveraendert lassen und den Fehler zurueckgeben. Erst nach
  erfolgreicher Registrierung `assign`.
- `popover.ts` uebergibt an beiden Aufrufstellen weiterhin den Workflow-Namen
  als `modeId`; das ist bis Task 6 gewollt, die Map speichert jede Zeichenkette.

- [ ] **Schritt 1: Fehlschlagende Tests schreiben**

In `hotkeys.rs`:

```rust
#[test]
fn zweiter_modus_mit_gleichem_kuerzel_verdraengt_den_ersten() {
    /* a bekommt X, dann b bekommt X: freed_by(b, X) == [X];
       nach assign zeigt mode_for(X) auf b, a hat kein Kuerzel mehr */
}

#[test]
fn neues_kuerzel_gibt_das_alte_des_modus_frei() {
    /* a hat X, freed_by(a, Y) == [X]; nach assign: mode_for(X) None, mode_for(Y) a */
}

#[test]
fn beide_belegungen_werden_frei() {
    /* a hat X, b hat Y; freed_by(a, Y) enthaelt X und Y, genau diese zwei */
}

#[test]
fn freed_by_aendert_nichts() { /* nach freed_by ist die Map gleich */ }

#[test]
fn geloeschter_modus_gibt_sein_kuerzel_frei() {
    /* a hat X; clear(a) == Some(X); mode_for(X) None; zweites clear(a) == None */
}
```

- [ ] **Schritt 2: Lauf pruefen**

Run: `cd BlitztextWin/src-tauri && cargo test`
Expected: FAIL, Modul fehlt.

- [ ] **Schritt 3: `hotkeys.rs` umsetzen, `lib.rs` und `popover.ts` darauf stellen**

`HotkeyMap` aus `lib.rs` entfernen, der verwaltete Zustand wird
`Mutex<hotkeys::HotkeyMap>`. Der Shortcut-Handler im Builder nutzt `mode_for`.
`clear_hotkey` meldet das von `clear` gelieferte Kuerzel ab. Die zwei Aufrufe in
`popover.ts` auf `{ modeId: ..., accelerator }` umstellen.

- [ ] **Schritt 4: Lauf pruefen**

Run: `cd BlitztextWin/src-tauri && cargo test && cargo build`, dann
`cd BlitztextWin && npm test && npm run build`
Expected: alles gruen, keine Warnungen.

- [ ] **Schritt 5: Commit**

```bash
git add BlitztextWin/src-tauri/src/hotkeys.rs BlitztextWin/src-tauri/src/lib.rs BlitztextWin/src/popover.ts
git commit -m "Windows: Tastenkuerzel haengen an Modi statt an festen Workflows"
```

---

### Task 5: Modusverwaltung in der Oberflaeche

**Files:**
- Create: `BlitztextWin/src/mode-editor.ts`
- Create: `BlitztextWin/src/mode-editor.test.ts`
- Create: `shared/mode-icons.json`
- Create: `BlitztextWin/src/mode-icons.ts`
- Modify: `BlitztextWin/src/popover.ts` (Abschnitt "Modi", Kuerzel-Rekorder je Modus)
- Modify: `BlitztextWin/index.html` (Abschnitt "Modi" oben in "Anpassen")
- Modify: `BlitztextWin/package.json` (`lucide`, exakt gepinnt)

**Interfaces:**
- Consumes: Task 2 (`CustomMode`, `newMode`, `modeTemplates`, `modeFromTemplate`),
  Task 3 (`saveSettings` ueber `persist`), Task 4 (`set_hotkey`/`clear_hotkey`
  mit `{ modeId, ... }`).
- Produces, rein und ohne DOM testbar in `mode-editor.ts`:
  - `addMode(settings: Settings, mode: CustomMode): void` (haengt an)
  - `updateMode(settings: Settings, mode: CustomMode): void` (ersetzt per `id`)
  - `removeMode(settings: Settings, id: string): { hadHotkey: boolean }`
    (entfernt den Modus und seinen Eintrag in `settings.hotkeys`)
- Produces, DOM, nicht unit-getestet:
  `renderModeList(container: HTMLElement, settings: Settings, on: ModeEvents): void`
  mit `ModeEvents = { add(mode: CustomMode): void; update(mode: CustomMode): void; remove(id: string): void }`.
- Produces in `mode-icons.ts`: `iconFor(symbol: string): SVGElement`, mit
  Rueckfall auf das Symbol fuer `wand.and.stars` bei unbekanntem Namen.

**Entscheidungen aus dem Pre-flight vor Task 5 (bindend):**

- Vitest laeuft ohne DOM, und Task 1 hat festgelegt, keine DOM-Umgebung
  nachzuruesten. Deshalb trennt diese Task Zustand und Darstellung: die drei
  Zustandsfunktionen sind getestet, `renderModeList` wird von Hand geprueft.
- Gespeichert bleiben die SF-Symbol-Namen des Macs (Datenvertraeglichkeit).
  Angezeigt wird ueber Lucide, wie im Entwurf festgelegt. Die Zuordnung der
  13 Namen aus `CustomMode.symbols` (`BlitztextShared/Modes/CustomMode.swift`)
  zu Lucide-Symbolen liegt in `shared/mode-icons.json`, damit ein spaeteres
  Teilprojekt sie wiederverwenden kann.
- Farben: die drei Familien `day` ("Blau"), `evening` ("Violett", Standard),
  `night` ("Lila") wie auf dem Mac; die Farbwerte aus
  `BlitztextShared/Design/BlackboatTokens.swift`, als CSS-Variablen in
  `index.html`, mit hellem und dunklem Modus wie die vorhandene Palette.
- Der neue Abschnitt "Modi" steht oben im Tab "Anpassen" und verwaltet nur
  eigene Modi. Die alten Abschnitte ("Tastenkuerzel", "Blitztext+",
  "Blitztext $%&!", "Blitztext :)") bleiben dauerhaft, sie konfigurieren die
  eingebauten Modi. "Eigennamen" gilt fuer alle Modi.
- Weist der Rekorder einer Kennung ein Kuerzel zu und `set_hotkey` war
  erfolgreich, verliert jeder andere Schluessel in `settings.hotkeys` mit
  demselben Kuerzel seinen Eintrag (reine Funktion
  `assignHotkey(settings, id, accelerator): string[]`, getestet).
- Das Kuerzel je Modus nimmt der vorhandene Rekorder auf (`renderHotkey` in
  `popover.ts`, etwa Zeile 678). Er wird so verallgemeinert, dass er eine
  beliebige Kennung annimmt; keine zweite Aufnahmelogik daneben.
- Loeschen: `invoke("clear_hotkey", { modeId })`, dann `removeMode`, dann
  `persist`.

- [ ] **Schritt 1: Fehlschlagende Tests schreiben**

```ts
it("Loeschen eines Modus entfernt ihn und sein Kuerzel", () => {
  /* zwei Modi, einer mit Eintrag in settings.hotkeys; removeMode(id):
     Modus weg, hotkeys hat die ID nicht mehr, hadHotkey === true */
});
it("Loeschen eines Modus ohne Kuerzel meldet hadHotkey false", () => { /* ... */ });
it("Anlegen aus einer Vorlage uebernimmt Name, Symbol und Anweisung", () => {
  /* addMode(settings, modeFromTemplate(modeTemplates()[0])): Name "Als E-Mail",
     icon "envelope.fill", prompt gleich, id custom-<uuid> */
});
it("Bearbeiten ersetzt nur den Modus mit derselben Kennung", () => { /* ... */ });
it("jedes Symbol aus CustomMode.symbols hat eine Zuordnung", () => {
  /* alle 13 Namen sind Schluessel in shared/mode-icons.json */
});
```

- [ ] **Schritt 2: Lauf pruefen**

Run: `cd BlitztextWin && npm test`
Expected: FAIL, Module fehlen.

- [ ] **Schritt 3: Umsetzen**

Zustandsfunktionen, Symbolzuordnung, Abschnitt "Modi" mit Liste (Symbol,
Name, Kuerzel-Abzeichen), Knopf "Modus anlegen" mit Auswahl aus den Vorlagen
oder leer, Bearbeiten von Name, Symbol, Farbe, Anweisung und Kuerzel,
Loeschen.

- [ ] **Schritt 4: Lauf pruefen**

Run: `cd BlitztextWin && npm test && npm run build`
Expected: PASS, keine Warnungen.

- [ ] **Schritt 5: Von Hand nachsehen**

`npm run tauri dev`: Modus aus Vorlage anlegen, umbenennen, Symbol und Farbe
wechseln, Kuerzel setzen, loeschen. Nach Neustart ist der Zustand erhalten.

- [ ] **Schritt 6: Commit**

```bash
git add BlitztextWin/src/mode-editor.ts BlitztextWin/src/mode-editor.test.ts BlitztextWin/src/mode-icons.ts shared/mode-icons.json BlitztextWin/src/popover.ts BlitztextWin/index.html BlitztextWin/package.json BlitztextWin/package-lock.json
git commit -m "Windows: Modi anlegen, bearbeiten und loeschen"
```

---

### Task 6: Aufnahme laeuft ueber den gewaehlten Modus

**Files:**
- Modify: `BlitztextWin/src/popover.ts` (Menueansicht, Aufnahmeablauf)
- Modify: `BlitztextWin/src-tauri/src/lib.rs` (Kommando `detect_language`)
- Modify: `BlitztextWin/src-tauri/Cargo.toml` (`whatlang`)
- Modify: `BlitztextWin/src/modes.ts`, `shared/prompts.json` (`modeFrames`, Sprachparameter)
- Create: `BlitztextWin/src/run-mode.ts`
- Create: `BlitztextWin/src/run-mode.test.ts`

**Neufassung nach Task 4 (bindend):** Das Menue zeigt zuerst die vier
eingebauten Modi wie bisher, darunter die eigenen Modi aus `settings.modes`
(wie `builtInMenuCases` plus eigene auf dem Mac). Das Ereignis `hotkey-down`
traegt entweder einen eingebauten Namen (`transcribe`, `improve`, `dampf`,
`emoji`) oder eine Modus-Kennung `custom-...`. Eingebaute Modi laufen ueber den
vorhandenen Weg mit `systemPromptFor`, unveraendert. Eigene Modi laufen ueber
`runMode`. Eigennamen fuer eigene Modi: `settings.improve.customTerms` (der
Abschnitt "Eigennamen"). Kontext: leer, denn die Windows-App liest das Textfeld
unter dem Cursor noch nicht (auf dem Mac `FocusedFieldReader`); das ist eine
spaetere Stufe. Eine unbekannte `custom-...`-Kennung (Modus geloescht) loest
nichts aus. Die Handler fuer `hotkey-down` und `hotkey-up` in `popover.ts`
ignorieren seit Task 5 jede Kennung ausser den vier eingebauten; diese Sperre
ersetzt Task 6.

**Interfaces:**
- Consumes: Tasks 2, 3. Aus Task 2 auch `spokenTranscriptRules` in
  `shared/prompts.json` (deutsch und englisch).
- Produces: `runMode(mode: CustomMode, transcript: string, deps: RunDeps): Promise<string>`
  mit `RunDeps = { chat(system: string, user: string): Promise<string>; language(text: string): Promise<"de" | "en"> }`.
- Produces: Rust `detect_language(text: String) -> String`, liefert `"en"` nur,
  wenn `whatlang` sicher Englisch erkennt, sonst `"de"`.

**Nachtrag aus der Pruefung von Task 2 (bindend):**

- `runMode` gibt `Promise<{ text: string; aiFailed: boolean }>` zurueck statt
  `Promise<string>`. Wirft `chat` oder kommt eine leere Antwort zurueck, ist
  `text` das unveraenderte Transkript und `aiFailed` wahr. So verhaelt sich der
  Mac (`AIStepFailed` in `CustomModeWorkflow.swift`): das Gesagte geht nie
  verloren.
- Eigene Modi laufen auf dem Mac als `generate`: sie bekommen die Diktatregeln,
  aber keine Rahmenregel (`RewriteGuard.framingRule` gilt nur fuer die
  eingebauten Modi). Also hier ebenfalls keine Rahmenregel.
- Auf dem Mac haben auch der Eigennamen-Satz und der Kontextblock eine
  englische Fassung (`ModePrompts.customTermsInstruction`, `withFieldContext`).
  `systemPromptForMode` bekommt deshalb einen vierten Parameter
  `language: "de" | "en" = "de"`. Die Texte beider Fassungen wandern aus
  `modes.ts` nach `shared/prompts.json` unter `modeFrames` (Globale Vorgabe:
  `shared/prompts.json` ist die einzige Quelle fuer Prompttexte), zeichengenau
  aus `ModePrompts.swift`.
- Zusaetzliche Tests: je Sprache ein Test auf die exakte Ausgabe von
  `systemPromptForMode` mit Anweisung, Eigennamen und Kontext (legt die
  Reihenfolge fest, `toContain` tut das nicht); `runMode` mit werfendem `chat`
  und mit leerer Antwort liefert das Transkript und `aiFailed: true`.

- [ ] **Schritt 1: Fehlschlagende Tests schreiben**

```ts
it("ein Modus ohne Anweisung ruft chat nicht auf", async () => {
  const chat = vi.fn();
  expect((await runMode(newMode("Diktat"), "hallo", { chat, language: async () => "de" })).text).toBe("hallo");
  expect(chat).not.toHaveBeenCalled();
});

it("ein Modus mit Anweisung schickt den zusammengesetzten Systemprompt", async () => { /* ... */ });

it("haengt die Diktatregeln an, in der Sprache des Transkripts", async () => {
  const chat = vi.fn().mockResolvedValue("ok");
  await runMode(newMode("Mail", "envelope.fill", "Schreib eine Mail."), "on Thursday", {
    chat,
    language: async () => "en",
  });
  expect(chat.mock.calls[0][0]).toContain("The user sends you a spoken transcript.");
});
```

Begruendung fuer die Regeln: auf dem Mac haengt `TextRewriter.rewrite` sie an
jeden Schritt an (`dictationRules` ist standardmaessig wahr, nur der
Meeting-Zusammenfasser schaltet sie ab). Ohne sie loest die App
Selbstkorrekturen nicht auf und laesst Vorbemerkungen durch. Die Sprachwahl
folgt `PromptLanguage.of`: Englisch nur bei sicherer Erkennung, sonst Deutsch.

- [ ] **Schritt 2: Lauf pruefen**

Run: `cd BlitztextWin && npm test`
Expected: FAIL.

- [ ] **Schritt 3: `run-mode.ts` umsetzen und `popover.ts` darauf umstellen**

Die Menueansicht listet die Modi aus den Einstellungen statt der vier festen
Zeilen. Das Ereignis `hotkey-down` traegt die Modus-ID.

- [ ] **Schritt 4: Lauf pruefen**

Run: `cd BlitztextWin && npm test`
Expected: PASS.

- [ ] **Schritt 5: Commit**

```bash
git add BlitztextWin/src/run-mode.ts BlitztextWin/src/run-mode.test.ts BlitztextWin/src/popover.ts
git commit -m "Windows: Aufnahme laeuft ueber den gewaehlten Modus"
```

---

### Task 7: Startbestand und verwaiste Kuerzel

**Files:**
- Create: `BlitztextWin/src/seed.ts`
- Create: `BlitztextWin/src/seed.test.ts`
- Modify: `BlitztextWin/src/config.ts` (`hasSeededCustomModes`)
- Modify: `BlitztextWin/src/settings-store.ts` oder `popover.ts` (Aufruf beim Start)

**Neufassung nach Task 4 (bindend):** Die eingebauten Modi bleiben eingebaut
(siehe Korrektur oben), es gibt nichts umzuwandeln. Stattdessen macht diese
Task, was der Mac beim Start tut (`AppState.seedCustomModesIfNeeded` und
`removeCustomModeOrphans` in `BlitztextMac/App/AppState.swift`):

- Einmalig die Vorlagen `email` und `bullets` als eigene Modi anlegen
  (`CustomModeTemplate.defaultSeeds`), gesteuert ueber
  `Settings.hasSeededCustomModes: boolean` (Standard `false`). Danach geloeschte
  Modi bleiben geloescht.
- Kuerzel von eigenen Modi, die es nicht mehr gibt, beim Start aus
  `settings.hotkeys` entfernen. Eingebaute Schluessel (`transcribe`, `improve`,
  `dampf`, `emoji`) sind nie verwaist.
- Seit Task 5 bedeutet ein leerer Eintrag `""` "bewusst kein Kuerzel". Bei
  eingebauten Schluesseln darf er nicht geloescht werden, sonst legt der Lader
  beim naechsten Start das Standardkuerzel wieder darunter.
- `settingsVersion` bleibt bei `1`, es wird nicht mehr gebraucht.

**Interfaces:**
- Consumes: Task 2 (`modeTemplates`, `modeFromTemplate`), Task 3 (Ablage).
- Produces:
  - `seedCustomModesIfNeeded(settings: Settings): boolean` (wahr, wenn
    angelegt wurde und gespeichert werden muss)
  - `removeCustomModeOrphans(settings: Settings): boolean` (wahr, wenn etwas
    entfernt wurde)

- [ ] **Schritt 1: Fehlschlagende Tests schreiben**

```ts
it("legt beim ersten Start Als E-Mail und Stichpunkte an", () => {
  const s = defaults();
  expect(seedCustomModesIfNeeded(s)).toBe(true);
  expect(s.modes.map((m) => m.name)).toEqual(["Als E-Mail", "Stichpunkte"]);
  expect(s.hasSeededCustomModes).toBe(true);
});
it("legt nichts an, wenn schon einmal angelegt wurde, auch wenn die Liste leer ist", () => {
  /* hasSeededCustomModes true, modes []: false, modes bleibt [] */
});
it("haengt die Startmodi an vorhandene eigene Modi an", () => { /* ... */ });
it("entfernt Kuerzel von geloeschten eigenen Modi", () => {
  /* hotkeys hat "custom-weg" ohne passenden Modus: entfernt, Rueckgabe true */
});
it("laesst die Kuerzel der eingebauten Modi stehen", () => { /* transcribe, improve, dampf, emoji bleiben */ });
```

- [ ] **Schritt 2: Lauf pruefen**

Run: `cd BlitztextWin && npm test`
Expected: FAIL, Modul fehlt.

- [ ] **Schritt 3: Umsetzen und beim Start aufrufen**

Nach `loadSettings` beide Funktionen aufrufen, bei wahr einmal speichern. Erst
danach die Kuerzel registrieren, damit verwaiste gar nicht erst angemeldet
werden.

- [ ] **Schritt 4: Lauf pruefen**

Run: `cd BlitztextWin && npm test && npm run build`
Expected: PASS.

- [ ] **Schritt 5: Von Hand nachsehen**

`npm run tauri dev` mit frischer Einstellungsdatei: im Menue stehen die vier
eingebauten Modi und darunter "Als E-Mail" und "Stichpunkte". Einen davon
loeschen, neu starten: er bleibt geloescht.

- [ ] **Schritt 6: Commit**

```bash
git add BlitztextWin/src/seed.ts BlitztextWin/src/seed.test.ts BlitztextWin/src/config.ts BlitztextWin/src/settings-store.ts BlitztextWin/src/popover.ts
git commit -m "Windows: Startmodi wie auf dem Mac, verwaiste Kuerzel weg"
```

---

## Abnahme der Stufe

- `npm test` und `cargo test` gruen, in der CI auf `windows-latest` ebenso.
- Der Installer aus der CI startet auf einem echten Windows-Rechner, die vier
  eingebauten Modi und die zwei Startmodi sind da, ein eigener Modus laesst
  sich anlegen und per Tastenkuerzel ausloesen.
- `BlitztextWin/HANDOFF.md` nennt den neuen Stand und zeigt auf diesen Plan.
