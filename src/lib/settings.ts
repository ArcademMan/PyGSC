import { invoke } from "@tauri-apps/api/core";

export interface AppConfig {
  theme: string;
  last_project: string | null;
  last_file: string | null;
}

export async function loadConfig(): Promise<AppConfig> {
  return invoke<AppConfig>("load_config");
}

export async function saveConfig(config: AppConfig): Promise<void> {
  return invoke("save_config", { config });
}
