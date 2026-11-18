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

// Eine Vorlage mit fester Kennung ("email", "bullets" ...), wie `CustomModeTemplate`.
export interface ModeTemplate {
  id: string;
  name: string;
  icon: string;
  prompt: string;
}

// Die fuenf Vorlagen in der Reihenfolge der Datei; die Kennungen bleiben stabil.
export function modeTemplates(): ModeTemplate[] {
  return promptData.modeTemplates.map((t) => ({ ...t }));
}

// Macht aus einer Vorlage einen Modus mit frischer ID, wie `makeMode()` auf dem Mac.
export function modeFromTemplate(template: ModeTemplate): CustomMode {
  return newMode(template.name, template.icon, template.prompt);
}

// Sprache der Anweisungen, wie PromptLanguage auf dem Mac.
export type PromptLanguage = "de" | "en";

// Setzt einen Wert fuer einen Platzhalter ein. Die Funktion als Ersatz sorgt
// dafuer, dass "$&" oder "$1" im Nutzertext woertlich bleiben.
function fill(template: string, placeholder: string, value: string): string {
  return template.replace(placeholder, () => value);
}

// Wie CustomModeWorkflow auf dem Mac: Anweisung, geschuetzte Eigennamen,
// Kontext aus dem Textfeld, jeweils nur wenn gefuellt. Die Rahmentexte stehen
// in shared/prompts.json (modeFrames), zeichengenau aus ModePrompts.swift.
export function systemPromptForMode(
  mode: CustomMode,
  terms: string[],
  context: string,
  language: PromptLanguage = "de",
): string | null {
  if (!hasInstruction(mode)) return null;
  const frames = promptData.modeFrames;
  let prompt = mode.prompt;
  if (terms.length > 0) {
    prompt += fill(frames.customTerms[language], "{{terms}}", terms.join(", "));
  }
  if (context.length > 0) {
    prompt += fill(frames.fieldContext[language], "{{context}}", context);
  }
  return prompt;
}
