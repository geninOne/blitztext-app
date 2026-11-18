import { invoke } from "@tauri-apps/api/core";
import { defaultSettings, readLegacySettings, type Settings } from "./config";

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
    modes: Array.isArray(roh.modes) ? structuredClone(roh.modes) : [],
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

export async function loadSettings(): Promise<Settings> {
  let text: string;
  try {
    text = await invoke<string>("settings_load");
  } catch (error) {
    // Ohne Zugriff auf die Datei nichts ueberschreiben: mit den Altwerten
    // weiterarbeiten, gespeichert wird erst bei der naechsten Aenderung.
    console.error("Einstellungen konnten nicht gelesen werden:", error);
    return zusammenfuehren(readLegacySettings());
  }

  let gespeichert: unknown;
  try {
    gespeichert = JSON.parse(text);
  } catch {
    gespeichert = {};
  }
  if (istObjekt(gespeichert) && Object.keys(gespeichert).length > 0) {
    return zusammenfuehren(gespeichert);
  }

  // Noch keine Datei: einmalig die Einstellungen aus dem localStorage
  // uebernehmen und sofort in die Datei schreiben. Der localStorage bleibt
  // stehen, als Rueckweg.
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
  await invoke("settings_save", { json: JSON.stringify(settings) });
}
