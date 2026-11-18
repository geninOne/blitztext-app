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

// Meldet alle gespeicherten Kuerzel in der Reihenfolge von `ids` an. Die
// Kuerzel werden vorab als Momentaufnahme gelesen, sonst wuerde das Leeren eines
// frueheren Halters dessen spaeteren Durchlauf ueberspringen. Nach jeder
// erfolgreichen Anmeldung gibt `assignHotkey` den anderen Haltern derselben
// Kombination ein leeres Kuerzel: das zuletzt angemeldete gewinnt. Leere
// Eintraege werden uebersprungen, ein gescheiterter Aufruf aendert nichts.
// Wahr, wenn sich `settings.hotkeys` geaendert hat und gespeichert werden muss.
export async function registerAllHotkeys(
  settings: Settings,
  ids: string[],
  setHotkey: (id: string, accelerator: string) => Promise<void>,
): Promise<boolean> {
  const snapshot = ids.map((id): [string, string] => [id, settings.hotkeys[id]]);
  let changed = false;
  for (const [id, accelerator] of snapshot) {
    if (!accelerator) continue;
    try {
      await setHotkey(id, accelerator);
    } catch {
      continue; // ungueltige Kombination zeigt sich erst beim Bearbeiten
    }
    if (assignHotkey(settings, id, accelerator).length > 0) changed = true;
  }
  return changed;
}
