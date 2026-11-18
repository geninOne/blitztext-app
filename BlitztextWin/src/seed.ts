// Arbeiten beim Start, wie auf dem Mac (AppState.seedCustomModesIfNeeded und
// removeCustomModeOrphans): Startmodi einmalig anlegen, Kuerzel verschwundener
// Modi entfernen, doppelte Kuerzel aus alten Dateien bereinigen.
import type { Settings } from "./config";
import { assignHotkey } from "./mode-editor";
import { modeFromTemplate, modeTemplates } from "./modes";

// Die Vorlagen, die beim ersten Start als eigene Modi angelegt werden, wie
// CustomModeTemplate.defaultSeeds auf dem Mac.
const SEED_IDS = ["email", "bullets"];

// Legt die Startmodi einmalig an und haengt sie hinter vorhandene eigene Modi.
// Danach geloeschte Startmodi bleiben geloescht, weil das Merkmal gesetzt ist.
// Wahr, wenn sich etwas geaendert hat und gespeichert werden muss.
export function seedCustomModesIfNeeded(settings: Settings): boolean {
  if (settings.hasSeededCustomModes) return false;
  const templates = modeTemplates();
  for (const id of SEED_IDS) {
    const template = templates.find((t) => t.id === id);
    if (template) settings.modes.push(modeFromTemplate(template));
  }
  settings.hasSeededCustomModes = true;
  return true;
}

// Entfernt Kuerzel eigener Modi, die es nicht mehr gibt. Nur "custom-..."
// Schluessel: ein leerer Eintrag bei den eingebauten Modi heisst "bewusst kein
// Kuerzel" und muss stehen bleiben, sonst legt der Lader den Standard zurueck.
export function removeCustomModeOrphans(settings: Settings): boolean {
  const known = new Set(settings.modes.map((m) => m.id));
  let changed = false;
  for (const key of Object.keys(settings.hotkeys)) {
    if (key.startsWith("custom-") && !known.has(key)) {
      delete settings.hotkeys[key];
      changed = true;
    }
  }
  return changed;
}

// Wendet erfolgreich angemeldete Kuerzel in Anmeldereihenfolge an: das zuletzt
// angemeldete gewinnt, die anderen mit derselben Kombination werden leer.
// Wahr, wenn dabei ein Kuerzel verloren ging.
export function reconcileDuplicateHotkeys(
  settings: Settings,
  registered: Array<[string, string]>,
): boolean {
  let changed = false;
  for (const [id, accelerator] of registered) {
    if (assignHotkey(settings, id, accelerator).length > 0) changed = true;
  }
  return changed;
}
