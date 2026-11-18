// Eigene Modi, gespiegelt von BlitztextShared/Modes/CustomMode.swift und
// ModePrompts.swift. Die Vorlagen stehen in shared/prompts.json, damit beide
// Apps dieselben Texte anbieten.
import promptData from "../../shared/prompts.json";

export interface CustomMode {
  // Form "custom-<uuid>"; dient auch als Schluessel fuer die Hotkeys.
  id: string;
  name: string;
  // SF-Symbol-Name wie auf dem Mac; die Abbildung auf Windows folgt spaeter.
  icon: string;
  prompt: string;
  color?: "day" | "evening" | "night";
}

export function newMode(name = "", icon = "wand.and.stars", prompt = ""): CustomMode {
  return { id: `custom-${crypto.randomUUID()}`, name, icon, prompt };
}

// Ohne Anweisung bleibt der Text woertlich und es braucht kein Sprachmodell.
export function hasInstruction(mode: CustomMode): boolean {
  return mode.prompt.trim().length > 0;
}

// Die Vorlagen als frische Modi mit eigener ID, in der Reihenfolge der Datei.
export function modeTemplates(): CustomMode[] {
  return promptData.modeTemplates.map((t) => newMode(t.name, t.icon, t.prompt));
}

// Wie CustomModeWorkflow auf dem Mac: Anweisung, geschuetzte Eigennamen,
// Kontext aus dem Textfeld, jeweils nur wenn gefuellt.
export function systemPromptForMode(mode: CustomMode, terms: string[], context: string): string | null {
  if (!hasInstruction(mode)) return null;
  let prompt = mode.prompt;
  if (terms.length > 0) {
    prompt += `\n\nWichtig: Diese Eigennamen und Fachbegriffe müssen exakt so geschrieben werden: ${terms.join(", ")}`;
  }
  if (context.length > 0) {
    prompt +=
      "\n\nKontext aus dem Textfeld, zum Beispiel die Nachricht, auf die geantwortet wird:\n" +
      `"""\n${context}\n"""\n` +
      "Nutze den Kontext nur zum Verständnis. Übernimm ihn nicht in deine Antwort und gib nur den neuen Text zurück.";
  }
  return prompt;
}
