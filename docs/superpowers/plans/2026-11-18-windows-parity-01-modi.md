# TP1: Testfundament und eigene Modi (Windows)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Windows-App bekommt frei anlegbare Modi anstelle der vier fest
verdrahteten Workflows, auf einem Testfundament, das die folgenden Stufen traegt.

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
- Altdaten aus `localStorage`: genau einmal uebernommen, ein zweiter Start
  erzeugt keine doppelten Modi (Task 7).

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

**Interfaces:**
- Consumes: Task 1 (`settings.rs`).
- Produces:
  - Rust: `settings_load(app: AppHandle) -> Result<String, String>` gibt den
    Dateiinhalt als JSON-Text zurueck, bei fehlender oder unlesbarer Datei
    `"{}"`. `settings_save(app: AppHandle, json: String) -> Result<(), String>`
    schreibt ueber eine Nebendatei und benennt danach um.
  - TS: `loadSettings(): Promise<Settings>`, `saveSettings(s: Settings): Promise<void>`

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
git add BlitztextWin/src-tauri/src/settings.rs BlitztextWin/src-tauri/src/lib.rs BlitztextWin/src/settings-store.ts BlitztextWin/src/settings-store.test.ts
git commit -m "Windows: Einstellungen liegen in einer Datei statt im localStorage"
```

---

### Task 4: Tastenkuerzel je Modus

**Files:**
- Create: `BlitztextWin/src-tauri/src/hotkeys.rs`
- Modify: `BlitztextWin/src-tauri/src/lib.rs` (`set_hotkey` nimmt eine Modus-ID)

**Interfaces:**
- Consumes: Task 2 (Modus-IDs), Task 3 (Ablage).
- Produces: `set_hotkey(mode_id: String, accelerator: String) -> Result<(), String>`;
  `HotkeyMap` bildet `Shortcut` auf `String` (Modus-ID) ab;
  `clear_hotkey(mode_id: String) -> Result<(), String>`.

- [ ] **Schritt 1: Fehlschlagende Tests schreiben**

In `hotkeys.rs`, gegen die reine Zuordnungslogik ohne Tauri:

```rust
#[test]
fn zweites_modus_mit_gleichem_kuerzel_verdraengt_das_erste() { /* Map: nach zwei set bleibt eine Zuordnung, zeigt auf den zweiten Modus */ }

#[test]
fn geloeschter_modus_gibt_sein_kuerzel_frei() { /* nach clear ist das Kuerzel nicht mehr in der Map */ }
```

Dafuer `struct HotkeyMap` mit `assign(&mut self, mode_id: &str, accel: &str) -> Option<String>`
(gibt das freigewordene Kuerzel zurueck) und `clear(&mut self, mode_id: &str) -> Option<String>`.

- [ ] **Schritt 2: Lauf pruefen**

Run: `cd BlitztextWin/src-tauri && cargo test`
Expected: FAIL.

- [ ] **Schritt 3: `HotkeyMap` umsetzen und die Kommandos darauf stellen**

`set_hotkey` meldet das von `assign` zurueckgegebene Kuerzel beim
Global-Shortcut-Plugin ab, bevor es das neue registriert.

- [ ] **Schritt 4: Lauf pruefen**

Run: `cd BlitztextWin/src-tauri && cargo test`
Expected: PASS.

- [ ] **Schritt 5: Commit**

```bash
git add BlitztextWin/src-tauri/src/hotkeys.rs BlitztextWin/src-tauri/src/lib.rs
git commit -m "Windows: Tastenkuerzel haengen an Modi statt an festen Workflows"
```

---

### Task 5: Modusverwaltung in der Oberflaeche

**Files:**
- Create: `BlitztextWin/src/mode-editor.ts`
- Modify: `BlitztextWin/src/popover.ts` (Einstellungsansicht ruft den Editor)
- Create: `BlitztextWin/src/mode-editor.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 3, 4.
- Produces: `renderModeList(container: HTMLElement, settings: Settings, on: ModeEvents): void`
  mit `ModeEvents = { add(mode: CustomMode): void; update(mode: CustomMode): void; remove(id: string): void }`.

- [ ] **Schritt 1: Fehlschlagende Tests schreiben**

```ts
it("Loeschen eines Modus gibt sein Kuerzel frei", () => { /* remove -> settings.hotkeys hat die ID nicht mehr */ });
it("Anlegen aus einer Vorlage uebernimmt Name, Symbol und Anweisung", () => { /* ... */ });
```

- [ ] **Schritt 2: Lauf pruefen**

Run: `cd BlitztextWin && npm test`
Expected: FAIL.

