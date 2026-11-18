import { invoke } from "@tauri-apps/api/core";
import { defaultSettings, readLegacySettings, type Settings } from "./config";
import type { CustomMode } from "./modes";

// Einstellungen liegen als settings.json im Konfigurationsordner der App und
// werden vom Rust-Kern gelesen und geschrieben (settings_load/settings_save).
// Der API-Schluessel gehoert nicht dazu, er liegt im Schluesselbund.

type Objekt = Record<string, unknown>;

function istObjekt(wert: unknown): wert is Objekt {
  return typeof wert === "object" && wert !== null && !Array.isArray(wert);
}

function art(wert: unknown): string {
  if (Array.isArray(wert)) return "array";
  if (wert === null) return "null";
  return typeof wert;
}

// Ein gespeicherter Wert gilt nur, wenn er dieselbe Art hat wie der
// Standardwert. Wo der Standard null ist (lastUpdateCheck), ist auch Text gueltig.
function passt(standard: unknown, wert: unknown): boolean {
  if (standard === null) return wert === null || typeof wert === "string";
  return art(standard) === art(wert);
}

// Legt ein gespeichertes Objekt ueber die Standardwerte. Unbekannte Schluessel
// bleiben erhalten wie bisher, bekannte Schluessel vom falschen Typ fallen auf
// den Standardwert zurueck, statt die Einstellungen zu zerstoeren.
function ueberStandard<T extends object>(standard: T, gespeichert: unknown): T {
  const ergebnis: Objekt = structuredClone(standard) as Objekt;
  if (!istObjekt(gespeichert)) return ergebnis as T;
  for (const [schluessel, wert] of Object.entries(gespeichert)) {
    if (!(schluessel in ergebnis) || passt(ergebnis[schluessel], wert)) {
      ergebnis[schluessel] = wert;
    }
  }
  return ergebnis as T;
}

const FARBEN: readonly unknown[] = ["day", "evening", "night"];

// Nur Eintraege, mit denen der Start rechnen kann: ein Objekt mit Text in id,
// name, icon und prompt. Alles andere fiele spaeter beim Start um, noch vor dem
// Anmelden der Kuerzel. Eine unbekannte Farbe faellt weg (gilt dann als
// Violett); weitere Felder bleiben erhalten wie sonst in der Datei.
function gueltigeModi(wert: unknown): CustomMode[] {
  if (!Array.isArray(wert)) return [];
  const modi: CustomMode[] = [];
  for (const eintrag of wert) {
    if (!istObjekt(eintrag)) continue;
    const { id, name, icon, prompt } = eintrag;
    if (typeof id !== "string" || typeof name !== "string") continue;
    if (typeof icon !== "string" || typeof prompt !== "string") continue;
    const modus = structuredClone(eintrag);
    if ("color" in modus && !FARBEN.includes(modus.color)) delete modus.color;
    modi.push(modus as unknown as CustomMode);
  }
  return modi;
}

// Dieselben Regeln wie das fruehere loadSettings in config.ts: oben flach
// zusammenfuehren, liteLLM, hotkeys, improve und emoji einzeln ueber ihre
// Standardwerte legen, ein leerer Dampf-Prompt faellt auf den Standardtext.
function zusammenfuehren(gespeichert: unknown): Settings {
  const roh: Objekt = istObjekt(gespeichert) ? gespeichert : {};
  const hotkeys: Record<string, string> = structuredClone(defaultSettings.hotkeys);
  if (istObjekt(roh.hotkeys)) {
    for (const [modus, kuerzel] of Object.entries(roh.hotkeys)) {
      if (typeof kuerzel === "string") hotkeys[modus] = kuerzel;
    }
  }
  const dampfPrompt = istObjekt(roh.dampf) ? roh.dampf.systemPrompt : undefined;
  return {
    ...ueberStandard(defaultSettings, roh),
    liteLLM: ueberStandard(defaultSettings.liteLLM, roh.liteLLM),
    hotkeys,
    modes: gueltigeModi(roh.modes),
    improve: ueberStandard(defaultSettings.improve, roh.improve),
    // Ein leerer gespeicherter Dampf-Prompt faellt auf den Standardtext zurueck,
    // damit die vorausgefuellte Anweisung immer sichtbar (und editierbar) ist.
    dampf: {
      systemPrompt:
        typeof dampfPrompt === "string" && dampfPrompt.trim()
          ? dampfPrompt
          : defaultSettings.dampf.systemPrompt,
    },
    emoji: ueberStandard(defaultSettings.emoji, roh.emoji),
  };
}

// Antwort von settings_load, siehe SettingsRead in src-tauri/src/settings.rs.
type DateiStatus = {
  status: "missing" | "ok" | "corrupt" | "unreadable";
  json?: string;
};

// Gesperrt, wenn die Datei beim Start vorhanden, aber nicht lesbar war (etwa
// kurz von Virenscanner oder OneDrive gesperrt). Dann bleibt sie bis zum
// Neustart unangetastet, statt mit Standardwerten ueberschrieben zu werden.
let speichernGesperrt = false;

export function resetSettingsStoreForTests(): void {
  speichernGesperrt = false;
}

// Fuer die Statuszeile: wahr, wenn in dieser Sitzung nichts gespeichert wird.
export function settingsSaveBlocked(): boolean {
  return speichernGesperrt;
}

export async function loadSettings(): Promise<Settings> {
  speichernGesperrt = false;
  let datei: DateiStatus;
  try {
    datei = await invoke<DateiStatus>("settings_load");
  } catch (error) {
    // Ohne Zugriff auf die Datei nichts ueberschreiben: mit den Altwerten
    // weiterarbeiten und in dieser Sitzung nicht speichern.
    console.error("Einstellungen konnten nicht gelesen werden:", error);
    speichernGesperrt = true;
    return zusammenfuehren(readLegacySettings());
  }

  switch (datei.status) {
    case "ok": {
      let gespeichert: unknown = {};
      try {
        gespeichert = JSON.parse(datei.json ?? "{}");
      } catch {
        // Der Kern liefert nur gueltige Objekte; zur Sicherheit Standardwerte.
      }
      return zusammenfuehren(gespeichert);
    }
    case "corrupt":
      // Der Kern hat die kaputte Datei als settings.json.defekt gesichert. Wie
      // bei einer fehlenden Datei die Altwerte uebernehmen, sonst waere etwa
      // die Gateway-Adresse weg und das erste Diktat scheiterte.
      console.error("Einstellungsdatei war beschaedigt, sie liegt als settings.json.defekt daneben.");
      break;
    case "missing":
      break;
    default:
      console.error("Einstellungsdatei nicht lesbar, Speichern bis zum Neustart gesperrt.");
      speichernGesperrt = true;
      return zusammenfuehren({});
  }

  // Noch keine (oder eine kaputte, schon gesicherte) Datei: die Einstellungen
  // aus dem localStorage uebernehmen und sofort in die Datei schreiben. Der
  // localStorage bleibt stehen, als Rueckweg.
  const alt = readLegacySettings();
  const settings = zusammenfuehren(alt);
  if (istObjekt(alt)) {
    try {
      await saveSettings(settings);
    } catch (error) {
      console.error("Uebernahme der Einstellungen nicht gespeichert:", error);
    }
  }
  return settings;
}

export async function saveSettings(settings: Settings): Promise<void> {
  if (speichernGesperrt) {
    throw new Error("Einstellungsdatei war beim Start nicht lesbar, Speichern bis zum Neustart gesperrt.");
  }
  await invoke("settings_save", { json: JSON.stringify(settings) });
}
