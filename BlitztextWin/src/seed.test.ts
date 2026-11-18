import { describe, expect, it } from "vitest";
import { defaultSettings, type Settings } from "./config";
import { newMode } from "./modes";
import { reconcileDuplicateHotkeys, removeCustomModeOrphans, seedCustomModesIfNeeded } from "./seed";

function defaults(): Settings {
  return structuredClone(defaultSettings);
}

describe("Startmodi", () => {
  it("legt beim ersten Start Als E-Mail und Stichpunkte an", () => {
    const s = defaults();
    expect(seedCustomModesIfNeeded(s)).toBe(true);
    expect(s.modes.map((m) => m.name)).toEqual(["Als E-Mail", "Stichpunkte"]);
    expect(s.hasSeededCustomModes).toBe(true);
  });

  it("legt nichts an, wenn schon einmal angelegt wurde, auch wenn die Liste leer ist", () => {
    const s = defaults();
    s.hasSeededCustomModes = true;
    s.modes = [];
    expect(seedCustomModesIfNeeded(s)).toBe(false);
    expect(s.modes).toEqual([]);
  });

  it("haengt die Startmodi an vorhandene eigene Modi an", () => {
    const s = defaults();
    const eigener = newMode("Mein Modus");
    s.modes = [eigener];
    expect(seedCustomModesIfNeeded(s)).toBe(true);
    expect(s.modes.map((m) => m.name)).toEqual(["Mein Modus", "Als E-Mail", "Stichpunkte"]);
    expect(s.modes[0]).toBe(eigener);
  });

  it("legt die Startmodi nur einmal an", () => {
    const s = defaults();
    seedCustomModesIfNeeded(s);
    s.modes = s.modes.filter((m) => m.name !== "Stichpunkte");
    expect(seedCustomModesIfNeeded(s)).toBe(false);
    expect(s.modes.map((m) => m.name)).toEqual(["Als E-Mail"]);
  });
});

describe("Verwaiste Kuerzel", () => {
  it("entfernt Kuerzel von geloeschten eigenen Modi", () => {
    const s = defaults();
    s.hotkeys["custom-weg"] = "Super+Shift+KeyW";
    expect(removeCustomModeOrphans(s)).toBe(true);
    expect("custom-weg" in s.hotkeys).toBe(false);
  });

  it("laesst Kuerzel vorhandener eigener Modi stehen", () => {
    const s = defaults();
    const m = newMode("Da");
    s.modes = [m];
    s.hotkeys[m.id] = "Super+Shift+KeyM";
    expect(removeCustomModeOrphans(s)).toBe(false);
    expect(s.hotkeys[m.id]).toBe("Super+Shift+KeyM");
  });

  it("laesst die Kuerzel der eingebauten Modi stehen, auch leere", () => {
    const s = defaults();
    s.hotkeys.emoji = "";
    expect(removeCustomModeOrphans(s)).toBe(false);
    expect(Object.keys(s.hotkeys)).toEqual(["transcribe", "improve", "dampf", "emoji"]);
    expect(s.hotkeys.emoji).toBe("");
  });
});

describe("Doppelte Kuerzel", () => {
  it("das zuletzt registrierte gewinnt, der andere bekommt leer", () => {
    const s = defaults();
    s.hotkeys.transcribe = "Super+Shift+KeyX";
    s.hotkeys.improve = "Super+Shift+KeyX";
    const geaendert = reconcileDuplicateHotkeys(s, [
      ["transcribe", "Super+Shift+KeyX"],
      ["improve", "Super+Shift+KeyX"],
    ]);
    expect(geaendert).toBe(true);
    expect(s.hotkeys.improve).toBe("Super+Shift+KeyX");
    expect(s.hotkeys.transcribe).toBe("");
  });

  it("meldet keine Aenderung ohne Doppelung", () => {
    const s = defaults();
    expect(reconcileDuplicateHotkeys(s, Object.entries(s.hotkeys))).toBe(false);
  });
});
