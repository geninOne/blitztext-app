import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  defaultSettings,
  loadSettings,
  saveSettings,
  setSecret,
  hasSecret,
  LITELLM_KEY_ACCOUNT,
  workflowLabels,
  type Settings,
  type WorkflowType,
  type TextTone,
  type EmojiDensity,
} from "./config";
import { systemPromptFor } from "./prompts";

const OPENAI_KEY_ACCOUNT = "openAIApiKey";

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// Pick a recording container the platform supports and Whisper accepts.
// WKWebView (macOS) typically yields mp4/aac; WebView2 (Windows) yields webm/opus.
function pickRecorderMimeType(): string | undefined {
  const preferred = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg"];
  return preferred.find(
    (t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t),
  );
}

function extForMime(mime: string): string {
  const base = mime.split(";")[0];
  if (base.includes("mp4")) return "mp4";
  if (base.includes("ogg")) return "ogg";
  if (base.includes("wav")) return "wav";
  if (base.includes("mpeg")) return "mp3";
  return "webm";
}

// Wire an inline segmented control: highlights the active button and reports
// selections. Buttons carry their value in data-val.
function setupSegmented(
  containerId: string,
  current: string,
  onSelect: (value: string) => void,
): void {
  const buttons = Array.from(
    el(containerId).querySelectorAll<HTMLButtonElement>("button"),
  );
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

window.addEventListener("DOMContentLoaded", async () => {
  const settings = loadSettings();
  const persist = () => saveSettings(settings);

  // --- Tabs (Anpassen / Zugang) ---
  const tabButtons = Array.from(el("tabs").querySelectorAll<HTMLButtonElement>("button"));
  function showTab(name: string): void {
    tabButtons.forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
    el("tab-customize").hidden = name !== "customize";
    el("tab-access").hidden = name !== "access";
  }
  tabButtons.forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab!)));
  // Open on "Zugang" until the gateway is configured, otherwise "Anpassen".
  showTab(settings.liteLLM.baseURL ? "customize" : "access");

  // --- Access tab: provider + credentials + models ---
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

    // Save a freshly typed key first, so "enter key + test" works in one step.
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
      const models = await invoke<string[]>("gateway_test", {
        baseUrl: baseURL.value.trim(),
      });
      testResult.textContent = models.length
        ? `OK, ${models.length} Modelle: ${models.slice(0, 8).join(", ")}${models.length > 8 ? " ..." : ""}`
        : "Verbunden, aber keine Modelle gelistet.";
    } catch (error) {
      testResult.textContent = `Fehler: ${error}`;
    }
  });

  // --- Access tab: autostart (launch on login) ---
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
      autostartEl.checked = !autostartEl.checked; // revert on failure
      saveStatus.textContent = `Autostart-Fehler: ${error}`;
    }
  });

  // --- Customize tab: per-workflow tuning (saved immediately on change) ---
  setupSegmented("tone-seg", settings.improve.tone, (value) => {
    settings.improve.tone = value as TextTone;
    persist();
  });
  setupSegmented("density-seg", settings.emoji.density, (value) => {
    settings.emoji.density = value as EmojiDensity;
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

  // --- Dictation: record -> transcribe -> optional rewrite -> paste ---
  // Driven by the record button (toggle) and the global push-to-talk hotkeys:
  // hotkey down = start, up = stop. The workflow id chooses the chat step.
  let mediaRecorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];
  let currentWorkflow: WorkflowType = "transcribe";
  const recordBtn = el<HTMLButtonElement>("record-btn");
  const recordStatus = el("record-status");
  const transcriptEl = el("transcript");

  async function startRecording(): Promise<void> {
    if (mediaRecorder && mediaRecorder.state === "recording") return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          // Aufnahme folgt dem System-Standard-Eingabegeraet (kein deviceId).
          // Processing-Filter aus: fuers Diktat liefert das rohe Signal die
          // bessere Qualitaet (AGC pumpt, NS schluckt Konsonanten).
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      chunks = [];
      const chosen = pickRecorderMimeType();
      const options: MediaRecorderOptions = { audioBitsPerSecond: 128000 };
      if (chosen) options.mimeType = chosen;
      const recorder = new MediaRecorder(stream, options);
      mediaRecorder = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        recordBtn.textContent = "Aufnahme starten";
        const mime = recorder.mimeType || "audio/webm";
        const baseMime = mime.split(";")[0];
        try {
          const blob = new Blob(chunks, { type: mime });
          el<HTMLAudioElement>("playback").src = URL.createObjectURL(blob);
          const bytes = new Uint8Array(await blob.arrayBuffer());
          recordStatus.textContent = `Transkribiere (${baseMime}, ${bytes.length} Bytes) ...`;
          const text = await invoke<string>("transcribe", {
            baseUrl: settings.liteLLM.baseURL.trim(),
            model: settings.liteLLM.transcriptionModel.trim() || "gpt-4o-transcribe",
            language: "de",
            audioBase64: toBase64(bytes),
            filename: `audio.${extForMime(mime)}`,
            contentType: baseMime,
          });

          // For rewrite workflows, run the transcript through the chat model
          // with the matching system prompt. Plain transcription skips this.
          let result = text;
          const system = systemPromptFor(currentWorkflow, settings);
          if (system && text) {
            const model =
              currentWorkflow === "dampf"
                ? settings.liteLLM.strongModel.trim() || defaultSettings.liteLLM.strongModel
                : settings.liteLLM.fastModel.trim() || defaultSettings.liteLLM.fastModel;
            recordStatus.textContent = `Verarbeite (${workflowLabels[currentWorkflow]}) ...`;
            result = await invoke<string>("chat_complete", {
              baseUrl: settings.liteLLM.baseURL.trim(),
              model,
              system,
              user: text,
            });
          }

          transcriptEl.textContent = result || "(leer)";
          recordStatus.textContent = "";
          // Paste the result into whatever app currently has focus.
          if (result) {
            try {
              await invoke("paste_text", { text: result });
            } catch (error) {
              recordStatus.textContent = `Einfügen fehlgeschlagen: ${error}`;
            }
          }
        } catch (error) {
          recordStatus.textContent = `Fehler: ${error}`;
        }
      };
      recorder.start();
      recordBtn.textContent = "Stoppen";
      recordStatus.textContent = "Aufnahme läuft ...";
    } catch (error) {
      recordStatus.textContent = `Mikrofon-Fehler: ${error}`;
    }
  }

  function stopRecording(): void {
    if (mediaRecorder && mediaRecorder.state === "recording") {
      mediaRecorder.stop();
    }
  }

  recordBtn.addEventListener("click", () => {
    if (mediaRecorder && mediaRecorder.state === "recording") {
      stopRecording();
    } else {
      currentWorkflow = "transcribe";
      void startRecording();
    }
  });

  // Global push-to-talk hotkeys, registered in Rust. The down event carries the
  // workflow id; hold to record. Pressed may repeat while held; startRecording()
  // ignores re-entry.
  await listen<string>("hotkey-down", (event) => {
    currentWorkflow = (event.payload as WorkflowType) || "transcribe";
    void startRecording();
  });
  await listen("hotkey-up", () => stopRecording());

  // --- Configurable hotkeys (one per workflow) ---
  const hotkeyStatus = el("hotkey-status");
  const hotkeyList = el("hotkey-list");
  const displays = {} as Record<WorkflowType, HTMLElement>;
  const changeButtons = {} as Record<WorkflowType, HTMLButtonElement>;
  let capturingWorkflow: WorkflowType | null = null;
  const workflowOrder: WorkflowType[] = ["transcribe", "improve", "dampf", "emoji"];

  // Accelerator strings use W3C KeyboardEvent.code names ("Super+Shift+KeyD").
  // Render them human-readably (Win + Shift + D) for the UI.
  function formatAccel(accel: string): string {
    return accel
      .split("+")
      .map((part) => {
        if (part === "Super") return "Win";
        if (part === "Control") return "Ctrl";
        if (part.startsWith("Key")) return part.slice(3);
        if (part.startsWith("Digit")) return part.slice(5);
        return part;
      })
      .join(" + ");
  }

  // Build an accelerator from a key event; requires at least one modifier and a
  // non-modifier key so we never hijack plain typing or register half a combo.
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

  function renderHotkey(workflow: WorkflowType): void {
    displays[workflow].textContent = formatAccel(settings.hotkeys[workflow]);
  }

  async function applyHotkey(workflow: WorkflowType, accel: string): Promise<void> {
    try {
      await invoke("set_hotkey", { workflow, accelerator: accel });
      settings.hotkeys[workflow] = accel;
      persist();
      renderHotkey(workflow);
      hotkeyStatus.textContent = `${workflowLabels[workflow]}: gespeichert`;
      setTimeout(() => (hotkeyStatus.textContent = ""), 2000);
    } catch (error) {
      hotkeyStatus.textContent = `Fehler: ${error}`;
    }
  }

  function endCapture(message: string): void {
    if (capturingWorkflow) changeButtons[capturingWorkflow].textContent = "Ändern";
    capturingWorkflow = null;
    hotkeyStatus.textContent = message;
  }

  for (const workflow of workflowOrder) {
    const row = document.createElement("div");
    row.className = "hotkey-row";

    const label = document.createElement("span");
    label.className = "wf-label";
    label.textContent = workflowLabels[workflow];

    const display = document.createElement("kbd");
    displays[workflow] = display;

    const changeBtn = document.createElement("button");
    changeBtn.type = "button";
    changeBtn.textContent = "Ändern";
    changeButtons[workflow] = changeBtn;
    changeBtn.addEventListener("click", () => {
      if (capturingWorkflow) endCapture("");
      capturingWorkflow = workflow;
      changeBtn.textContent = "Tasten drücken ...";
      hotkeyStatus.textContent = `${workflowLabels[workflow]}: Kombination drücken (Esc bricht ab).`;
    });

    const resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.textContent = "Zurücksetzen";
    resetBtn.addEventListener("click", () =>
      void applyHotkey(workflow, defaultSettings.hotkeys[workflow]),
    );

    row.append(label, display, changeBtn, resetBtn);
    hotkeyList.append(row);
    renderHotkey(workflow);
  }

  window.addEventListener("keydown", (event) => {
    if (!capturingWorkflow) return;
    event.preventDefault();
    if (event.code === "Escape") {
      endCapture("Abgebrochen");
      return;
    }
    const accel = accelFromEvent(event);
    if (!accel) return; // wait until a real key is pressed with a modifier held
    const workflow = capturingWorkflow;
    endCapture("");
    void applyHotkey(workflow, accel);
  });

  // Register all saved hotkeys now that the webview is up.
  for (const workflow of workflowOrder) {
    try {
      await invoke("set_hotkey", { workflow, accelerator: settings.hotkeys[workflow] });
    } catch (error) {
      hotkeyStatus.textContent = `${workflowLabels[workflow]}: ${error}`;
    }
  }
});
