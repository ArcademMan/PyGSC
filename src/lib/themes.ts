export interface PresetTheme {
  id: string;
  name: string;
  colors: Record<string, string>;
}

export const COLOR_KEYS = [
  "bg-dark", "bg-card", "bg-card-hover", "bg-sidebar",
  "bg-activitybar", "bg-panel", "accent", "accent-hover",
  "text", "text-muted", "success", "warning", "danger", "border",
] as const;

export const PRESET_THEMES: PresetTheme[] = [
  {
    id: "steam-dark",
    name: "Steam Dark",
    colors: {
      "bg-dark": "#1b2838",
      "bg-card": "#2a475e",
      "bg-card-hover": "#334d6e",
      "bg-sidebar": "#171a21",
      "bg-activitybar": "#111418",
      "bg-panel": "#1c2333",
      accent: "#66c0f4",
      "accent-hover": "#4fa8d8",
      text: "#c7d5e0",
      "text-muted": "#8f98a0",
      success: "#5ba32b",
      warning: "#e8a427",
      danger: "#c44040",
      border: "rgba(255, 255, 255, 0.06)",
    },
  },
  {
    id: "midnight",
    name: "Midnight",
    colors: {
      "bg-dark": "#0d1117",
      "bg-card": "#161b22",
      "bg-card-hover": "#1c2333",
      "bg-sidebar": "#010409",
      "bg-activitybar": "#000204",
      "bg-panel": "#0d1117",
      accent: "#58a6ff",
      "accent-hover": "#388bfd",
      text: "#e6edf3",
      "text-muted": "#8b949e",
      success: "#3fb950",
      warning: "#d29922",
      danger: "#f85149",
      border: "rgba(255, 255, 255, 0.06)",
    },
  },
  {
    id: "nord",
    name: "Nord",
    colors: {
      "bg-dark": "#2e3440",
      "bg-card": "#3b4252",
      "bg-card-hover": "#434c5e",
      "bg-sidebar": "#272c36",
      "bg-activitybar": "#22272f",
      "bg-panel": "#2e3440",
      accent: "#88c0d0",
      "accent-hover": "#81a1c1",
      text: "#eceff4",
      "text-muted": "#a0a8b7",
      success: "#a3be8c",
      warning: "#ebcb8b",
      danger: "#bf616a",
      border: "rgba(255, 255, 255, 0.06)",
    },
  },
  {
    id: "monokai",
    name: "Monokai",
    colors: {
      "bg-dark": "#272822",
      "bg-card": "#3e3d32",
      "bg-card-hover": "#49483e",
      "bg-sidebar": "#1e1f1c",
      "bg-activitybar": "#191a17",
      "bg-panel": "#272822",
      accent: "#66d9ef",
      "accent-hover": "#52b8cc",
      text: "#f8f8f2",
      "text-muted": "#a6a699",
      success: "#a6e22e",
      warning: "#e6db74",
      danger: "#f92672",
      border: "rgba(255, 255, 255, 0.06)",
    },
  },
  {
    id: "dracula",
    name: "Dracula",
    colors: {
      "bg-dark": "#282a36",
      "bg-card": "#343746",
      "bg-card-hover": "#3e4154",
      "bg-sidebar": "#21222c",
      "bg-activitybar": "#1a1b24",
      "bg-panel": "#282a36",
      accent: "#bd93f9",
      "accent-hover": "#a678e0",
      text: "#f8f8f2",
      "text-muted": "#a0a4b8",
      success: "#50fa7b",
      warning: "#f1fa8c",
      danger: "#ff5555",
      border: "rgba(255, 255, 255, 0.06)",
    },
  },
  {
    id: "solarized-dark",
    name: "Solarized Dark",
    colors: {
      "bg-dark": "#002b36",
      "bg-card": "#073642",
      "bg-card-hover": "#0a4050",
      "bg-sidebar": "#001f27",
      "bg-activitybar": "#001920",
      "bg-panel": "#002b36",
      accent: "#268bd2",
      "accent-hover": "#1a6fa0",
      text: "#eee8d5",
      "text-muted": "#93a1a1",
      success: "#859900",
      warning: "#b58900",
      danger: "#dc322f",
      border: "rgba(255, 255, 255, 0.06)",
    },
  },
  {
    id: "catppuccin",
    name: "Catppuccin Mocha",
    colors: {
      "bg-dark": "#1e1e2e",
      "bg-card": "#313244",
      "bg-card-hover": "#3b3c52",
      "bg-sidebar": "#181825",
      "bg-activitybar": "#11111b",
      "bg-panel": "#1e1e2e",
      accent: "#89b4fa",
      "accent-hover": "#74a8f7",
      text: "#cdd6f4",
      "text-muted": "#a6adc8",
      success: "#a6e3a1",
      warning: "#f9e2af",
      danger: "#f38ba8",
      border: "rgba(255, 255, 255, 0.06)",
    },
  },
  {
    id: "one-dark",
    name: "One Dark",
    colors: {
      "bg-dark": "#282c34",
      "bg-card": "#2c313a",
      "bg-card-hover": "#353b45",
      "bg-sidebar": "#21252b",
      "bg-activitybar": "#1b1f23",
      "bg-panel": "#282c34",
      accent: "#61afef",
      "accent-hover": "#4d99d6",
      text: "#abb2bf",
      "text-muted": "#7f848e",
      success: "#98c379",
      warning: "#e5c07b",
      danger: "#e06c75",
      border: "rgba(255, 255, 255, 0.06)",
    },
  },
];

export function applyTheme(colors: Record<string, string>) {
  const root = document.documentElement;
  for (const [key, value] of Object.entries(colors)) {
    root.style.setProperty(`--${key}`, value);
  }
}

export function getPresetById(id: string): PresetTheme | undefined {
  return PRESET_THEMES.find((t) => t.id === id);
}
