import { invoke } from "@tauri-apps/api/core";
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
});