- [ ] **Schritt 3: `mode-editor.ts` umsetzen**

Liste der Modi mit Symbol, Name, Kuerzel-Abzeichen. Knopf "Modus anlegen" mit
Auswahl aus `modeTemplates()` oder leer. Bearbeiten aendert Name, Symbol,
Farbe, Anweisung und Kuerzel. Loeschen ruft `clear_hotkey`.

- [ ] **Schritt 4: Lauf pruefen**

Run: `cd BlitztextWin && npm test`
Expected: PASS.

- [ ] **Schritt 5: Commit**

```bash
git add BlitztextWin/src/mode-editor.ts BlitztextWin/src/mode-editor.test.ts BlitztextWin/src/popover.ts
git commit -m "Windows: Modi anlegen, bearbeiten und loeschen"
```

---

### Task 6: Aufnahme laeuft ueber den gewaehlten Modus

**Files:**
- Modify: `BlitztextWin/src/popover.ts` (Menueansicht, Aufnahmeablauf)
- Create: `BlitztextWin/src/run-mode.ts`
- Create: `BlitztextWin/src/run-mode.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 3.
- Produces: `runMode(mode: CustomMode, transcript: string, deps: RunDeps): Promise<string>`
  mit `RunDeps = { chat(system: string, user: string): Promise<string> }`.

- [ ] **Schritt 1: Fehlschlagende Tests schreiben**

```ts
it("ein Modus ohne Anweisung ruft chat nicht auf", async () => {
  const chat = vi.fn();
  expect(await runMode(newMode("Diktat"), "hallo", { chat })).toBe("hallo");
  expect(chat).not.toHaveBeenCalled();
});

it("ein Modus mit Anweisung schickt den zusammengesetzten Systemprompt", async () => { /* ... */ });
```

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

### Task 7: Uebernahme der Altdaten

**Files:**
- Create: `BlitztextWin/src/migrate.ts`
- Create: `BlitztextWin/src/migrate.test.ts`
- Modify: `BlitztextWin/src/settings-store.ts` (`loadSettings` ruft die Uebernahme)

**Interfaces:**
- Consumes: Tasks 2, 3.
- Produces: `migrateLegacySettings(raw: unknown): Settings | null`
  (`null`, wenn nichts zu uebernehmen ist)

- [ ] **Schritt 1: Fehlschlagende Tests schreiben**

```ts
it("macht aus den vier Workflows vier Modi", () => {
  const s = migrateLegacySettings(altbestand)!;
  expect(s.modes.map((m) => m.name)).toEqual(["Diktat", "Text verbessern", "Dampf ablassen", "Emojis"]);
});

it("uebernimmt die Kuerzel der alten Workflows", () => { /* Super+Shift+KeyD haengt am Diktat-Modus */ });

it("laeuft nur einmal", () => {
  expect(migrateLegacySettings({ modes: [] })).toBeNull();
});
```

- [ ] **Schritt 2: Lauf pruefen**

Run: `cd BlitztextWin && npm test`
Expected: FAIL.

- [ ] **Schritt 3: `migrate.ts` umsetzen**

Aus `improve`, `dampf`, `emoji` werden Modi mit der jeweiligen Anweisung aus
`shared/prompts.json`; aus `transcribe` wird ein Modus ohne Anweisung. Die
Kuerzel werden auf die neuen IDs umgehaengt. `loadSettings` ruft die Uebernahme
nur, wenn die Datei kein Feld `modes` hat, und schreibt danach einmal.

- [ ] **Schritt 4: Lauf pruefen**

Run: `cd BlitztextWin && npm test`
Expected: PASS, drei Tests.

- [ ] **Schritt 5: Von Hand nachsehen**

`npm run tauri dev` auf dem Mac: die vier Modi stehen im Menue, ihre Kuerzel
loesen aus, ein neuer Modus laesst sich anlegen und loeschen.

- [ ] **Schritt 6: Commit**

```bash
git add BlitztextWin/src/migrate.ts BlitztextWin/src/migrate.test.ts BlitztextWin/src/settings-store.ts
git commit -m "Windows: alte Workflow-Einstellungen werden zu Modi"
```

---

## Abnahme der Stufe

- `npm test` und `cargo test` gruen, in der CI auf `windows-latest` ebenso.
- Der Installer aus der CI startet auf einem echten Windows-Rechner, die vier
  uebernommenen Modi sind da, ein eigener Modus laesst sich anlegen und per
  Tastenkuerzel ausloesen.
- `BlitztextWin/HANDOFF.md` nennt den neuen Stand und zeigt auf diesen Plan.
