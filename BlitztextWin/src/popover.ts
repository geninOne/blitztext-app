/// <reference types="vite/client" />
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  defaultSettings,
  setSecret,
  hasSecret,
  LITELLM_KEY_ACCOUNT,
  workflowLabels,
  workflowBrandNames,
  type Settings,
  type WorkflowType,
  type TextTone,
  type EmojiDensity,
  type HotkeyMode,
} from "./config";
import { systemPromptFor } from "./prompts";
import { loadSettings, saveSettings } from "./settings-store";
import {
  addMode,
  assignHotkey,
  displayName,
  removeMode,
  renderModeList,
  updateMode,
  type ModeEvents,
} from "./mode-editor";
import { iconFor } from "./mode-icons";
import { hasInstruction } from "./modes";
import { reconcileDuplicateHotkeys, removeCustomModeOrphans, seedCustomModesIfNeeded } from "./seed";
import { deliveryFor, resolveModeId, rewriteOrKeep, runMode, type ModeTarget, type RunResult } from "./run-mode";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getVersion } from "@tauri-apps/api/app";

const OPENAI_KEY_ACCOUNT = "openAIApiKey";

// Fallback fuer jeden Fehlerfall: die Release-Seite im Browser.
const RELEASES_URL = "https://github.com/geninOne/blitztext-app/releases/latest";

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function setupSegmented(
  containerId: string,
  current: string,
  onSelect: (value: string) => void,
): void {
  const buttons = Array.from(el(containerId).querySelectorAll<HTMLButtonElement>("button"));
  const render = (value: string) =>
    buttons.forEach((b) => b.classList.toggle("active", b.dataset.val === value));
  buttons.forEach((b) =>
    b.addEventListener("click", () => {
      render(b.dataset.val!);
      onSelect(b.dataset.val!);
    }),
  );
  render(current);
}

// Accelerator strings use W3C KeyboardEvent.code names ("Super+Shift+KeyD").
// Ohne Kuerzel (fehlender Eintrag) gibt es keine Abzeichen.
function accelParts(accel: string | undefined): string[] {
  if (!accel) return [];
  return accel.split("+").map((part) => {
    if (part === "Super") return "Win";
    if (part === "Control") return "Ctrl";
    if (part.startsWith("Key")) return part.slice(3);
    if (part.startsWith("Digit")) return part.slice(5);
    return part;
  });
}

function accelFromEvent(event: KeyboardEvent): string | null {
  if (/^(Meta|Control|Alt|Shift)(Left|Right)$/.test(event.code)) return null;
  const mods: string[] = [];
  if (event.metaKey) mods.push("Super");
  if (event.ctrlKey) mods.push("Control");
  if (event.altKey) mods.push("Alt");
  if (event.shiftKey) mods.push("Shift");
  if (mods.length === 0 || !event.code) return null;
  return [...mods, event.code].join("+");
}

// Monochrome SVG row glyphs (mic / check / flame / smile).
const ICONS: Record<WorkflowType, string> = {
  transcribe: `<path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><line x1="12" y1="19" x2="12" y2="22"/>`,
  improve: `<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>`,
  dampf: `<path d="M12 2s4 4 4 8a4 4 0 0 1-8 0c0-1.5.5-2.5.5-2.5"/><path d="M12 22a6 6 0 0 0 6-6c0-2-1-3.5-2-5"/>`,
  emoji: `<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>`,
};

const SUBTITLES: Record<WorkflowType, string> = {
  transcribe: "Online: Transkription über LiteLLM",
  improve: "Geschrieben sprechen.",
  dampf: "Frust rein. Entspannt raus.",
  emoji: "Text rein. Emojis dazu.",
};

const WORKFLOW_ORDER: WorkflowType[] = ["transcribe", "improve", "dampf", "emoji"];

// Session-only debug history (in memory, max 10 — WAVs are too big for
// localStorage). Lets you replay the audio and check what was recognized.
// label: Markenname des eingebauten Modus oder Name des eigenen Modus.
type HistoryEntry = {
  time: string;
  label: string;
  input: string;
  output: string;
  audioBase64: string;
};
const MAX_HISTORY = 10;

