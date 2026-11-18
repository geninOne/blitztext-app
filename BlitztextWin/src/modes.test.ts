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

  it("setzt Anweisung, Eigennamen und Kontext auf Deutsch in fester Reihenfolge zusammen", () => {
    const mode = newMode("Mail", "envelope.fill", "Schreib eine Mail.");
    expect(systemPromptForMode(mode, ["n8n", "evia"], "Hallo Jana", "de")).toBe(
      "Schreib eine Mail." +
        "\n\nWichtig: Diese Eigennamen und Fachbegriffe müssen exakt so geschrieben werden: n8n, evia" +
        "\n\nKontext aus dem Textfeld, zum Beispiel die Nachricht, auf die geantwortet wird:\n" +
        '"""\nHallo Jana\n"""\n' +
        "Nutze den Kontext nur zum Verständnis. Übernimm ihn nicht in deine Antwort und gib nur den neuen Text zurück.",
    );
  });

  it("setzt Anweisung, Eigennamen und Kontext auf Englisch in fester Reihenfolge zusammen", () => {
    const mode = newMode("Mail", "envelope.fill", "Schreib eine Mail.");
    expect(systemPromptForMode(mode, ["n8n", "evia"], "Hi Jana", "en")).toBe(
      "Schreib eine Mail." +
        "\n\nImportant: these names and terms must be spelled exactly like this: n8n, evia" +
        "\n\nContext from the text field, for example the message being replied to:\n" +
        '"""\nHi Jana\n"""\n' +
        "Use the context only for understanding. Do not copy it into your answer; return only the new text.",
    );
  });

  it("ohne Sprachangabe gilt Deutsch, leere Teile fallen weg", () => {
    const mode = newMode("Mail", "envelope.fill", "Schreib eine Mail.");
    expect(systemPromptForMode(mode, [], "")).toBe("Schreib eine Mail.");
    expect(systemPromptForMode(mode, ["n8n"], "")).toBe(
      "Schreib eine Mail.\n\nWichtig: Diese Eigennamen und Fachbegriffe müssen exakt so geschrieben werden: n8n",
    );
  });

  it("uebernimmt Dollarzeichen in Eigennamen und Kontext woertlich", () => {
    const mode = newMode("Mail", "envelope.fill", "X");
    const prompt = systemPromptForMode(mode, ["$&"], "Preis $1 und $'", "de")!;
    expect(prompt).toContain("geschrieben werden: $&");
    expect(prompt).toContain('"""\nPreis $1 und $\'\n"""');
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
