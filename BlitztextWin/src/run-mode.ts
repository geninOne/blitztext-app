// Ein Diktat durch einen Modus schicken, wie CustomModeWorkflow.swift und
// TextRewriter.swift auf dem Mac. Die Abhaengigkeiten (Modellaufruf,
// Spracherkennung) kommen als Parameter, damit die Tests ohne Tauri laufen.
import promptData from "../../shared/prompts.json";
import type { WorkflowType } from "./config";
import { hasInstruction, systemPromptForMode, type CustomMode, type PromptLanguage } from "./modes";

export interface RunDeps {
  chat(system: string, user: string): Promise<string>;
  language(text: string): Promise<PromptLanguage>;
}

export interface RunOptions {
  // Eigennamen, die exakt so geschrieben werden muessen.
  terms?: string[];
  // Text um den Cursor; auf Windows noch leer (kein FocusedFieldReader).
  context?: string;
}

// aiFailed: der Modellschritt ist gescheitert, text ist dann das Transkript.
// reason sagt warum, fuer die Statuszeile.
export interface RunResult {
  text: string;
  aiFailed: boolean;
  reason?: string;
}

// Wie CustomModeWorkflow.emptyAnswerReason auf dem Mac.
export const EMPTY_ANSWER_REASON = "Die KI hat keinen Text geliefert.";

function reasonOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

// Gemeinsame Regel fuer eingebaute und eigene Modi (AIStepFailed auf dem Mac):
// wirft der Modellschritt oder antwortet er leer, bleibt das Gesagte erhalten.
export async function rewriteOrKeep(transcript: string, rewrite: () => Promise<string>): Promise<RunResult> {
  let answer: string;
  try {
    answer = await rewrite();
  } catch (error) {
    return { text: transcript, aiFailed: true, reason: reasonOf(error) };
  }
  if (answer.trim().length === 0) {
    return { text: transcript, aiFailed: true, reason: EMPTY_ANSWER_REASON };
  }
  return { text: answer, aiFailed: false };
}

// Eigene Modi laufen als "generate": Diktatregeln ja, Rahmenregel nein.
// Anweisung, Eigennamen, Kontext und Regeln folgen der Sprache des Transkripts.
export async function runMode(
  mode: CustomMode,
  transcript: string,
  deps: RunDeps,
  options: RunOptions = {},
): Promise<RunResult> {
  // Ohne Anweisung wortgenau; ohne Text gibt es nichts umzuschreiben.
  if (!hasInstruction(mode) || transcript.length === 0) {
    return { text: transcript, aiFailed: false };
  }
  let language: PromptLanguage;
  try {
    language = await deps.language(transcript);
  } catch {
    language = "de";
  }
  const instruction = systemPromptForMode(mode, options.terms ?? [], options.context ?? "", language)!;
  // Wie TextRewriter.rewrite: die Regeln nach einer Leerzeile hinter der Anweisung.
  const system = instruction + "\n\n" + promptData.spokenTranscriptRules[language];
  return rewriteOrKeep(transcript, () => deps.chat(system, transcript));
}

// Was eine Kennung aus Menue oder Kuerzel ausloest.
export type ModeTarget = { kind: "builtIn"; workflow: WorkflowType } | { kind: "custom"; mode: CustomMode };

const BUILT_IN: readonly WorkflowType[] = ["transcribe", "improve", "dampf", "emoji"];

// Eingebauter Name oder Kennung eines eigenen Modus. Ohne Kennung gilt
// Blitztext, wie bisher. Eine unbekannte Kennung (Modus geloescht) gibt null:
// dann startet keine Aufnahme.
export function resolveModeId(id: string, modes: CustomMode[]): ModeTarget | null {
  if (!id) return { kind: "builtIn", workflow: "transcribe" };
  if ((BUILT_IN as readonly string[]).includes(id)) return { kind: "builtIn", workflow: id as WorkflowType };
  const mode = modes.find((m) => m.id === id);
  return mode ? { kind: "custom", mode } : null;
}