window.addEventListener("DOMContentLoaded", async () => {
  // Einmal aus der Datei laden; danach ist dieses Objekt die einzige Quelle,
  // Menue und Einstellungen teilen sich dasselbe Fenster.
  const settings: Settings = await loadSettings();
  // Speichert im Hintergrund; ein Fehler darf die Bedienung nicht unterbrechen.
  const persist = () => {
    saveSettings(settings).catch((error) =>
      console.error("Einstellungen nicht gespeichert:", error),
    );
  };
  // Startarbeiten vor dem ersten Zeichnen und vor dem Anmelden der Kuerzel:
  // Startmodi einmalig anlegen, Kuerzel verschwundener Modi entfernen. Gespeichert
  // wird am Ende des Starts einmal, falls irgendetwas davon etwas geaendert hat.
  let startChanged = seedCustomModesIfNeeded(settings);
  if (removeCustomModeOrphans(settings)) startChanged = true;
  const history: HistoryEntry[] = [];

  // --- View switching (menu <-> settings, in the same popover) ---
  const viewMenu = el("view-menu");
  const viewSettings = el("view-settings");
  async function showSettingsView(): Promise<void> {
    viewMenu.hidden = true;
    viewSettings.hidden = false;
    await invoke("set_popover_pinned", { pinned: true }); // don't dismiss on blur while editing
  }
  async function showMenuView(): Promise<void> {
    viewSettings.hidden = true;
    viewMenu.hidden = false;
    await invoke("set_popover_pinned", { pinned: false });
  }
  el("gear").addEventListener("click", () => {
    // Der Abschnitt Updates liegt im Tab "Zugang". Ohne diesen Wechsel landet
    // der Klick auf dem Update-Punkt bei "Anpassen".
    if (verfuegbaresUpdate) showTab("access");
    void showSettingsView();
  });
  el("back").addEventListener("click", () => void showMenuView());
  el("quit").addEventListener("click", () => void invoke("quit_app"));
  await listen("open-settings", () => void showSettingsView());

  // ============================ Menu ============================
  const statusEl = el("status");
  const statusText = el("status-text");
  function setStatus(text: string, cls = ""): void {
    statusText.textContent = text;
    statusEl.className = `status ${cls}`.trim();
  }

  const list = el("workflow-list");
  // Eine Menuezeile. Name, Untertitel und Kuerzel kommen ueber textContent,
  // weil Modusnamen und Kuerzel aus der Einstellungsdatei stammen.
  function menuRow(icon: Element, name: string, sub: string, id: string, target: ModeTarget): HTMLElement {
    const row = document.createElement("div");
    row.className = "row";
    const iconBox = document.createElement("div");
    iconBox.className = "row-icon";
    iconBox.append(icon);
    const text = document.createElement("div");
    text.className = "row-text";
    const nameEl = document.createElement("div");
    nameEl.className = "row-name";
    nameEl.textContent = name;
    const subEl = document.createElement("div");
    subEl.className = "row-sub";
    subEl.textContent = sub;
    text.append(nameEl, subEl);
    const badges = document.createElement("div");
    badges.className = "badges";
    for (const key of accelParts(settings.hotkeys[id])) {
      const badge = document.createElement("span");
      badge.className = "key";
      badge.textContent = key;
      badges.append(badge);
    }
    row.append(iconBox, text, badges);
    row.addEventListener("click", () => void startFromRow(target));
    return row;
  }

  // Erst die vier eingebauten Modi, darunter die eigenen, wie menuModes auf dem Mac.
  function renderRows(): void {
    list.replaceChildren();
    for (const workflow of WORKFLOW_ORDER) {
      // ICONS ist fest im Code, daher hier innerHTML.
      const holder = document.createElement("div");
      holder.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[workflow]}</svg>`;
      list.append(
        menuRow(holder.firstElementChild!, workflowBrandNames[workflow], SUBTITLES[workflow], workflow, {
          kind: "builtIn",
          workflow,
        }),
      );
    }
    for (const mode of settings.modes) {
      // Untertitel wie AppState.menuSubtitle auf dem Mac.
      const sub = hasInstruction(mode) ? "Dein Format, dein Prompt." : "Ohne Anweisung: wortgenau.";
      list.append(menuRow(iconFor(mode.icon, 18), displayName(mode), sub, mode.id, { kind: "custom", mode }));
    }
  }

  // --- Dictation pipeline ---
  // Recording is done natively in the Rust core (cpal -> 16-bit mono WAV) for
  // deterministic, high quality. record_start begins capture; record_stop
  // returns the WAV as base64, which we transcribe -> optionally rewrite -> paste.
  let recording = false;
  let busy = false;
  // Der Modus haelt den Stand beim Start fest; eine Aenderung im Editor
  // ersetzt das Objekt in settings.modes und trifft diese Aufnahme nicht.
  let currentTarget: ModeTarget = { kind: "builtIn", workflow: "transcribe" };

  // Kurzname fuer die Statuszeile.
  function statusLabel(target: ModeTarget): string {
    return target.kind === "builtIn" ? workflowLabels[target.workflow] : displayName(target.mode);
  }

  // Bezeichnung im Verlauf.
  function historyLabel(target: ModeTarget): string {
    return target.kind === "builtIn" ? workflowBrandNames[target.workflow] : displayName(target.mode);
  }

  function chatViaGateway(model: string, system: string, user: string): Promise<string> {
    return invoke<string>("chat_complete", {
      baseUrl: settings.liteLLM.baseURL.trim(),
      model,
      system,
      user,
    });
  }

  // Eingebaute Modi: Prompts unveraendert ueber systemPromptFor. Eigene Modi:
  // runMode mit fastModel, Eigennamen aus "Eigennamen", Kontext noch leer.
  // Beide behalten das Transkript, wenn der Modellschritt scheitert.
  async function rewriteFor(target: ModeTarget, text: string): Promise<RunResult> {
    const fastModel = settings.liteLLM.fastModel.trim() || defaultSettings.liteLLM.fastModel;
    if (target.kind === "custom") {
      if (hasInstruction(target.mode) && text) {
        setStatus(`Verarbeite (${statusLabel(target)}) ...`, "busy");
      }
      return runMode(
        target.mode,
        text,
        {
          chat: (system, user) => chatViaGateway(fastModel, system, user),
          language: async (transcript) =>
            (await invoke<string>("detect_language", { text: transcript })) === "en" ? "en" : "de",
        },
        { terms: settings.improve.customTerms, context: "" },
      );
    }
    const system = systemPromptFor(target.workflow, settings);
    if (!system || !text) return { text, aiFailed: false };
    const model =
      target.workflow === "dampf"
        ? settings.liteLLM.strongModel.trim() || defaultSettings.liteLLM.strongModel
        : fastModel;
    setStatus(`Verarbeite (${statusLabel(target)}) ...`, "busy");
    return rewriteOrKeep(text, () => chatViaGateway(model, system, text));
  }

  async function startRecording(target: ModeTarget): Promise<void> {
    if (recording || busy) return;
    currentTarget = target;
    try {
      await invoke("record_start");
      recording = true;
      await invoke("set_recording", { active: true });
      setStatus(`Aufnahme (${statusLabel(target)}) ...`, "recording");
    } catch (error) {
      setStatus(`Mikrofon-Fehler: ${error}`);
      await invoke("set_recording", { active: false });
    }
  }

  async function finishRecording(): Promise<void> {
    if (!recording) return;
    recording = false;
    busy = true;
    try {
      const audioBase64 = await invoke<string>("record_stop");
      setStatus("Transkribiere ...", "busy");
      const text = await invoke<string>("transcribe", {
        baseUrl: settings.liteLLM.baseURL.trim(),
        model: settings.liteLLM.transcriptionModel.trim() || "gpt-4o-transcribe",
        language: "de",
        audioBase64,
        filename: "audio.wav",
        contentType: "audio/wav",
      });

      const target = currentTarget;
      const outcome = await rewriteFor(target, text);
      const result = outcome.text;

      // Keep a session-only debug entry (newest first, capped at 10).
      history.unshift({
        time: new Date().toLocaleTimeString(),
        label: historyLabel(target),
        input: text,
        output: result,
        audioBase64,
      });
      if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
      if (!el("tab-history").hidden) renderHistory();

      // Gescheiterter Modellschritt: das Gesagte liegt in der Zwischenablage
      // und im Verlauf, aber nicht im Feld.
      const delivery = deliveryFor(outcome);
      if (delivery === "paste") await invoke("paste_text", { text: result });
      if (delivery === "copy") await invoke("copy_text", { text: result });
      setStatus(outcome.aiFailed ? "Modellschritt gescheitert, der Text liegt in der Zwischenablage" : "Bereit");
      if (outcome.aiFailed) console.error("Modellschritt gescheitert:", outcome.reason);
    } catch (error) {
      setStatus(`Fehler: ${error}`);
    } finally {
      busy = false;
      await invoke("set_recording", { active: false });
    }
  }

  function stopRecording(): void {
    void finishRecording();
  }

  // Click a row: hide the popover (so focus + paste return to the active app),
  // then record in toggle mode. A tray click stops it (via "popover-stop").
  async function startFromRow(target: ModeTarget): Promise<void> {
    if (recording) {
      stopRecording();
      return;
    }
    await invoke("hide_popover");
    await startRecording(target);
  }

  // Hotkey handling honors the mode: "hold" = record while held (down starts,
  // up stops); "toggle" = press to start, press again (or Esc/tray) to stop.
  let lastHotkeyDown = 0;
  // Die Kennung ist ein eingebauter Name oder "custom-..."; eine unbekannte
  // (Modus geloescht) loest nichts aus.
  await listen<string>("hotkey-down", (event) => {
    const target = resolveModeId(event.payload ?? "", settings.modes);
    if (!target) return;
    if (settings.hotkeyMode === "toggle") {
      // Ignore OS key auto-repeat so a held key doesn't flip start/stop.
      const now = performance.now();
      const isRepeat = now - lastHotkeyDown < 500;
      lastHotkeyDown = now;
      if (isRepeat) return;
      if (recording) stopRecording();
      else void startRecording(target);
    } else {
      void startRecording(target); // hold: re-entry is ignored in startRecording
    }
  });
  // Loslassen beendet eine laufende Aufnahme immer, auch wenn der Modus
  // inzwischen geloescht ist; stopRecording tut ohne Aufnahme nichts.
  await listen<string>("hotkey-up", () => {
    if (settings.hotkeyMode === "hold") stopRecording();
  });
  await listen("popover-stop", () => stopRecording());

  // ============================ Settings ============================
  const tabButtons = Array.from(el("tabs").querySelectorAll<HTMLButtonElement>("button"));
  function showTab(name: string): void {
    tabButtons.forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
    el("tab-customize").hidden = name !== "customize";
    el("tab-access").hidden = name !== "access";
    el("tab-history").hidden = name !== "history";
    if (name === "history") renderHistory();
  }
  tabButtons.forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab!)));
  showTab("customize");

  // --- Verlauf (debug history) ---
  function renderHistory(): void {
    const list = el("history-list");
    list.innerHTML = "";
    if (history.length === 0) {
      const empty = document.createElement("div");
      empty.className = "hist-empty";
      empty.textContent = "Noch keine Aufnahmen in dieser Sitzung.";
      list.append(empty);
      return;
    }
    for (const entry of history) {
      const card = document.createElement("div");
      card.className = "hist-entry";

      const head = document.createElement("div");
      head.className = "hist-head";
      head.innerHTML = `<span class="wf"></span><span> · ${entry.time}</span>`;
      head.querySelector(".wf")!.textContent = entry.label;

      const audio = document.createElement("audio");
      audio.controls = true;
      audio.preload = "none";
      audio.src = `data:audio/wav;base64,${entry.audioBase64}`;

      const input = document.createElement("div");
      input.className = "hist-io";
      input.innerHTML = `<span class="k">Eingabe (erkannt)</span><span class="v"></span>`;
      input.querySelector(".v")!.textContent = entry.input || "(leer)";

      card.append(head, audio, input);

      // Only show the output when a rewrite actually changed the text.
      if (entry.output && entry.output !== entry.input) {
        const output = document.createElement("div");
        output.className = "hist-io";
        output.innerHTML = `<span class="k">Ausgabe (eingefügt)</span><span class="v"></span>`;
        output.querySelector(".v")!.textContent = entry.output;
        card.append(output);
      }

      list.append(card);
    }
  }
  el<HTMLButtonElement>("history-clear").addEventListener("click", () => {
    history.length = 0;
    renderHistory();
  });

  // Provider + credentials + models
  const baseURL = el<HTMLInputElement>("baseURL");
  const fastModel = el<HTMLInputElement>("fastModel");
  const strongModel = el<HTMLInputElement>("strongModel");
  const transcriptionModel = el<HTMLInputElement>("transcriptionModel");
  const apiKey = el<HTMLInputElement>("apiKey");
  const openaiKey = el<HTMLInputElement>("openaiKey");
  const keyStatus = el("key-status");
  const saveStatus = el("save-status");

  baseURL.value = settings.liteLLM.baseURL;
  fastModel.value = settings.liteLLM.fastModel;
  strongModel.value = settings.liteLLM.strongModel;
  transcriptionModel.value = settings.liteLLM.transcriptionModel;

  function applyProviderVisibility(provider: string): void {
    el("litellm-fields").hidden = provider !== "liteLLM";
    el("openai-fields").hidden = provider !== "openAI";
  }
  setupSegmented("provider-seg", settings.apiProvider, (value) => {
    settings.apiProvider = value as Settings["apiProvider"];
    applyProviderVisibility(value);
    persist();
  });
  applyProviderVisibility(settings.apiProvider);

  keyStatus.textContent = (await hasSecret(LITELLM_KEY_ACCOUNT))
    ? "Key gespeichert"
    : "kein Key gespeichert";

  el("settings-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    saveStatus.textContent = "";
    settings.liteLLM = {
      baseURL: baseURL.value.trim(),
      fastModel: fastModel.value.trim() || defaultSettings.liteLLM.fastModel,
      strongModel: strongModel.value.trim() || defaultSettings.liteLLM.strongModel,
      transcriptionModel:
        transcriptionModel.value.trim() || defaultSettings.liteLLM.transcriptionModel,
    };
    persist();

    const key = apiKey.value.trim();
    if (key) {
      try {
        await setSecret(LITELLM_KEY_ACCOUNT, key);
        apiKey.value = "";
        keyStatus.textContent = "Key gespeichert";
      } catch (error) {
        saveStatus.textContent = `Key-Fehler: ${error}`;
        return;
      }
    }
    const oaKey = openaiKey.value.trim();
    if (oaKey) {
      try {
        await setSecret(OPENAI_KEY_ACCOUNT, oaKey);
        openaiKey.value = "";
      } catch (error) {
        saveStatus.textContent = `Key-Fehler: ${error}`;
        return;
      }
    }
    saveStatus.textContent = "Gespeichert";
    setTimeout(() => (saveStatus.textContent = ""), 2000);
  });

  const testResult = el("test-result");
  el<HTMLButtonElement>("test-btn").addEventListener("click", async () => {
    testResult.textContent = "Teste Verbindung ...";
    const key = apiKey.value.trim();
    if (key) {
      try {
        await setSecret(LITELLM_KEY_ACCOUNT, key);
        apiKey.value = "";
        keyStatus.textContent = "Key gespeichert";
      } catch (error) {
        testResult.textContent = `Key-Fehler: ${error}`;
        return;
      }
    }
    try {
      const models = await invoke<string[]>("gateway_test", { baseUrl: baseURL.value.trim() });
      testResult.textContent = models.length
        ? `OK, ${models.length} Modelle: ${models.slice(0, 8).join(", ")}${models.length > 8 ? " ..." : ""}`
        : "Verbunden, aber keine Modelle gelistet.";
    } catch (error) {
      testResult.textContent = `Fehler: ${error}`;
    }
  });

  // Autostart
  const autostartEl = el<HTMLInputElement>("autostart");
  try {
    autostartEl.checked = await invoke<boolean>("get_autostart");
  } catch {
    autostartEl.checked = settings.autostart;
  }
  autostartEl.addEventListener("change", async () => {
    try {
      await invoke("set_autostart", { enabled: autostartEl.checked });
      settings.autostart = autostartEl.checked;
      persist();
    } catch (error) {
      autostartEl.checked = !autostartEl.checked;
      saveStatus.textContent = `Autostart-Fehler: ${error}`;
    }
  });

  // Updates
  const updateInstalledEl = el<HTMLParagraphElement>("update-installed");
  const updateStatusEl = el<HTMLParagraphElement>("update-status");
  const updateCheckEl = el<HTMLButtonElement>("update-check");
  const updateInstallEl = el<HTMLButtonElement>("update-install");
  const updateAutomaticEl = el<HTMLInputElement>("update-automatic");

  let verfuegbaresUpdate: Update | null = null;

  getVersion().then((version) => {
    updateInstalledEl.textContent = `Installiert: Version ${version}`;
  });

  updateAutomaticEl.checked = settings.automaticUpdateChecks;
  updateAutomaticEl.addEventListener("change", () => {
    settings.automaticUpdateChecks = updateAutomaticEl.checked;
    persist();
  });

  function letztePruefungText(): string {
    if (!settings.lastUpdateCheck) return "Noch nicht nach Updates gesucht.";
    return `Zuletzt geprüft: ${new Date(settings.lastUpdateCheck).toLocaleString("de-DE")}`;
  }

  function amSelbenTag(a: Date, b: Date): boolean {
    return a.toDateString() === b.toDateString();
  }

  function zeigeUpdateHinweis(sichtbar: boolean): void {
    const gear = el<HTMLButtonElement>("gear");
    gear.textContent = sichtbar ? "⚙•" : "⚙";
    gear.title = sichtbar ? "Ein Update ist verfügbar" : "Einstellungen";
  }

  // Das Plugin liefert nur bei HTTP 204 ein sauberes "kein Update". Jeder andere
  // Nicht-2xx-Status, auch ein 404, kommt als Fehler mit diesem Text an. Ein 404
  // heisst hier aber bloss, dass am neuesten Release kein latest.json haengt, und
  // das ist keine Stoerung. Die Erkennung haengt am Wortlaut des Plugins: aendert
  // der sich, zeigt die App wieder die rohe Fehlermeldung, mehr passiert nicht.
  function istKeinManifestVorhanden(fehler: unknown): boolean {
    const text = String(fehler);
    return text.includes("Could not fetch a valid release JSON")
      || text.includes("ReleaseNotFound");
  }

  async function pruefeAufUpdates(manuell: boolean): Promise<void> {
    // Im Entwicklungs-Build gibt es kein Release, gegen das geprueft wuerde.
    if (import.meta.env.DEV) {
      if (manuell) {
        updateStatusEl.textContent =
          "Entwicklungs-Build. Updates kommen über einen eigenen Build.";
      }
      return;
    }

    updateStatusEl.textContent = "Suche nach Updates ...";
    try {
      const treffer = await check();
      settings.lastUpdateCheck = new Date().toISOString();
      persist();

      if (!treffer) {
        verfuegbaresUpdate = null;
        zeigeUpdateHinweis(verfuegbaresUpdate !== null);
        updateInstallEl.hidden = true;
        updateStatusEl.textContent = `Blitztext ist aktuell. ${letztePruefungText()}`;
        return;
      }

      verfuegbaresUpdate = treffer;
      zeigeUpdateHinweis(verfuegbaresUpdate !== null);
      updateInstallEl.hidden = false;
      updateInstallEl.textContent = `Version ${treffer.version} laden und installieren`;
      updateStatusEl.textContent = `Version ${treffer.version} ist verfügbar. `
        + "Blitztext startet sich für das Update neu.";
    } catch (error) {
      verfuegbaresUpdate = null;
      zeigeUpdateHinweis(verfuegbaresUpdate !== null);
      updateInstallEl.hidden = true;

      if (istKeinManifestVorhanden(error)) {
        settings.lastUpdateCheck = new Date().toISOString();
        persist();
        updateStatusEl.textContent = `Blitztext ist aktuell. ${letztePruefungText()}`;
        return;
      }

      // Der automatische Check scheitert still, damit ein fehlendes Netz
      // beim Start niemanden stoert.
      updateStatusEl.textContent = manuell ? `Update-Prüfung fehlgeschlagen: ${error}` : "";
    }
  }

  updateCheckEl.addEventListener("click", () => {
    void pruefeAufUpdates(true);
  });

  // Ausweg aus jedem Fehlerzustand: die Release-Seite im Browser. Damit endet
  // kein Fehler in einer Sackgasse, genau wie in der Mac-App.
  el<HTMLButtonElement>("update-releases").addEventListener("click", () => {
    void openUrl(RELEASES_URL);
  });

  updateInstallEl.addEventListener("click", async () => {
    if (!verfuegbaresUpdate) return;
    if (recording || busy) {
      updateStatusEl.textContent =
        "Blitztext nimmt gerade auf. Das Update läuft, sobald die Aufnahme fertig ist.";
      return;
    }

    updateInstallEl.disabled = true;
    try {
      // Bewusst download() und install() getrennt statt downloadAndInstall():
      // nur so liegt zwischen beiden ein Punkt, an dem die Sperre noch einmal
      // greifen kann. install() beendet die App unter Windows selbst, danach
      // laeuft hier nichts mehr.
      await verfuegbaresUpdate.download((fortschritt) => {
        if (fortschritt.event === "Progress") {
          updateStatusEl.textContent = "Lade Update ...";
        }
      });

      // Die Sperre gilt nicht nur beim Klick: der Download dauert, und ein
      // globaler Hotkey kann in dieser Zeit eine Aufnahme gestartet haben.
      // Ein Neustart mitten im Diktat waere Datenverlust. Bis hierher ist ein
      // Abbruch folgenlos, ab install() nicht mehr.
      if (recording || busy) {
        updateStatusEl.textContent =
          "Blitztext nimmt gerade auf. Das Update läuft, sobald die Aufnahme fertig ist.";
        updateInstallEl.disabled = false;
        return;
      }

      updateStatusEl.textContent = "Installiere und starte neu ...";
      await verfuegbaresUpdate.install();
      await relaunch();
    } catch (error) {
      updateStatusEl.textContent = `Installation fehlgeschlagen: ${error}`;
      updateInstallEl.disabled = false;
    }
  });

  updateStatusEl.textContent = letztePruefungText();

  // Beim Start pruefen, danach hoechstens einmal pro Kalendertag.
  const letzte = settings.lastUpdateCheck ? new Date(settings.lastUpdateCheck) : null;
  if (settings.automaticUpdateChecks && (!letzte || !amSelbenTag(letzte, new Date()))) {
    void pruefeAufUpdates(false);
  }

  // Per-workflow tuning
  setupSegmented("tone-seg", settings.improve.tone, (value) => {
    settings.improve.tone = value as TextTone;
    persist();
  });
  setupSegmented("density-seg", settings.emoji.density, (value) => {
    settings.emoji.density = value as EmojiDensity;
    persist();
  });
  setupSegmented("mode-seg", settings.hotkeyMode, (value) => {
    settings.hotkeyMode = value as HotkeyMode;
    persist();
  });

  const improvePrompt = el<HTMLTextAreaElement>("improve-prompt");
  const improveContext = el<HTMLInputElement>("improve-context");
  const dampfPrompt = el<HTMLTextAreaElement>("dampf-prompt");
  improvePrompt.value = settings.improve.systemPrompt;
  improveContext.value = settings.improve.context;
  dampfPrompt.value = settings.dampf.systemPrompt;
  improvePrompt.addEventListener("input", () => {
    settings.improve.systemPrompt = improvePrompt.value;
    persist();
  });
  improveContext.addEventListener("input", () => {
    settings.improve.context = improveContext.value;
    persist();
  });
  dampfPrompt.addEventListener("input", () => {
    settings.dampf.systemPrompt = dampfPrompt.value;
    persist();
  });

  // Custom-term chips
  const termsChips = el("terms-chips");
  const termInput = el<HTMLInputElement>("term-input");
  function renderTerms(): void {
    termsChips.innerHTML = "";
    for (const term of settings.improve.customTerms) {
      const chip = document.createElement("span");
      chip.className = "chip";
      const label = document.createElement("span");
      label.textContent = term;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "✕";
      remove.addEventListener("click", () => {
        settings.improve.customTerms = settings.improve.customTerms.filter((t) => t !== term);
        persist();
        renderTerms();
      });
      chip.append(label, remove);
      termsChips.append(chip);
    }
  }
  function addTerm(): void {
    const value = termInput.value.trim();
    if (!value || settings.improve.customTerms.includes(value)) return;
    settings.improve.customTerms.push(value);
    termInput.value = "";
    persist();
    renderTerms();
  }
  el<HTMLButtonElement>("term-add").addEventListener("click", addTerm);
  termInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addTerm();
    }
  });
  renderTerms();

  // Hotkeys (rebind UI + registration). Ein Rekorder fuer alle Kennungen: die
  // vier Workflows und die eigenen Modi. Abzeichen derselben Kennung koennen an
  // mehreren Stellen stehen (Kopfzeile und Editor eines Modus); alle bleiben
  // gleich, und ein Kuerzel, das eine andere Kennung verliert, verschwindet
  // auch dort.
  type HotkeyTarget = {
    id: string;
    label: () => string;
    status: HTMLElement;
    changeBtn: HTMLButtonElement;
  };
  const hotkeyStatus = el("hotkey-status");
  const hotkeyList = el("hotkey-list");
  const displays = new Map<string, HTMLElement[]>();
  let capturing: HotkeyTarget | null = null;

  function labelFor(id: string): string {
    if ((WORKFLOW_ORDER as string[]).includes(id)) return workflowLabels[id as WorkflowType];
    const mode = settings.modes.find((m) => m.id === id);
    return mode ? displayName(mode) : id;
  }

  function hotkeyDisplay(id: string): HTMLElement {
    const display = document.createElement("div");
    display.className = "badges";
    // Hier noch nicht aufraeumen: das neue Abzeichen und seine Geschwister
    // haengen beim Aufbau noch nicht im Dokument.
    displays.set(id, [...(displays.get(id) ?? []), display]);
    fillBadges(display, id);
    return display;
  }

  function fillBadges(display: HTMLElement, id: string): void {
    display.innerHTML = accelParts(settings.hotkeys[id])
      .map((key) => `<span class="key">${key}</span>`)
      .join("");
  }

  // Abzeichen frueherer Neuzeichnungen haengen nicht mehr im Dokument und fallen weg.
  function pruneDisplays(): void {
    for (const [id, list] of displays) displays.set(id, list.filter((d) => d.isConnected));
  }

  function renderHotkey(id: string): void {
    pruneDisplays();
    for (const display of displays.get(id) ?? []) fillBadges(display, id);
  }

  function flash(status: HTMLElement, message: string): void {
    status.textContent = message;
    setTimeout(() => {
      if (status.textContent === message) status.textContent = "";
    }, 2000);
  }

  async function applyHotkey(target: Omit<HotkeyTarget, "changeBtn">, accel: string): Promise<void> {
    try {
      await invoke("set_hotkey", { modeId: target.id, accelerator: accel });
    } catch (error) {
      // set_hotkey laesst die alte Belegung stehen, also auch hier nichts aendern.
      target.status.textContent = `Fehler: ${error}`;
      return;
    }
    const lost = assignHotkey(settings, target.id, accel);
    persist();
    renderHotkey(target.id);
    lost.forEach(renderHotkey);
    renderRows(); // keep the menu badges in sync
    const taken = lost.length ? ` (vorher bei ${lost.map(labelFor).join(", ")})` : "";
    flash(target.status, `${target.label()}: gespeichert${taken}`);
  }

  async function clearHotkey(target: Omit<HotkeyTarget, "changeBtn">): Promise<void> {
    try {
      await invoke("clear_hotkey", { modeId: target.id });
    } catch (error) {
      target.status.textContent = `Fehler: ${error}`;
      return;
    }
    delete settings.hotkeys[target.id];
    persist();
    renderHotkey(target.id);
    renderRows();
    flash(target.status, `${target.label()}: Kürzel entfernt`);
  }

  function endCapture(message: string): void {
    if (capturing) {
      capturing.changeBtn.textContent = "✎";
      capturing.status.textContent = message;
    }
    capturing = null;
  }

  // Knopf, der fuer eine Kennung die naechste Tastenkombination aufnimmt.
  function recordButton(id: string, label: () => string, status: HTMLElement): HTMLButtonElement {
    const changeBtn = document.createElement("button");
    changeBtn.type = "button";
    changeBtn.className = "hk-btn";
    changeBtn.textContent = "✎";
    changeBtn.title = "Ändern";
    changeBtn.addEventListener("click", () => {
      if (capturing) endCapture("");
      capturing = { id, label, status, changeBtn };
      changeBtn.textContent = "…";
      status.textContent = `${label()}: Kombination drücken (Esc bricht ab).`;
    });
    return changeBtn;
  }

  function smallButton(text: string, title: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "hk-btn";
    button.textContent = text;
    button.title = title;
    button.addEventListener("click", onClick);
    return button;
  }

  for (const workflow of WORKFLOW_ORDER) {
    const row = document.createElement("div");
    row.className = "hotkey-row";

    const glyph = document.createElement("span");
    glyph.className = "hk-glyph";
    glyph.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[workflow]}</svg>`;

    const label = document.createElement("span");
    label.className = "wf-label";
    label.textContent = workflowLabels[workflow];

    const target = { id: workflow, label: () => workflowLabels[workflow], status: hotkeyStatus };
    const resetBtn = smallButton("↺", "Zurücksetzen", () =>
      void applyHotkey(target, defaultSettings.hotkeys[workflow]),
    );

    row.append(
      glyph,
      label,
      hotkeyDisplay(workflow),
      recordButton(workflow, target.label, hotkeyStatus),
      resetBtn,
    );
    hotkeyList.append(row);
  }

  window.addEventListener("keydown", (event) => {
    if (!capturing) return;
    event.preventDefault();
    if (event.code === "Escape") {
      endCapture("Abgebrochen");
      return;
    }
    const accel = accelFromEvent(event);
    if (!accel) return;
    const target = capturing;
    endCapture("");
    void applyHotkey(target, accel);
  });

  // --- Eigene Modi ---
  const modeList = el("mode-list");
  const modeEvents: ModeEvents = {
    add(mode) {
      addMode(settings, mode);
      persist();
      renderModes();
      renderRows();
    },
    update(mode) {
      updateMode(settings, mode);
      persist();
      renderRows(); // Name, Symbol und Untertitel im Menue
    },
    async remove(id) {
      if (capturing?.id === id) endCapture("");
      try {
        await invoke("clear_hotkey", { modeId: id });
      } catch (error) {
        console.error("Kürzel nicht freigegeben:", error);
      }
      removeMode(settings, id);
      persist();
      renderModes();
      renderRows();
    },
    hotkeyDisplay,
    hotkeyEditor(id) {
      const wrap = document.createElement("div");
      wrap.className = "hotkey-row";
      const status = document.createElement("span");
      status.className = "field-status mode-hk-status";
      const label = () => labelFor(id);
      wrap.append(
        hotkeyDisplay(id),
        recordButton(id, label, status),
        smallButton("✕", "Kürzel entfernen", () => void clearHotkey({ id, label, status })),
        status,
      );
      return wrap;
    },
  };
  function renderModes(): void {
    renderModeList(modeList, settings, modeEvents);
    pruneDisplays();
  }
  renderModes();

  // Initial render + register all saved hotkeys: erst die vier Workflows, dann
  // die eigenen Modi. Verwaiste Eintraege sind oben schon entfernt.
  renderRows();
  const ids = [...WORKFLOW_ORDER, ...settings.modes.map((m) => m.id)];
  for (const id of ids) {
    const accelerator = settings.hotkeys[id];
    if (!accelerator) continue;
    try {
      await invoke("set_hotkey", { modeId: id, accelerator });
      // Doppelte Kuerzel aus alten Dateien: das zuletzt angemeldete gewinnt, wie
      // im Kern, der die frueheren Besitzer abmeldet.
      if (reconcileDuplicateHotkeys(settings, [[id, accelerator]])) startChanged = true;
    } catch {
      /* invalid combo surfaced when the user edits it */
    }
  }
  if (startChanged) persist();
});
