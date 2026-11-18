import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("./config", async (orig) => ({
  ...(await orig<typeof import("./config")>()),
  readLegacySettings: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { defaultSettings, readLegacySettings } from "./config";
import { loadSettings, resetSettingsStoreForTests, saveSettings } from "./settings-store";

const invokeMock = vi.mocked(invoke);
const legacyMock = vi.mocked(readLegacySettings);

// Antworten des Rust-Kerns je Kommando. settings_save merkt sich, was ankam.
let antworten: Record<string, unknown>;
function mockInvoke(command: string, result: unknown): void {
  antworten[command] = result;
}
// Antwort von settings_load: Status und bei "ok" der Dateiinhalt.
function mockLoad(status: "missing" | "ok" | "corrupt" | "unreadable", json?: string): void {
  mockInvoke("settings_load", json === undefined ? { status } : { status, json });
}
function saveAufrufe(): string[] {
  return invokeMock.mock.calls
    .filter(([command]) => command === "settings_save")
    .map(([, args]) => (args as { json: string }).json);
}

beforeEach(() => {
  antworten = {};
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (command: string) => {
    const result = antworten[command];
    if (result instanceof Error) throw result;
    return result;
  });
  legacyMock.mockReset();
  legacyMock.mockReturnValue(null);
  resetSettingsStoreForTests();
});

describe("Einstellungen aus der Datei", () => {
  it("ergaenzt fehlende Felder mit den Standardwerten", async () => {
    mockLoad("ok", '{"hotkeyMode":"toggle"}');
    const s = await loadSettings();
    expect(s.hotkeyMode).toBe("toggle");
    expect(s.liteLLM.baseURL).toBe("");
    expect(s.settingsVersion).toBe(1);
  });

  it("fuehrt verschachtelte Felder mit den Standardwerten zusammen", async () => {
    mockLoad(
      "ok",
      JSON.stringify({
        liteLLM: { baseURL: "http://gw:4000" },
        hotkeys: { transcribe: "Ctrl+KeyT" },
        improve: { tone: "formal" },
        emoji: {},
      }),
    );
    const s = await loadSettings();
    expect(s.liteLLM).toEqual({ ...defaultSettings.liteLLM, baseURL: "http://gw:4000" });
    expect(s.hotkeys).toEqual({ ...defaultSettings.hotkeys, transcribe: "Ctrl+KeyT" });
    expect(s.improve).toEqual({ ...defaultSettings.improve, tone: "formal" });
    expect(s.emoji).toEqual(defaultSettings.emoji);
  });

  it("ein leerer Dampf-Prompt faellt auf den Standardtext zurueck", async () => {
    mockLoad("ok", '{"dampf":{"systemPrompt":"   "}}');
    const s = await loadSettings();
    expect(s.dampf.systemPrompt).toBe(defaultSettings.dampf.systemPrompt);
    expect(s.dampf.systemPrompt.trim()).not.toBe("");
  });

  it("veraendert die Standardwerte nicht", async () => {
    mockLoad("missing");
    const s = await loadSettings();
    s.liteLLM.baseURL = "http://anders";
    s.improve.customTerms.push("n8n");
    expect(defaultSettings.liteLLM.baseURL).toBe("");
    expect(defaultSettings.improve.customTerms).toEqual([]);
  });

  it("uebernimmt beim ersten Start die Einstellungen aus dem localStorage", async () => {
    mockLoad("missing");
    legacyMock.mockReturnValue({ liteLLM: { baseURL: "http://gw:4000" } });
    const s = await loadSettings();
    expect(s.liteLLM.baseURL).toBe("http://gw:4000");
    expect(s.liteLLM.fastModel).toBe(defaultSettings.liteLLM.fastModel);
    const saves = saveAufrufe();
    expect(saves).toHaveLength(1);
    expect(JSON.parse(saves[0]).liteLLM.baseURL).toBe("http://gw:4000");
  });

  it("eine vorhandene Datei hat Vorrang, das Altobjekt wird nicht gelesen", async () => {
    mockLoad("ok", '{"liteLLM":{"baseURL":"http://datei:4000"}}');
    legacyMock.mockReturnValue({ liteLLM: { baseURL: "http://alt:4000" } });
    const s = await loadSettings();
    expect(s.liteLLM.baseURL).toBe("http://datei:4000");
    expect(legacyMock).not.toHaveBeenCalled();
    expect(saveAufrufe()).toHaveLength(0);
  });

  it("ein gespeichertes modes: null faellt auf die leere Liste zurueck", async () => {
    mockLoad("ok", '{"modes":null,"hotkeyMode":"toggle"}');
    const s = await loadSettings();
    expect(s.modes).toEqual([]);
    expect(s.hotkeyMode).toBe("toggle");
  });

  it("Werte vom falschen Typ zerstoeren die uebrigen Einstellungen nicht", async () => {
    mockLoad(
      "ok",
      JSON.stringify({
        liteLLM: "kaputt",
        hotkeys: { transcribe: 5, improve: "Ctrl+KeyI" },
        improve: { customTerms: "n8n", context: "Team" },
        dampf: { systemPrompt: 7 },
        autostart: "ja",
        hotkeyMode: "toggle",
      }),
    );
    const s = await loadSettings();
    expect(s.liteLLM).toEqual(defaultSettings.liteLLM);
    expect(s.hotkeys.transcribe).toBe(defaultSettings.hotkeys.transcribe);
    expect(s.hotkeys.improve).toBe("Ctrl+KeyI");
    expect(s.improve.customTerms).toEqual([]);
    expect(s.improve.context).toBe("Team");
    expect(s.dampf.systemPrompt).toBe(defaultSettings.dampf.systemPrompt);
    expect(s.autostart).toBe(false);
    expect(s.hotkeyMode).toBe("toggle");
  });

  it("ohne Datei und ohne Altobjekt gibt es die Standardwerte und keinen Schreibvorgang", async () => {
    mockLoad("missing");
    const s = await loadSettings();
    expect(s).toEqual(defaultSettings);
    expect(saveAufrufe()).toHaveLength(0);
  });

  it("scheitert das Speichern der Uebernahme, bleiben die Altwerte trotzdem erhalten", async () => {
    mockLoad("missing");
    mockInvoke("settings_save", new Error("Platte voll"));
    legacyMock.mockReturnValue({ hotkeyMode: "toggle" });
    const fehler = vi.spyOn(console, "error").mockImplementation(() => {});
    const s = await loadSettings();
    expect(s.hotkeyMode).toBe("toggle");
    expect(fehler).toHaveBeenCalled();
    fehler.mockRestore();
  });

  it("scheitert das Lesen im Kern, wird nichts ueberschrieben", async () => {
    mockInvoke("settings_load", new Error("kein Konfigurationsordner"));
    legacyMock.mockReturnValue({ hotkeyMode: "toggle" });
    const fehler = vi.spyOn(console, "error").mockImplementation(() => {});
    const s = await loadSettings();
    expect(s.hotkeyMode).toBe("toggle");
    s.hotkeyMode = "hold";
    await expect(saveSettings(s)).rejects.toThrow();
    expect(saveAufrufe()).toHaveLength(0);
    fehler.mockRestore();
  });

  it("eine unlesbare Datei sperrt das Speichern fuer die Sitzung", async () => {
    mockLoad("unreadable");
    legacyMock.mockReturnValue({ liteLLM: { baseURL: "http://alt:4000" } });
    const fehler = vi.spyOn(console, "error").mockImplementation(() => {});
    const s = await loadSettings();
    expect(s).toEqual(defaultSettings);
    expect(legacyMock).not.toHaveBeenCalled();
    s.hotkeyMode = "toggle";
    await expect(saveSettings(s)).rejects.toThrow(/nicht lesbar/);
    await expect(saveSettings(s)).rejects.toThrow(/nicht lesbar/);
    expect(saveAufrufe()).toHaveLength(0);
    fehler.mockRestore();
  });

  it("eine kaputte Datei fuehrt zu Standardwerten ohne Uebernahme, Speichern bleibt erlaubt", async () => {
    mockLoad("corrupt");
    legacyMock.mockReturnValue({ liteLLM: { baseURL: "http://alt:4000" } });
    const fehler = vi.spyOn(console, "error").mockImplementation(() => {});
    const s = await loadSettings();
    fehler.mockRestore();
    expect(s).toEqual(defaultSettings);
    expect(legacyMock).not.toHaveBeenCalled();
    expect(saveAufrufe()).toHaveLength(0);
    s.hotkeyMode = "toggle";
    await saveSettings(s);
    expect(saveAufrufe()).toHaveLength(1);
    expect(JSON.parse(saveAufrufe()[0]).hotkeyMode).toBe("toggle");
  });

  it("eine vorhandene leere Datei loest keine Uebernahme aus", async () => {
    mockLoad("ok", "{}");
    legacyMock.mockReturnValue({ liteLLM: { baseURL: "http://alt:4000" } });
    const s = await loadSettings();
    expect(s).toEqual(defaultSettings);
    expect(legacyMock).not.toHaveBeenCalled();
  });

  it("saveSettings schickt das ganze Objekt als JSON an den Kern", async () => {
    const s = structuredClone(defaultSettings);
    s.hotkeyMode = "toggle";
    await saveSettings(s);
    expect(invokeMock).toHaveBeenCalledWith("settings_save", { json: JSON.stringify(s) });
  });
});
