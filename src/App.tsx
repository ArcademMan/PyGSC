import { createSignal, onMount, onCleanup } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { transpileWithMap, reverseTranspile } from "./lib/transpiler";
import { loadConfig, saveConfig, type AppConfig } from "./lib/settings";
import { applyTheme, getPresetById, PRESET_THEMES } from "./lib/themes";
import Sidebar from "./components/Sidebar";
import Editor from "./components/Editor";
import "./App.css";

export interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  children: FileEntry[] | null;
}

export interface OpenTab {
  path: string;
  name: string;
  code: string;
  output: string;
  unsaved: boolean;
  type?: "file" | "api-reference";
  /** Maps each PyGSC line (0-based) to its corresponding GSC line (0-based) */
  lineMap?: number[];
}

function App() {
  const [tabs, setTabs] = createSignal<OpenTab[]>([]);
  const [activeTabPath, setActiveTabPath] = createSignal<string | null>(null);
  const [projectPath, setProjectPath] = createSignal<string | null>(null);
  const [fileTree, setFileTree] = createSignal<FileEntry[]>([]);
  const [activeTheme, setActiveTheme] = createSignal("steam-dark");
  let suppressUnsaved = false;

  // Helpers
  function getActiveTab(): OpenTab | undefined {
    return tabs().find((t) => t.path === activeTabPath());
  }

  function updateTab(path: string, updates: Partial<OpenTab>) {
    setTabs((prev) => prev.map((t) => (t.path === path ? { ...t, ...updates } : t)));
  }

  function fileNameFromPath(fp: string): string {
    const parts = fp.replace(/\\/g, "/").split("/");
    return parts[parts.length - 1];
  }

  function isGscFile(path: string): boolean {
    const lower = path.toLowerCase();
    return lower.endsWith(".gsc") || lower.endsWith(".csc");
  }

  // Config persistence
  async function persistConfig(partial: Partial<AppConfig>) {
    const current: AppConfig = {
      theme: activeTheme(),
      last_project: projectPath(),
      last_file: activeTabPath(),
      ...partial,
    };
    try {
      await saveConfig(current);
    } catch (e) {
      console.error("Failed to save config:", e);
    }
  }

  // Keyboard shortcuts
  function handleKeyDown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      saveCurrentFile();
    }
  }

  onMount(async () => {
    document.addEventListener("keydown", handleKeyDown);

    try {
      const config = await loadConfig();
      const preset = getPresetById(config.theme);
      if (preset) {
        applyTheme(preset.colors);
        setActiveTheme(preset.id);
      }
      if (config.last_project) {
        await openProject(config.last_project, false);
      }
      if (config.last_file) {
        await openFile(config.last_file, false);
      }
    } catch {
      applyTheme(PRESET_THEMES[0].colors);
    }
  });

  onCleanup(() => {
    document.removeEventListener("keydown", handleKeyDown);
  });

  // Code change handler
  function handleCodeChange(newCode: string) {
    const path = activeTabPath();
    if (!path) return;
    if (suppressUnsaved) {
      suppressUnsaved = false;
      return;
    }
    let output: string;
    let lineMap: number[] | undefined;
    try {
      const result = transpileWithMap(newCode);
      output = result.code;
      lineMap = result.lineMap;
    } catch {
      output = "// Transpile error";
    }
    updateTab(path, { code: newCode, output, unsaved: true, lineMap });
  }

  // Project operations
  async function openProject(path: string, persist = true) {
    try {
      const entries = await invoke<FileEntry[]>("read_directory", { path });
      setProjectPath(path);
      setFileTree(entries);
      if (persist) persistConfig({ last_project: path });
    } catch (e) {
      console.error("Failed to read directory:", e);
    }
  }

  async function refreshProject() {
    const path = projectPath();
    if (path) {
      try {
        const entries = await invoke<FileEntry[]>("read_directory", { path });
        setFileTree(entries);
      } catch (e) {
        console.error("Failed to refresh:", e);
      }
    }
  }

  // File operations
  async function openFile(filePath: string, persist = true) {
    // If already open, just switch to it
    const existing = tabs().find((t) => t.path === filePath);
    if (existing) {
      setActiveTabPath(filePath);
      if (persist) persistConfig({ last_file: filePath });
      return;
    }

    try {
      const content = await invoke<string>("read_file", { path: filePath });
      let code: string;
      let output: string;

      let lineMap: number[] | undefined;
      if (isGscFile(filePath)) {
        try {
          code = reverseTranspile(content);
          output = content;
          // Build line map from the reverse-transpiled code
          try {
            const result = transpileWithMap(code);
            lineMap = result.lineMap;
          } catch { /* ignore */ }
        } catch {
          code = content;
          output = "// Reverse transpile error";
        }
      } else {
        code = content;
        try {
          const result = transpileWithMap(content);
          output = result.code;
          lineMap = result.lineMap;
        } catch {
          output = "// Transpile error";
        }
      }

      const newTab: OpenTab = {
        path: filePath,
        name: fileNameFromPath(filePath),
        code,
        output,
        unsaved: false,
        lineMap,
      };

      suppressUnsaved = true;
      setTabs((prev) => [...prev, newTab]);
      setActiveTabPath(filePath);
      if (persist) persistConfig({ last_file: filePath });
    } catch (e) {
      console.error("Failed to read file:", e);
    }
  }

  async function saveCurrentFile() {
    const tab = getActiveTab();
    if (!tab) return;
    try {
      if (isGscFile(tab.path)) {
        await invoke("write_file", { path: tab.path, content: tab.output });
      } else {
        await invoke("write_file", { path: tab.path, content: tab.code });
      }
      updateTab(tab.path, { unsaved: false });
    } catch (e) {
      console.error("Failed to save file:", e);
    }
  }

  async function saveGscOutput() {
    const tab = getActiveTab();
    if (!tab) return;
    const gscPath = tab.path.replace(/\.pygsc$/, ".gsc");
    try {
      await invoke("write_file", { path: gscPath, content: tab.output });
      await refreshProject();
    } catch (e) {
      console.error("Failed to save GSC:", e);
    }
  }

  function closeTab(path: string) {
    const tabList = tabs();
    const idx = tabList.findIndex((t) => t.path === path);
    if (idx === -1) return;

    const tab = tabList[idx];
    if (tab.unsaved) {
      if (!confirm(`"${tab.name}" has unsaved changes. Close anyway?`)) return;
    }

    const newTabs = tabList.filter((t) => t.path !== path);
    setTabs(newTabs);

    // Switch to adjacent tab if closing the active one
    if (activeTabPath() === path) {
      if (newTabs.length > 0) {
        const newIdx = Math.min(idx, newTabs.length - 1);
        setActiveTabPath(newTabs[newIdx].path);
      } else {
        setActiveTabPath(null);
      }
    }
  }

  function switchTab(path: string) {
    suppressUnsaved = true;
    setActiveTabPath(path);
    persistConfig({ last_file: path });
  }

  function openApiReference(functionName?: string) {
    const apiTabPath = "__api-reference__";
    const existing = tabs().find((t) => t.path === apiTabPath);
    if (existing) {
      // Update the search term via code field
      updateTab(apiTabPath, { code: functionName ?? "" });
      setActiveTabPath(apiTabPath);
      return;
    }
    const newTab: OpenTab = {
      path: apiTabPath,
      name: "API Reference",
      code: functionName ?? "",
      output: "",
      unsaved: false,
      type: "api-reference",
    };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabPath(apiTabPath);
  }

  // File management operations
  async function createFile(path: string) {
    try {
      await invoke("create_file", { path });
      await refreshProject();
      await openFile(path);
    } catch (e) {
      console.error("Failed to create file:", e);
    }
  }

  async function createDirectory(path: string) {
    try {
      await invoke("create_directory", { path });
      await refreshProject();
    } catch (e) {
      console.error("Failed to create directory:", e);
    }
  }

  async function deletePath(path: string) {
    try {
      await invoke("delete_path", { path });
      // Close tab if open
      if (tabs().find((t) => t.path === path)) {
        setTabs((prev) => prev.filter((t) => t.path !== path));
        if (activeTabPath() === path) {
          const remaining = tabs();
          setActiveTabPath(remaining.length > 0 ? remaining[0].path : null);
        }
      }
      await refreshProject();
    } catch (e) {
      console.error("Failed to delete:", e);
    }
  }

  async function renamePath(oldPath: string, newPath: string) {
    try {
      await invoke("rename_path", { oldPath, newPath });
      // Update tab if open
      const tab = tabs().find((t) => t.path === oldPath);
      if (tab) {
        setTabs((prev) =>
          prev.map((t) =>
            t.path === oldPath
              ? { ...t, path: newPath, name: fileNameFromPath(newPath) }
              : t
          )
        );
        if (activeTabPath() === oldPath) {
          setActiveTabPath(newPath);
        }
      }
      await refreshProject();
    } catch (e) {
      console.error("Failed to rename:", e);
    }
  }

  async function copyPath(src: string, dest: string) {
    try {
      await invoke("copy_path", { src, dest });
      await refreshProject();
    } catch (e) {
      console.error("Failed to copy:", e);
    }
  }

  async function selectTheme(themeId: string) {
    const preset = getPresetById(themeId);
    if (preset) {
      applyTheme(preset.colors);
      setActiveTheme(themeId);
      persistConfig({ theme: themeId });
    }
  }

  // Derived state for Editor
  function activeCode(): string {
    return getActiveTab()?.code ?? "";
  }

  function activeOutput(): string {
    return getActiveTab()?.output ?? "";
  }

  function activeLineMap(): number[] | undefined {
    return getActiveTab()?.lineMap;
  }

  return (
    <div class="app">
      <Sidebar
        fileTree={fileTree()}
        projectPath={projectPath()}
        currentFile={activeTabPath()}
        activeTheme={activeTheme()}
        onOpenProject={(p) => openProject(p)}
        onOpenFile={(f) => openFile(f)}
        onSaveFile={saveCurrentFile}
        onSaveGsc={saveGscOutput}
        onSelectTheme={selectTheme}
        onCreateFile={createFile}
        onCreateDirectory={createDirectory}
        onDeletePath={deletePath}
        onRenamePath={renamePath}
        onCopyPath={copyPath}
        onRefresh={refreshProject}
        onOpenApiReference={openApiReference}
      />
      <main class="content">
        <Editor
          tabs={tabs()}
          activeTabPath={activeTabPath()}
          onCodeChange={handleCodeChange}
          onSwitchTab={switchTab}
          onCloseTab={closeTab}
          onSaveFile={saveCurrentFile}
          code={activeCode()}
          output={activeOutput()}
          lineMap={activeLineMap()}
        />
      </main>
    </div>
  );
}

export default App;
