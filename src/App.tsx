import { createSignal, onMount, onCleanup } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { transpileWithMap, reverseTranspile, mergeCustomApi, mergeCustomUsings, lint, lintGsc } from "./lib/transpiler";
import { parseFile, invalidateApiNames } from "./lib/language-service";
import { loadConfig, saveConfig, loadCustomApi, saveCustomApi, loadCustomUsings, saveCustomUsings, type AppConfig } from "./lib/settings";
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

/** Convert a file path to a stable URI for the language service */
function fileUri(path: string): string {
  return "file:///" + path.replace(/\\/g, "/");
}

/** Collect all script file paths (.pygsc, .gsc, .csc) from a file tree */
function collectScriptPaths(entries: FileEntry[]): string[] {
  const paths: string[] = [];
  const exts = [".pygsc", ".gsc", ".csc"];
  function walk(items: FileEntry[]) {
    for (const e of items) {
      if (e.is_dir) {
        if (e.children) walk(e.children);
      } else if (exts.some((ext) => e.name.endsWith(ext))) {
        paths.push(e.path);
      }
    }
  }
  walk(entries);
  return paths;
}

function App() {
  const [tabs, setTabs] = createSignal<OpenTab[]>([]);
  const [activeTabPath, setActiveTabPath] = createSignal<string | null>(null);
  const [projectPath, setProjectPath] = createSignal<string | null>(null);
  const [fileTree, setFileTree] = createSignal<FileEntry[]>([]);
  const [activeTheme, setActiveTheme] = createSignal("steam-dark");
  const [sidebarWidth, setSidebarWidth] = createSignal(260);
  const [editorSplit, setEditorSplit] = createSignal(50);
  const [expandedDirs, setExpandedDirs] = createSignal<string[]>([]);
  const [fileErrors, setFileErrors] = createSignal<Record<string, number>>({});
  let suppressUnsaved = false;
  let configLoaded = false;

  /** Read and parse all script files in the project for IntelliSense */
  async function indexProjectFiles(entries: FileEntry[]) {
    const paths = collectScriptPaths(entries);
    const errorMap: Record<string, number> = {};
    // Read files in parallel, parse each for language service + lint
    const results = await Promise.allSettled(
      paths.map(async (p) => {
        const content = await invoke<string>("read_file", { path: p });
        // For GSC/CSC files, reverse-transpile to PyGSC so line numbers match the editor
        let code = content;
        if (isGscFile(p)) {
          try {
            code = reverseTranspile(content);
          } catch { /* use raw content as fallback */ }
        }
        parseFile(fileUri(p), code);
        // Lint all project files (PyGSC + GSC)
        const diagnostics = lint(code);
        let errorCount = diagnostics.filter(d => d.severity === "error").length;
        // For GSC/CSC files, lint the original content directly (not round-tripped)
        // to stay consistent with openFile and avoid false positives from
        // reverse→forward transpile discrepancies.
        if (isGscFile(p)) {
          const gscDiags = lintGsc(content);
          errorCount += gscDiags.filter(d => d.severity === "error").length;
        } else {
          try {
            const result = transpileWithMap(code);
            const gscDiags = lintGsc(result.code);
            errorCount += gscDiags.filter(d => d.severity === "error").length;
          } catch { /* transpile error, already counted */ }
        }
        if (errorCount > 0) errorMap[p] = errorCount;
      })
    );
    setFileErrors((prev) => ({ ...prev, ...errorMap }));
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed > 0) console.warn(`Language service: failed to index ${failed} files`);
  }

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
    if (!configLoaded) return;
    const current: AppConfig = {
      theme: activeTheme(),
      last_project: projectPath(),
      last_file: activeTabPath(),
      open_tabs: tabs().filter((t) => t.type !== "api-reference").map((t) => t.path),
      sidebar_width: sidebarWidth(),
      editor_split: editorSplit(),
      expanded_dirs: expandedDirs(),
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

    // Load custom API/usings before anything else
    try {
      const [customApiStr, customUsingsStr] = await Promise.all([
        loadCustomApi(),
        loadCustomUsings(),
      ]);
      const customApi = JSON.parse(customApiStr);
      const customUsings = JSON.parse(customUsingsStr);
      if (Object.keys(customApi).length > 0) {
        mergeCustomApi(customApi);
        invalidateApiNames();
      }
      if (Object.keys(customUsings).length > 0) {
        mergeCustomUsings(customUsings);
      }
    } catch (e) {
      console.warn("Failed to load custom API data:", e);
    }

    try {
      const config = await loadConfig();
      const preset = getPresetById(config.theme);
      if (preset) {
        applyTheme(preset.colors);
        setActiveTheme(preset.id);
      }
      if (config.sidebar_width) setSidebarWidth(config.sidebar_width);
      if (config.editor_split) setEditorSplit(config.editor_split);
      if (config.expanded_dirs?.length) setExpandedDirs(config.expanded_dirs);
      if (config.last_project) {
        await openProject(config.last_project, false);
      }
      // Restore all previously open tabs
      const tabsToOpen = config.open_tabs || [];
      for (const tabPath of tabsToOpen) {
        await openFile(tabPath, false);
      }
      // Switch to the last active tab
      if (config.last_file && tabs().some((t) => t.path === config.last_file)) {
        setActiveTabPath(config.last_file);
      }
    } catch {
      applyTheme(PRESET_THEMES[0].colors);
    }
    configLoaded = true;
  });

  onCleanup(() => {
    document.removeEventListener("keydown", handleKeyDown);
  });

  // Code change handler
  function handleCodeChange(newCode: string) {
    const path = activeTabPath();
    if (!path) return;
    // Skip if the code hasn't actually changed (e.g. programmatic setValue on tab switch)
    const currentTab = tabs().find((t) => t.path === path);
    if (currentTab && currentTab.code === newCode) return;
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

    // Run lint and track error count for this file (PyGSC + GSC)
    const diagnostics = lint(newCode);
    let errorCount = diagnostics.filter(d => d.severity === "error").length;
    if (output && output !== "// Transpile error") {
      const gscDiags = lintGsc(output);
      errorCount += gscDiags.filter(d => d.severity === "error").length;
    }
    setFileErrors((prev) => ({ ...prev, [path]: errorCount }));
  }

  // Project operations
  async function openProject(path: string, persist = true) {
    try {
      const entries = await invoke<FileEntry[]>("read_directory", { path });
      setProjectPath(path);
      setFileTree(entries);
      if (persist) persistConfig({ last_project: path });
      // Index all .pygsc files for cross-file IntelliSense
      indexProjectFiles(entries);
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
        // Re-index after refresh (new/deleted files)
        indexProjectFiles(entries);
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

      // Lint the opened file (PyGSC + GSC)
      const diagnostics = lint(code);
      let errorCount = diagnostics.filter(d => d.severity === "error").length;
      if (output && output !== "// Transpile error" && output !== "// Reverse transpile error") {
        const gscDiags = lintGsc(output);
        errorCount += gscDiags.filter(d => d.severity === "error").length;
      }
      setFileErrors((prev) => ({ ...prev, [filePath]: errorCount }));
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

  async function closeTab(path: string) {
    const tabList = tabs();
    const idx = tabList.findIndex((t) => t.path === path);
    if (idx === -1) return;

    const tab = tabList[idx];
    if (tab.unsaved) {
      const confirmed = await ask(`"${tab.name}" has unsaved changes. Close anyway?`, {
        title: "Unsaved Changes",
        kind: "warning",
      });
      if (!confirmed) return;
    }

    const newTabs = tabList.filter((t) => t.path !== path);
    setTabs(newTabs);

    // Switch to adjacent tab if closing the active one
    if (activeTabPath() === path) {
      if (newTabs.length > 0) {
        const newIdx = Math.min(idx, newTabs.length - 1);
        setActiveTabPath(newTabs[newIdx].path);
        persistConfig({ last_file: newTabs[newIdx].path });
      } else {
        setActiveTabPath(null);
        persistConfig({ last_file: null });
      }
    } else {
      persistConfig({});
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

  // Custom API management
  async function addCustomApi(entry: { keyword: string; translation: string; category: string; summary?: string; fullAPI?: string; example?: string }) {
    try {
      const raw = await loadCustomApi();
      const custom = JSON.parse(raw);
      if (!custom[entry.category]) custom[entry.category] = {};
      custom[entry.category][entry.keyword] = {
        translation: entry.translation,
        ...(entry.summary ? { summary: entry.summary } : {}),
        ...(entry.fullAPI ? { fullAPI: entry.fullAPI } : {}),
        ...(entry.example ? { example: entry.example } : {}),
      };
      await saveCustomApi(JSON.stringify(custom, null, 2));
      mergeCustomApi(custom);
      invalidateApiNames();
    } catch (e) {
      console.error("Failed to add custom API:", e);
    }
  }

  async function deleteCustomApi(category: string, keyword: string) {
    try {
      const raw = await loadCustomApi();
      const custom = JSON.parse(raw);
      if (custom[category]) {
        delete custom[category][keyword];
        if (Object.keys(custom[category]).length === 0) delete custom[category];
      }
      await saveCustomApi(JSON.stringify(custom, null, 2));
      mergeCustomApi(custom);
      invalidateApiNames();
    } catch (e) {
      console.error("Failed to delete custom API:", e);
    }
  }

  async function addCustomUsing(entry: { namespace: string; usingPath: string }) {
    try {
      const raw = await loadCustomUsings();
      const custom = JSON.parse(raw);
      custom[entry.namespace] = entry.usingPath;
      await saveCustomUsings(JSON.stringify(custom, null, 2));
      mergeCustomUsings(custom);
    } catch (e) {
      console.error("Failed to add custom using:", e);
    }
  }

  async function deleteCustomUsing(namespace: string) {
    try {
      const raw = await loadCustomUsings();
      const custom = JSON.parse(raw);
      delete custom[namespace];
      await saveCustomUsings(JSON.stringify(custom, null, 2));
      mergeCustomUsings(custom);
    } catch (e) {
      console.error("Failed to delete custom using:", e);
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

  /** Navigate to a specific file, line, and column (used by IntelliSense) */
  let pendingNavigation: { line: number; col: number } | null = null;

  async function navigateToFile(filePath: string, line: number, col: number) {
    const currentPath = activeTabPath();
    if (currentPath === filePath) {
      // Same file: just emit a navigation event
      window.dispatchEvent(new CustomEvent("pygsc-navigate", { detail: { line, col } }));
      return;
    }
    // Store pending navigation, open the file, then navigate after it loads
    pendingNavigation = { line, col };
    await openFile(filePath);
    // Dispatch after a tick to let the editor update
    setTimeout(() => {
      if (pendingNavigation) {
        window.dispatchEvent(new CustomEvent("pygsc-navigate", { detail: pendingNavigation }));
        pendingNavigation = null;
      }
    }, 50);
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
        onAddCustomApi={addCustomApi}
        onDeleteCustomApi={deleteCustomApi}
        onAddCustomUsing={addCustomUsing}
        onDeleteCustomUsing={deleteCustomUsing}
        initialPanelWidth={sidebarWidth()}
        onPanelWidthChange={(w) => { setSidebarWidth(w); persistConfig({ sidebar_width: w }); }}
        initialExpandedDirs={expandedDirs()}
        onExpandedDirsChange={(dirs) => { setExpandedDirs(dirs); persistConfig({ expanded_dirs: dirs }); }}
        fileErrors={fileErrors()}
      />
      <main class="content">
        <Editor
          tabs={tabs()}
          activeTabPath={activeTabPath()}
          onCodeChange={handleCodeChange}
          onSwitchTab={switchTab}
          onCloseTab={closeTab}
          onSaveFile={saveCurrentFile}
          onNavigateToFile={navigateToFile}
          code={activeCode()}
          output={activeOutput()}
          lineMap={activeLineMap()}
          initialSplitPercent={editorSplit()}
          onSplitPercentChange={(p) => { setEditorSplit(p); persistConfig({ editor_split: p }); }}
        />
      </main>
    </div>
  );
}

export default App;
