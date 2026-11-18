import { describe, expect, it } from "vitest";
import { hasInstruction, modeTemplates, newMode, systemPromptForMode } from "./modes";

describe("Modusmodell", () => {
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
});
