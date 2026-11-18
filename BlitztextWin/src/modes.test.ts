import { describe, expect, it } from "vitest";
import { hasInstruction, modeFromTemplate, modeTemplates, newMode, systemPromptForMode } from "./modes";

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

  it("die Vorlagen behalten ihre Kennungen ueber Aufrufe hinweg", () => {
    const ids = modeTemplates().map((m) => m.id);
    expect(ids).toEqual(["email", "bullets", "reply", "english", "summary"]);
    expect(modeTemplates().map((m) => m.id)).toEqual(ids);
  });

  it("modeFromTemplate vergibt bei jedem Aufruf eine neue custom-<uuid>", () => {
    const vorlage = modeTemplates()[0];
    const a = modeFromTemplate(vorlage);
    const b = modeFromTemplate(vorlage);
    expect(a.id).toMatch(/^custom-[0-9a-f-]{36}$/);
    expect(a.id).not.toBe(b.id);
    expect(a.name).toBe(vorlage.name);
    expect(a.prompt).toBe(vorlage.prompt);
  });
});
