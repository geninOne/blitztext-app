import { invoke } from "@tauri-apps/api/core";

export type ApiProvider = "openAI" | "liteLLM";

export interface Settings {
  apiProvider: ApiProvider;
  liteLLM: {
    baseURL: string;
    fastModel: string;
    strongModel: string;
    transcriptionModel: string;
  };
}

const SETTINGS_KEY = "blitztext.settings";
export const LITELLM_KEY_ACCOUNT = "liteLLMApiKey";

export const defaultSettings: Settings = {
  apiProvider: "liteLLM",
  liteLLM: {
    baseURL: "",
    fastModel: "gpt-4o-mini",
    strongModel: "gpt-5.5",
    transcriptionModel: "gpt-4o-transcribe",
  },
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return structuredClone(defaultSettings);
    const parsed = JSON.parse(raw);
    return {
      ...structuredClone(defaultSettings),
      ...parsed,
      liteLLM: { ...defaultSettings.liteLLM, ...(parsed.liteLLM ?? {}) },
    };
  } catch {
    return structuredClone(defaultSettings);
  }
}

export function saveSettings(settings: Settings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
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
