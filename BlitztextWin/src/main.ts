import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  defaultSettings,
  loadSettings,
  saveSettings,
  setSecret,
  hasSecret,
  LITELLM_KEY_ACCOUNT,
  type Settings,
} from "./config";

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

function applyProviderVisibility(provider: string): void {
  el("litellm-fields").style.display = provider === "liteLLM" ? "block" : "none";
}

window.addEventListener("DOMContentLoaded", async () => {
  const provider = el<HTMLSelectElement>("provider");
  const baseURL = el<HTMLInputElement>("baseURL");
  const fastModel = el<HTMLInputElement>("fastModel");
  const strongModel = el<HTMLInputElement>("strongModel");
  const transcriptionModel = el<HTMLInputElement>("transcriptionModel");
  const apiKey = el<HTMLInputElement>("apiKey");
  const keyStatus = el("key-status");
  const saveStatus = el("save-status");

  const settings = loadSettings();
  provider.value = settings.apiProvider;
  baseURL.value = settings.liteLLM.baseURL;
  fastModel.value = settings.liteLLM.fastModel;
  strongModel.value = settings.liteLLM.strongModel;
  transcriptionModel.value = settings.liteLLM.transcriptionModel;
  applyProviderVisibility(settings.apiProvider);

  keyStatus.textContent = (await hasSecret(LITELLM_KEY_ACCOUNT))
    ? "Key gespeichert"
    : "kein Key gespeichert";

  provider.addEventListener("change", () => applyProviderVisibility(provider.value));

  el("settings-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    saveStatus.textContent = "";

    const next: Settings = {
      apiProvider: provider.value as Settings["apiProvider"],
      liteLLM: {
        baseURL: baseURL.value.trim(),
        fastModel: fastModel.value.trim() || defaultSettings.liteLLM.fastModel,
        strongModel: strongModel.value.trim() || defaultSettings.liteLLM.strongModel,
        transcriptionModel:
          transcriptionModel.value.trim() || defaultSettings.liteLLM.transcriptionModel,
      },
      hotkeys: settings.hotkeys,
    };
    saveSettings(next);

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

  // --- Dictation: record -> transcribe -> show text ---
  // Driven by the record button (toggle) and the global push-to-talk hotkey
  // (Win+Shift+D): hotkey down = start, up = stop.
  let mediaRecorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];
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
            baseUrl: baseURL.value.trim(),
            model: transcriptionModel.value.trim() || "gpt-4o-transcribe",
            language: "de",
            audioBase64: toBase64(bytes),
            filename: `audio.${extForMime(mime)}`,
            contentType: baseMime,
          });
          transcriptEl.textContent = text || "(leer)";
          recordStatus.textContent = "";
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
      void startRecording();
    }
  });

  // Global push-to-talk hotkey, registered in Rust. Hold the combo to record.
  // Pressed may repeat while held; startRecording() ignores re-entry.
  await listen("hotkey-down", () => void startRecording());
  await listen("hotkey-up", () => stopRecording());

  // --- Configurable hotkeys ---
  const hotkeyDisplay = el("hotkey-transcribe");
  const hotkeyBtn = el<HTMLButtonElement>("hotkey-record-btn");
  const hotkeyResetBtn = el<HTMLButtonElement>("hotkey-reset-btn");
  const hotkeyStatus = el("hotkey-status");
  let capturing = false;

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

  function renderHotkey(): void {
    hotkeyDisplay.textContent = formatAccel(settings.hotkeys.transcribe);
  }

  async function applyHotkey(accel: string): Promise<void> {
    try {
      await invoke("set_hotkey", { workflow: "transcribe", accelerator: accel });
      settings.hotkeys.transcribe = accel;
      saveSettings(settings);
      renderHotkey();
      hotkeyStatus.textContent = "Hotkey gespeichert";
      setTimeout(() => (hotkeyStatus.textContent = ""), 2000);
    } catch (error) {
      hotkeyStatus.textContent = `Fehler: ${error}`;
    }
  }

  function stopCapture(message: string): void {
    capturing = false;
    hotkeyBtn.textContent = "Ändern";
    hotkeyStatus.textContent = message;
  }

  hotkeyBtn.addEventListener("click", () => {
    if (capturing) return;
    capturing = true;
    hotkeyBtn.textContent = "Tasten drücken ...";
    hotkeyStatus.textContent = "Wunschkombination drücken (Esc bricht ab).";
  });

  hotkeyResetBtn.addEventListener("click", () => {
    void applyHotkey(defaultSettings.hotkeys.transcribe);
  });

  window.addEventListener("keydown", (event) => {
    if (!capturing) return;
    event.preventDefault();
    if (event.code === "Escape") {
      stopCapture("Abgebrochen");
      return;
    }
    const accel = accelFromEvent(event);
    if (!accel) return; // wait until a real key is pressed with a modifier held
    stopCapture("");
    void applyHotkey(accel);
  });

  renderHotkey();
  // Register the saved hotkey now that the webview is up.
  try {
    await invoke("set_hotkey", {
      workflow: "transcribe",
      accelerator: settings.hotkeys.transcribe,
    });
  } catch (error) {
    hotkeyStatus.textContent = `Hotkey-Fehler: ${error}`;
  }
});
