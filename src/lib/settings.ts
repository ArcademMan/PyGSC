import { invoke } from "@tauri-apps/api/core";

export interface AppConfig {
  theme: string;
  last_project: string | null;
  last_file: string | null;
  open_tabs: string[];
  sidebar_width: number;
  editor_split: number;
  expanded_dirs: string[];
}

export async function loadConfig(): Promise<AppConfig> {
  return invoke<AppConfig>("load_config");
}

export async function saveConfig(config: AppConfig): Promise<void> {
  return invoke("save_config", { config });
}

export async function loadCustomApi(): Promise<string> {
  return invoke<string>("load_custom_api");
}

export async function saveCustomApi(data: string): Promise<void> {
  return invoke("save_custom_api", { data });
}

export async function loadCustomUsings(): Promise<string> {
  return invoke<string>("load_custom_usings");
}

export async function saveCustomUsings(data: string): Promise<void> {
  return invoke("save_custom_usings", { data });
}
