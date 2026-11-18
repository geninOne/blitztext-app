import { describe, expect, it } from "vitest";
import { icons } from "lucide";
import { defaultSettings, type Settings } from "./config";
import { addMode, assignHotkey, displayName, removeMode, updateMode } from "./mode-editor";
import { lucideNameFor, modeSymbols } from "./mode-icons";
import { modeFromTemplate, modeTemplates, newMode } from "./modes";
import iconMap from "../../shared/mode-icons.json";

// Abgeschrieben aus CustomMode.symbols in BlitztextShared/Modes/CustomMode.swift,
// in derselben Reihenfolge.
const MAC_SYMBOLS = [
  "wand.and.stars", "envelope.fill", "arrowshape.turn.up.left.fill", "number", "list.bullet", "globe",
  "text.append", "briefcase.fill", "person.2.fill", "checklist", "quote.bubble.fill",
  "doc.text.fill", "lightbulb.fill",
];

function frisch(): Settings {
  return structuredClone(defaultSettings);
}

describe("Modusverwaltung", () => {
  it("Loeschen eines Modus entfernt ihn und sein Kuerzel", () => {
    const s = frisch();
    const a = newMode("Eins");
    const b = newMode("Zwei");
    s.modes.push(a, b);
    s.hotkeys[a.id] = "Super+Shift+KeyM";

    const ergebnis = removeMode(s, a.id);

    expect(ergebnis.hadHotkey).toBe(true);
    expect(s.modes).toEqual([b]);
    expect(a.id in s.hotkeys).toBe(false);
    // Die uebrigen Kuerzel bleiben unberuehrt.
    expect(s.hotkeys.transcribe).toBe("Super+Shift+KeyD");
  });

  it("Loeschen eines Modus ohne Kuerzel meldet hadHotkey false", () => {
    const s = frisch();
    const a = newMode("Eins");
    s.modes.push(a);
    const vorher = { ...s.hotkeys };

    expect(removeMode(s, a.id).hadHotkey).toBe(false);
    expect(s.modes).toEqual([]);
    expect(s.hotkeys).toEqual(vorher);
  });

  it("Anlegen aus einer Vorlage uebernimmt Name, Symbol und Anweisung", () => {
    const s = frisch();
    const vorlage = modeTemplates()[0];

    addMode(s, modeFromTemplate(vorlage));

    expect(s.modes).toHaveLength(1);
    const [modus] = s.modes;
    expect(modus.name).toBe("Als E-Mail");
    expect(modus.icon).toBe("envelope.fill");
    expect(modus.prompt).toBe(vorlage.prompt);
    expect(modus.id).toMatch(/^custom-[0-9a-f-]{36}$/);
  });

  it("Anlegen haengt hinten an", () => {
    const s = frisch();
    const a = newMode("Eins");
    const b = newMode("Zwei");
    addMode(s, a);
    addMode(s, b);
    expect(s.modes.map((m) => m.id)).toEqual([a.id, b.id]);
  });

  it("Bearbeiten ersetzt nur den Modus mit derselben Kennung", () => {
    const s = frisch();
    const a = newMode("Eins");
    const b = newMode("Zwei", "globe", "Uebersetze.");
    const c = newMode("Drei");
    s.modes.push(a, b, c);

    updateMode(s, { ...b, name: "Zwei neu", color: "night" });

    expect(s.modes.map((m) => m.name)).toEqual(["Eins", "Zwei neu", "Drei"]);
    expect(s.modes[1]).toEqual({ ...b, name: "Zwei neu", color: "night" });
    expect(s.modes[0]).toBe(a);
    expect(s.modes[2]).toBe(c);
  });

  it("Bearbeiten mit unbekannter Kennung aendert nichts", () => {
    const s = frisch();
    const a = newMode("Eins");
    s.modes.push(a);
    updateMode(s, newMode("Fremd"));
    expect(s.modes).toEqual([a]);
  });

  it("Zuweisen nimmt das Kuerzel einem anderen Halter weg", () => {
    // Wie set_hotkey im Rust-Kern: wer die Kombination vorher hatte, verliert sie.
    const s = frisch();
    const a = newMode("Eins");
    s.modes.push(a);

    const verloren = assignHotkey(s, a.id, "Super+Shift+KeyD");

    expect(verloren).toEqual(["transcribe"]);
    expect(s.hotkeys[a.id]).toBe("Super+Shift+KeyD");
    // Leer statt geloescht: ein fehlender Workflow-Eintrag bekaeme beim
    // naechsten Laden seinen Standard zurueck und damit wieder dieselbe Kombination.
    expect(s.hotkeys.transcribe).toBe("");
    expect(s.hotkeys.improve).toBe("Super+Shift+KeyI");
  });

  it("die eigene Kombination erneut zu setzen nimmt niemandem etwas", () => {
    const s = frisch();
    expect(assignHotkey(s, "transcribe", "Super+Shift+KeyD")).toEqual([]);
    expect(s.hotkeys.transcribe).toBe("Super+Shift+KeyD");
  });
});

describe("Anzeigename", () => {
  it("ein leerer Name erscheint als Ohne Namen", () => {
    expect(displayName(newMode("   "))).toBe("Ohne Namen");
    expect(displayName(newMode(" Mail "))).toBe("Mail");
  });
});

describe("Symbolzuordnung", () => {
  it("jedes Symbol aus CustomMode.symbols hat eine Zuordnung", () => {
    expect(Object.keys(iconMap)).toEqual(MAC_SYMBOLS);
    expect(modeSymbols()).toEqual(MAC_SYMBOLS);
  });

  it("jede Zuordnung zeigt auf ein vorhandenes Lucide-Symbol", () => {
    for (const symbol of MAC_SYMBOLS) {
      const name = lucideNameFor(symbol);
      // Gleich dem Eintrag der Datei heisst: das Symbol ist in mode-icons.ts
      // eingebunden und faellt nicht stillschweigend zurueck.
      expect(name).toBe(iconMap[symbol as keyof typeof iconMap]);
      expect(name in icons, `${symbol} -> ${name}`).toBe(true);
    }
  });

  it("ein unbekannter Name faellt auf das Symbol von wand.and.stars zurueck", () => {
    expect(lucideNameFor("gibt.es.nicht")).toBe(lucideNameFor("wand.and.stars"));
  });

  it("jede Vorlage nutzt ein Symbol aus der Auswahl", () => {
    for (const vorlage of modeTemplates()) {
      expect(MAC_SYMBOLS).toContain(vorlage.icon);
    }
  });
});
