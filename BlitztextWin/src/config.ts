import { invoke } from "@tauri-apps/api/core";
import promptData from "../../shared/prompts.json";
import type { CustomMode } from "./modes";

export type ApiProvider = "openAI" | "liteLLM";

export type TextTone = "formal" | "neutral" | "casual";
export type EmojiDensity = "wenig" | "mittel" | "viel";
// "hold" = push-to-talk (record while held); "toggle" = press to start/stop.
export type HotkeyMode = "hold" | "toggle";

export interface Settings {
  // Stand des Einstellungsformats; spaetere Uebernahmen erhoehen ihn.
  settingsVersion: number;
  apiProvider: ApiProvider;
  // Launch the app on login (Windows: registry Run key / macOS: LaunchAgent).
  autostart: boolean;
  hotkeyMode: HotkeyMode;
  // Automatische Update-Pruefung, hoechstens einmal pro Kalendertag.
  automaticUpdateChecks: boolean;
  // ISO-Zeitstempel der letzten Pruefung, null wenn noch nie geprueft.
  lastUpdateCheck: string | null;
  liteLLM: {
    baseURL: string;
    fastModel: string;
    strongModel: string;
    transcriptionModel: string;
  };
  // Global hotkeys per workflow, as accelerator strings (e.g. "Super+Shift+KeyD").
  // "Super" is the Windows key (= Cmd on the Mac dev machine). Key names follow
  // the W3C KeyboardEvent.code values, so the in-app recorder can store them 1:1.
  // Ein leerer Eintrag ("") heisst "bewusst kein Kuerzel". Bei den eingebauten
  // Schluesseln darf er nie geloescht werden, sonst legt der Lader beim naechsten
  // Start das Standardkuerzel wieder darunter.
  // Der Schluessel ist die Modus-ID; die vier alten Workflow-Namen bleiben
  // vorerst als Eintraege stehen, bis die Uebernahme sie in Modi umwandelt.
  hotkeys: Record<string, string>;
  // Eigene Modi, wie auf dem Mac frei anlegbar.
  modes: CustomMode[];
  // Wahr, sobald die Startmodi einmal angelegt wurden; danach geloeschte bleiben weg.
  hasSeededCustomModes: boolean;
  // Per-workflow tuning, mirroring the macOS app's "Anpassen" tab.
  improve: {
    tone: TextTone;
    systemPrompt: string; // custom instruction; overrides the default base prompt
    context: string;
    customTerms: string[];
  };
  dampf: {
    systemPrompt: string; // custom instruction; overrides the default prompt
  };
  emoji: {
    density: EmojiDensity;
  };
}

// Gleiche Regel wie `normalize_base` in src-tauri/src/settings.rs: aus einer
// eingegebenen Gateway-Adresse die nackte Basis machen. Entfernt abschliessende
// Schraegstriche sowie abschliessende "/v1"- und "/ui"-Segmente in beliebiger
// Reihenfolge, ohne auf Gross- und Kleinschreibung zu achten.
export function normalizeBaseUrl(raw: string): string {
  let value = raw.trim().replace(/\/+$/, "");
  for (;;) {
    const lower = value.toLowerCase();
    if (!lower.endsWith("/v1") && !lower.endsWith("/ui")) break;
    value = value.slice(0, -3).replace(/\/+$/, "");
  }
  return value;
}

// The four dictation workflows, mirroring the macOS app.
export type WorkflowType = "transcribe" | "improve" | "dampf" | "emoji";

// UI labels and the macOS "Blitztext…" product names per workflow.
export const workflowLabels: Record<WorkflowType, string> = {
  transcribe: "Diktat",
  improve: "Text verbessern",
  dampf: "Dampf ablassen",
  emoji: "Emojis",
};

export const workflowBrandNames: Record<WorkflowType, string> = {
  transcribe: "Blitztext",
  improve: "Blitztext+",
  dampf: "Blitztext $%&!",
  emoji: "Blitztext :)",
};

const SETTINGS_KEY = "blitztext.settings";
export const LITELLM_KEY_ACCOUNT = "liteLLMApiKey";

export const defaultSettings: Settings = {
  settingsVersion: 1,
  apiProvider: "liteLLM",
  autostart: false,
  hotkeyMode: "hold",
  automaticUpdateChecks: true,
  lastUpdateCheck: null,
  liteLLM: {
    baseURL: "",
    fastModel: "gpt-4o-mini",
    strongModel: "gpt-5.5",
    transcriptionModel: "gpt-4o-transcribe",
  },
  hotkeys: {
    transcribe: "Super+Shift+KeyD",
    improve: "Super+Shift+KeyI",
    dampf: "Super+Shift+KeyA",
    emoji: "Super+Shift+KeyE",
  },
  modes: [],
  hasSeededCustomModes: false,
  improve: {
    tone: "neutral",
    systemPrompt: "",
    context: "",
    customTerms: [],
  },
  dampf: {
    // Pre-filled with the default prompt (editable), exactly like the macOS app.
    systemPrompt: promptData.dampfAblassen.default,
  },
  emoji: {
    density: "mittel",
  },
};

// Liest die frueheren Einstellungen roh aus dem localStorage, nur fuer die
// einmalige Uebernahme in die Datei (siehe settings-store.ts). Der Eintrag
// bleibt stehen, als Rueckweg. null, wenn nichts da oder unlesbar.
export function readLegacySettings(): unknown | null {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// Secret helpers backed by the Rust keyring commands.
export async function setSecret(account: string, value: string): Promise<void> {
  await invoke("secret_set", { account, value });
}

export async function getSecret(account: string): Promise<string | null> {
  return (await invoke<string | null>("secret_get", { account })) ?? null;
}

export async function hasSecret(account: string): Promise<boolean> {
  return await invoke<boolean>("secret_has", { account });
}
