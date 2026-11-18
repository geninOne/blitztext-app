import { describe, expect, it } from "vitest";
import { defaultSettings, type Settings } from "./config";
import { newMode } from "./modes";
import { registerAllHotkeys, removeCustomModeOrphans, seedCustomModesIfNeeded } from "./seed";

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

describe("Kuerzel beim Start anmelden", () => {
  const IDS = ["transcribe", "improve", "dampf", "emoji"];

  it("bei gleichem Kuerzel gewinnt der zuletzt angemeldete, beide werden angemeldet", async () => {
    const s = defaults();
    s.hotkeys.transcribe = "Super+Shift+KeyX";
    s.hotkeys.improve = "Super+Shift+KeyX";
    const aufrufe: string[] = [];
    const geaendert = await registerAllHotkeys(s, IDS, async (id) => {
      aufrufe.push(id);
    });
    expect(geaendert).toBe(true);
    expect(aufrufe).toEqual(["transcribe", "improve", "dampf", "emoji"]);
    expect(s.hotkeys.improve).toBe("Super+Shift+KeyX");
    expect(s.hotkeys.transcribe).toBe("");
  });

  it("scheitert der zweite Halter, behaelt der erste sein Kuerzel", async () => {
    const s = defaults();
    s.hotkeys.transcribe = "Super+Shift+KeyX";
    s.hotkeys.improve = "Super+Shift+KeyX";
    const geaendert = await registerAllHotkeys(s, IDS, async (id) => {
      if (id === "improve") throw new Error("belegt");
    });
    // Der erste Halter hat die Kombination angemeldet und behaelt sie; der
    // zweite verliert sie schon mit dessen Anmeldung, sein Fehlschlag aendert nichts mehr.
    expect(geaendert).toBe(true);
    expect(s.hotkeys.transcribe).toBe("Super+Shift+KeyX");
    expect(s.hotkeys.improve).toBe("");
  });

  it("leere Eintraege werden nicht angemeldet", async () => {
    const s = defaults();
    s.hotkeys.dampf = "";
    const aufrufe: string[] = [];
    const geaendert = await registerAllHotkeys(s, IDS, async (id) => {
      aufrufe.push(id);
    });
    expect(geaendert).toBe(false);
    expect(aufrufe).toEqual(["transcribe", "improve", "emoji"]);
  });
});
