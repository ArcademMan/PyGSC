import { createSignal, createEffect, Show, For, onCleanup } from "solid-js";
import { open } from "@tauri-apps/plugin-dialog";
import { getApiData, getBo3Api, getCustomApiEntries, type Bo3Function } from "../lib/transpiler";
import { PRESET_THEMES } from "../lib/themes";
import type { FileEntry } from "../App";

export interface CustomApiEntry {
  keyword: string;
  translation: string;
  category: string;
  summary?: string;
  fullAPI?: string;
  example?: string;
}

export interface CustomUsingEntry {
  namespace: string;
  usingPath: string;
}

interface SidebarProps {
  fileTree: FileEntry[];
  projectPath: string | null;
  currentFile: string | null;
  activeTheme: string;
  onOpenProject: (path: string) => void;
  onOpenFile: (path: string) => void;
  onSaveFile: () => void;
  onSaveGsc: () => void;
  onSelectTheme: (themeId: string) => void;
  onCreateFile: (path: string) => void;
  onCreateDirectory: (path: string) => void;
  onDeletePath: (path: string) => void;
  onRenamePath: (oldPath: string, newPath: string) => void;
  onCopyPath: (src: string, dest: string) => void;
  onRefresh: () => void;
  onOpenApiReference: (functionName?: string) => void;
  onAddCustomApi?: (entry: CustomApiEntry) => void;
  onDeleteCustomApi?: (category: string, keyword: string) => void;
  onAddCustomUsing?: (entry: CustomUsingEntry) => void;
  onDeleteCustomUsing?: (namespace: string) => void;
  initialPanelWidth?: number;
  onPanelWidthChange?: (width: number) => void;
  initialExpandedDirs?: string[];
  onExpandedDirsChange?: (dirs: string[]) => void;
  fileErrors?: Record<string, number>;
  pygscEnabled?: boolean;
  onTogglePygsc?: (enabled: boolean) => void;
}

type PanelId = "explorer" | "api" | "themes" | "settings" | null;

interface ContextMenu {
  x: number;
  y: number;
  path: string;
  isDir: boolean;
  name: string;
}

function Sidebar(props: SidebarProps) {
  const [activePanel, setActivePanel] = createSignal<PanelId>("explorer");
  const [apiSearch, setApiSearch] = createSignal("");
  const [expandedCategories, setExpandedCategories] = createSignal<Set<string>>(new Set());
  const [expandedDirs, setExpandedDirs] = createSignal<Set<string>>(
    new Set(props.initialExpandedDirs ?? [])
  );
  const [contextMenu, setContextMenu] = createSignal<ContextMenu | null>(null);
  const [inlineInput, setInlineInput] = createSignal<{ parentDir: string; type: "file" | "folder"; ext?: string } | null>(null);
  const [renaming, setRenaming] = createSignal<{ path: string; name: string } | null>(null);
  const [clipboard, setClipboard] = createSignal<{ path: string; op: "copy" | "cut" } | null>(null);
  const [panelWidth, setPanelWidth] = createSignal(props.initialPanelWidth ?? 260);
  const [showAddApi, setShowAddApi] = createSignal(false);
  const [showAddUsing, setShowAddUsing] = createSignal(false);
  const [customApiVersion, setCustomApiVersion] = createSignal(0);

  // Close context menu on click anywhere
  function handleGlobalClick() { setContextMenu(null); }
  document.addEventListener("click", handleGlobalClick);
  onCleanup(() => document.removeEventListener("click", handleGlobalClick));

  // Panel resize
  let dragging = false;
  function onPanelResizeDown(e: MouseEvent) {
    e.preventDefault();
    dragging = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const onMove = (ev: MouseEvent) => {
      if (!dragging) return;
      // 48px = activity bar width
      const newWidth = ev.clientX - 48;
      setPanelWidth(Math.max(180, Math.min(500, newWidth)));
    };
    const onUp = () => {
      dragging = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      props.onPanelWidthChange?.(panelWidth());
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  function togglePanel(id: PanelId) {
    setActivePanel((prev) => (prev === id ? null : id));
  }

  function toggleCategory(cat: string) {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  }

  function toggleDir(path: string) {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      // Notify parent for persistence
      props.onExpandedDirsChange?.([...next]);
      return next;
    });
  }

  // Sync expanded dirs when restored from config (initial load is async)
  createEffect(() => {
    const restored = props.initialExpandedDirs;
    if (restored && restored.length > 0) {
      setExpandedDirs(new Set(restored));
    }
  });

  // Auto-expand project root when it changes
  createEffect(() => {
    const root = props.projectPath;
    if (root && !expandedDirs().has(root)) {
      setExpandedDirs((prev) => {
        const next = new Set(prev);
        next.add(root);
        return next;
      });
    }
  });

  function isExpanded(path: string) { return expandedDirs().has(path); }

  async function handleOpenFolder() {
    const selected = await open({ directory: true, multiple: false });
    if (selected) {
      props.onOpenProject(selected as string);
      setExpandedDirs(new Set([selected as string]));
    }
  }

  function projectName(): string {
    if (!props.projectPath) return "";
    const parts = props.projectPath.replace(/\\/g, "/").split("/");
    return parts[parts.length - 1] || "";
  }

  function parentOf(path: string): string {
    const normalized = path.replace(/\\/g, "/");
    const idx = normalized.lastIndexOf("/");
    return idx > 0 ? path.substring(0, idx) : path;
  }

  function sep(path: string): string {
    return path.includes("\\") ? "\\" : "/";
  }

  function showContextMenu(e: MouseEvent, entry: { path: string; is_dir: boolean; name: string }) {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, path: entry.path, isDir: entry.is_dir, name: entry.name });
  }

  function startNewFile(parentDir: string, ext?: string) {
    setContextMenu(null);
    setInlineInput({ parentDir, type: "file", ext });
    setExpandedDirs((prev) => new Set(prev).add(parentDir));
  }

  function startNewFolder(parentDir: string) {
    setContextMenu(null);
    setInlineInput({ parentDir, type: "folder" });
    setExpandedDirs((prev) => new Set(prev).add(parentDir));
  }

  function commitInlineInput(value: string) {
    const input = inlineInput();
    if (!input || !value.trim()) { setInlineInput(null); return; }
    let name = value.trim();
    // Auto-add extension if provided and not already there
    if (input.ext && !name.endsWith(input.ext)) {
      name += input.ext;
    }
    const fullPath = input.parentDir + sep(input.parentDir) + name;
    if (input.type === "file") {
      props.onCreateFile(fullPath);
    } else {
      props.onCreateDirectory(fullPath);
    }
    setInlineInput(null);
  }

  function startRename(path: string, name: string) {
    setContextMenu(null);
    setRenaming({ path, name });
  }

  function commitRename(newName: string) {
    const r = renaming();
    if (!r || !newName.trim() || newName === r.name) { setRenaming(null); return; }
    const parent = parentOf(r.path);
    const newPath = parent + sep(r.path) + newName.trim();
    props.onRenamePath(r.path, newPath);
    setRenaming(null);
  }

  function handleCopy(path: string) { setClipboard({ path, op: "copy" }); setContextMenu(null); }
  function handleCut(path: string) { setClipboard({ path, op: "cut" }); setContextMenu(null); }

  function handlePaste(targetDir: string) {
    const cb = clipboard();
    if (!cb) return;
    const srcName = cb.path.replace(/\\/g, "/").split("/").pop()!;
    const dest = targetDir + sep(targetDir) + srcName;
    if (cb.op === "copy") props.onCopyPath(cb.path, dest);
    else props.onRenamePath(cb.path, dest);
    setClipboard(null);
    setContextMenu(null);
  }

  function handleDelete(path: string) {
    setContextMenu(null);
    if (confirm(`Delete "${path.replace(/\\/g, "/").split("/").pop()}"?`)) {
      props.onDeletePath(path);
    }
  }

  function fileIcon(name: string): string {
    if (name.endsWith(".pygsc")) return "P";
    if (name.endsWith(".gsc") || name.endsWith(".csc")) return "G";
    if (name.endsWith(".json")) return "J";
    if (name.endsWith(".txt") || name.endsWith(".md")) return "T";
    return "F";
  }

  function fileIconClass(name: string): string {
    if (name.endsWith(".pygsc")) return "file-icon pygsc";
    if (name.endsWith(".gsc") || name.endsWith(".csc")) return "file-icon gsc";
    if (name.endsWith(".json")) return "file-icon json";
    return "file-icon default";
  }

  function filteredBo3Api(): [string, Bo3Function][] {
    const search = apiSearch().toLowerCase();
    const entries = Object.entries(getBo3Api());
    if (!search) return entries;
    return entries.filter(([name, info]) =>
      name.toLowerCase().includes(search) ||
      (info.summary && info.summary.toLowerCase().includes(search))
    );
  }

  function isCustomApiEntry(category: string, key: string): boolean {
    // Force reactivity on customApiVersion
    void customApiVersion();
    const custom = getCustomApiEntries();
    return !!custom[category]?.[key];
  }

  function filteredApi() {
    // Force re-read when custom entries change
    void customApiVersion();
    const search = apiSearch().toLowerCase();
    const data = getApiData();
    const result: Record<string, Record<string, { translation: string; summary?: string; fullAPI?: string }>> = {};
    for (const [category, entries] of Object.entries(data)) {
      const filtered: Record<string, { translation: string; summary?: string; fullAPI?: string }> = {};
      for (const [key, val] of Object.entries(entries)) {
        if (!search || key.toLowerCase().includes(search) || (val.summary && val.summary.toLowerCase().includes(search))) {
          filtered[key] = val;
        }
      }
      if (Object.keys(filtered).length > 0) result[category] = filtered;
    }
    return result;
  }

  function InlineInputField(fieldProps: { onCommit: (val: string) => void; placeholder: string; defaultValue?: string }) {
    let ref!: HTMLInputElement;
    setTimeout(() => { ref?.focus(); if (fieldProps.defaultValue) ref?.select(); }, 0);
    return (
      <input ref={ref} class="inline-input"
        placeholder={fieldProps.placeholder}
        value={fieldProps.defaultValue || ""}
        onKeyDown={(e) => {
          if (e.key === "Enter") fieldProps.onCommit(e.currentTarget.value);
          if (e.key === "Escape") { setInlineInput(null); setRenaming(null); }
        }}
        onBlur={(e) => fieldProps.onCommit(e.currentTarget.value)}
      />
    );
  }

  /** Count total errors in a directory (recursively) */
  function dirErrorCount(entry: FileEntry): number {
    if (!entry.is_dir || !entry.children || !props.fileErrors) return 0;
    let total = 0;
    for (const child of entry.children) {
      if (child.is_dir) {
        total += dirErrorCount(child);
      } else {
        total += props.fileErrors[child.path] ?? 0;
      }
    }
    return total;
  }

  function FileTreeNode(nodeProps: { entry: FileEntry; depth: number }) {
    const isOpen = () => isExpanded(nodeProps.entry.path);
    const isActive = () => props.currentFile === nodeProps.entry.path;
    const isRenaming = () => renaming()?.path === nodeProps.entry.path;
    const hasInlineChild = () => inlineInput()?.parentDir === nodeProps.entry.path;

    if (nodeProps.entry.is_dir) {
      return (
        <div class="tree-node">
          <div class={`tree-item dir ${isOpen() ? "open" : ""}`}
            style={{ "padding-left": `${12 + nodeProps.depth * 16}px` }}
            onClick={() => toggleDir(nodeProps.entry.path)}
            onContextMenu={(e) => showContextMenu(e, nodeProps.entry)}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
              class={isOpen() ? "chevron-open" : "chevron-closed"}>
              <path d="M9 18l6-6-6-6"/>
            </svg>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="folder-icon">
              <path d="M3 7V17C3 18.1 3.9 19 5 19H19C20.1 19 21 18.1 21 17V9C21 7.9 20.1 7 19 7H11L9 5H5C3.9 5 3 5.9 3 7Z"/>
            </svg>
            <Show when={!isRenaming()}>
              <span class="tree-label">{nodeProps.entry.name}</span>
            </Show>
            <Show when={isRenaming()}>
              <InlineInputField defaultValue={renaming()!.name} onCommit={commitRename} placeholder="new name" />
            </Show>
            <Show when={dirErrorCount(nodeProps.entry) > 0}>
              <span class="file-error-dot" title={`${dirErrorCount(nodeProps.entry)} error(s) in folder`} />
            </Show>
          </div>
          <Show when={isOpen()}>
            <Show when={hasInlineChild()}>
              <div class="tree-item file" style={{ "padding-left": `${28 + (nodeProps.depth + 1) * 16}px` }}>
                <span class={`file-icon ${inlineInput()!.type === "folder" ? "default" : (inlineInput()!.ext === ".gsc" ? "gsc" : "pygsc")}`}>
                  {inlineInput()!.type === "folder" ? "D" : (inlineInput()!.ext === ".gsc" ? "G" : "P")}
                </span>
                <InlineInputField onCommit={commitInlineInput}
                  placeholder={inlineInput()!.type === "folder" ? "folder name" : `file name`} />
              </div>
            </Show>
            <Show when={nodeProps.entry.children}>
              <For each={nodeProps.entry.children!}>
                {(child) => <FileTreeNode entry={child} depth={nodeProps.depth + 1} />}
              </For>
            </Show>
          </Show>
        </div>
      );
    }

    return (
      <div class={`tree-item file ${isActive() ? "active" : ""}`}
        style={{ "padding-left": `${28 + nodeProps.depth * 16}px` }}
        onClick={() => !isRenaming() && props.onOpenFile(nodeProps.entry.path)}
        onContextMenu={(e) => showContextMenu(e, nodeProps.entry)}>
        <span class={fileIconClass(nodeProps.entry.name)}>{fileIcon(nodeProps.entry.name)}</span>
        <Show when={!isRenaming()}>
          <span class="tree-label">{nodeProps.entry.name}</span>
        </Show>
        <Show when={isRenaming()}>
          <InlineInputField defaultValue={renaming()!.name} onCommit={commitRename} placeholder="new name" />
        </Show>
        <Show when={(props.fileErrors?.[nodeProps.entry.path] ?? 0) > 0}>
          <span class="file-error-dot" title={`${props.fileErrors![nodeProps.entry.path]} error(s)`} />
        </Show>
      </div>
    );
  }

  // Build a root FileEntry that wraps the file tree
  function rootEntry(): FileEntry {
    return {
      name: projectName(),
      path: props.projectPath!,
      is_dir: true,
      children: props.fileTree,
    };
  }

  return (
    <div class="sidebar-wrapper">
      {/* Activity Bar */}
      <div class="activity-bar">
        <div class="activity-top">
          <button class={`activity-btn ${activePanel() === "explorer" ? "active" : ""}`}
            onClick={() => togglePanel("explorer")} title="Explorer">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
              <path d="M3 7V17C3 18.1 3.9 19 5 19H19C20.1 19 21 18.1 21 17V9C21 7.9 20.1 7 19 7H11L9 5H5C3.9 5 3 5.9 3 7Z"/>
            </svg>
          </button>
          <button class={`activity-btn ${activePanel() === "api" ? "active" : ""}`}
            onClick={() => togglePanel("api")} title="API Reference">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
              <path d="M4 6H20M4 12H20M4 18H14"/>
            </svg>
          </button>
          <button class={`activity-btn ${activePanel() === "themes" ? "active" : ""}`}
            onClick={() => togglePanel("themes")} title="Themes">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
              <circle cx="12" cy="12" r="5"/>
              <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
            </svg>
          </button>
        </div>
        <div class="activity-bottom">
          <button class={`activity-btn ${activePanel() === "settings" ? "active" : ""}`}
            onClick={() => togglePanel("settings")} title="Settings">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Side Panel */}
      <Show when={activePanel() !== null}>
        <div class="side-panel" style={{ width: `${panelWidth()}px`, "min-width": `${panelWidth()}px` }}>
          {/* Explorer */}
          <Show when={activePanel() === "explorer"}>
            <div class="panel-title-bar">
              <span class="panel-title">EXPLORER</span>
              <Show when={props.projectPath}>
                <div class="panel-title-actions">
                  <button class="icon-btn" onClick={() => startNewFile(props.projectPath!, ".pygsc")} title="New .pygsc">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                      <polyline points="14 2 14 8 20 8"/>
                      <line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/>
                    </svg>
                  </button>
                  <button class="icon-btn" onClick={() => startNewFolder(props.projectPath!)} title="New Folder">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M3 7V17C3 18.1 3.9 19 5 19H19C20.1 19 21 18.1 21 17V9C21 7.9 20.1 7 19 7H11L9 5H5C3.9 5 3 5.9 3 7Z"/>
                      <line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/>
                    </svg>
                  </button>
                  <button class="icon-btn" onClick={() => props.onRefresh()} title="Refresh">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <polyline points="23 4 23 10 17 10"/>
                      <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/>
                    </svg>
                  </button>
                  <button class="icon-btn" onClick={handleOpenFolder} title="Change Folder">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M3 7V17C3 18.1 3.9 19 5 19H19C20.1 19 21 18.1 21 17V9C21 7.9 20.1 7 19 7H11L9 5H5C3.9 5 3 5.9 3 7Z"/>
                    </svg>
                  </button>
                </div>
              </Show>
            </div>
            <div class="panel-body">
              <Show when={!props.projectPath}>
                <div class="no-project">
                  <p class="no-project-text">No folder opened yet.</p>
                  <button class="btn btn-open-folder" onClick={handleOpenFolder}>Open Folder</button>
                </div>
              </Show>
              <Show when={props.projectPath}>
                <div class="file-tree">
                  <FileTreeNode entry={rootEntry()} depth={0} />
                </div>
              </Show>
            </div>
          </Show>

          {/* API Panel */}
          <Show when={activePanel() === "api"}>
            <div class="panel-title-bar">
              <span class="panel-title">API REFERENCE</span>
              <div style={{ display: "flex", gap: "2px" }}>
                <button class="icon-btn" onClick={() => { setShowAddApi(!showAddApi()); setShowAddUsing(false); }} title="Add Custom API">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                  </svg>
                </button>
                <button class="icon-btn" onClick={() => props.onOpenApiReference()} title="Open Full API Page">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
                    <polyline points="15 3 21 3 21 9"/>
                    <line x1="10" y1="14" x2="21" y2="3"/>
                  </svg>
                </button>
              </div>
            </div>
            <div class="panel-body">
              {/* Add Custom API Form */}
              <Show when={showAddApi()}>
                <div class="custom-api-form">
                  <div class="custom-api-form-tabs">
                    <button class={`custom-api-tab ${!showAddUsing() ? "active" : ""}`}
                      onClick={() => setShowAddUsing(false)}>API Shortcut</button>
                    <button class={`custom-api-tab ${showAddUsing() ? "active" : ""}`}
                      onClick={() => setShowAddUsing(true)}>Using</button>
                  </div>
                  <Show when={!showAddUsing()}>
                    {(() => {
                      const [keyword, setKeyword] = createSignal("");
                      const [translation, setTranslation] = createSignal("");
                      const [category, setCategory] = createSignal("custom");
                      const [summary, setSummary] = createSignal("");
                      function handleSubmit() {
                        const kw = keyword().trim();
                        const tr = translation().trim();
                        if (!kw || !tr) return;
                        props.onAddCustomApi?.({
                          keyword: kw, translation: tr,
                          category: category().trim() || "custom",
                          summary: summary().trim() || undefined,
                        });
                        setKeyword(""); setTranslation(""); setSummary("");
                        setCustomApiVersion((v) => v + 1);
                      }
                      return (
                        <div class="custom-api-fields">
                          <input placeholder="Keyword (e.g. myshortcut)" value={keyword()} onInput={(e) => setKeyword(e.currentTarget.value)} />
                          <input placeholder="Translation (e.g. zm_utility::do_thing)" value={translation()} onInput={(e) => setTranslation(e.currentTarget.value)} />
                          <input placeholder="Category (default: custom)" value={category()} onInput={(e) => setCategory(e.currentTarget.value)} />
                          <input placeholder="Summary (optional)" value={summary()} onInput={(e) => setSummary(e.currentTarget.value)} />
                          <button class="btn btn-add-custom" onClick={handleSubmit}>Add</button>
                        </div>
                      );
                    })()}
                  </Show>
                  <Show when={showAddUsing()}>
                    {(() => {
                      const [ns, setNs] = createSignal("");
                      const [uPath, setUPath] = createSignal("");
                      function handleSubmit() {
                        const nsVal = ns().trim();
                        const pathVal = uPath().trim();
                        if (!nsVal || !pathVal) return;
                        props.onAddCustomUsing?.({
                          namespace: nsVal.endsWith("::") ? nsVal : nsVal + "::",
                          usingPath: pathVal.startsWith("#using ") ? pathVal : `#using ${pathVal}`,
                        });
                        setNs(""); setUPath("");
                        setCustomApiVersion((v) => v + 1);
                      }
                      return (
                        <div class="custom-api-fields">
                          <input placeholder="Namespace (e.g. mymod::)" value={ns()} onInput={(e) => setNs(e.currentTarget.value)} />
                          <input placeholder="Using path (e.g. scripts\zm\_mymod)" value={uPath()} onInput={(e) => setUPath(e.currentTarget.value)} />
                          <button class="btn btn-add-custom" onClick={handleSubmit}>Add</button>
                        </div>
                      );
                    })()}
                  </Show>
                </div>
              </Show>

              <input class="api-search" placeholder="Search API..."
                value={apiSearch()} onInput={(e) => setApiSearch(e.currentTarget.value)} />
              <div class="api-list">
                <For each={Object.entries(filteredApi())}>
                  {([category, entries]) => (
                    <div class="api-category">
                      <div class="api-category-header" onClick={() => toggleCategory(category)}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                          class={expandedCategories().has(category) ? "chevron-open" : "chevron-closed"}>
                          <path d="M9 18l6-6-6-6"/>
                        </svg>
                        <span>{category}</span>
                        <span class="api-count">{Object.keys(entries).length}</span>
                      </div>
                      <Show when={expandedCategories().has(category)}>
                        <For each={Object.entries(entries)}>
                          {([key, val]) => (
                            <div class={`api-item ${isCustomApiEntry(category, key) ? "api-item-custom" : ""}`}>
                              <div class="api-item-name">{key}</div>
                              <div class="api-item-arrow">{"\u2192"}</div>
                              <div class="api-item-translation">{val.translation}</div>
                              <Show when={val.summary}>
                                <div class="api-item-summary">{val.summary}</div>
                              </Show>
                              <Show when={isCustomApiEntry(category, key)}>
                                <button class="api-item-delete" title="Remove custom entry"
                                  onClick={(e) => { e.stopPropagation(); props.onDeleteCustomApi?.(category, key); setCustomApiVersion((v) => v + 1); }}>
                                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                                  </svg>
                                </button>
                              </Show>
                            </div>
                          )}
                        </For>
                      </Show>
                    </div>
                  )}
                </For>

                {/* BO3 Engine Functions */}
                <Show when={filteredBo3Api().length > 0}>
                  <div class="api-category">
                    <div class="api-category-header" onClick={() => toggleCategory("bo3-engine")}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                        class={expandedCategories().has("bo3-engine") ? "chevron-open" : "chevron-closed"}>
                        <path d="M9 18l6-6-6-6"/>
                      </svg>
                      <span>BO3 Engine Functions</span>
                      <span class="api-count">{filteredBo3Api().length}</span>
                    </div>
                    <Show when={expandedCategories().has("bo3-engine")}>
                      <For each={filteredBo3Api()}>
                        {([name, info]) => (
                          <div class="api-item bo3-compact" onClick={() => props.onOpenApiReference(name)}>
                            <div class="api-item-name bo3">{name}</div>
                            <Show when={info.side}>
                              <span class={`api-badge ${info.side?.toLowerCase()}`}>{info.side}</span>
                            </Show>
                          </div>
                        )}
                      </For>
                    </Show>
                  </div>
                </Show>
              </div>
            </div>
          </Show>

          {/* Themes Panel */}
          <Show when={activePanel() === "themes"}>
            <div class="panel-title-bar"><span class="panel-title">THEMES</span></div>
            <div class="panel-body themes-panel">
              <For each={PRESET_THEMES}>
                {(theme) => (
                  <div class={`theme-card ${props.activeTheme === theme.id ? "theme-card-active" : ""}`}
                    onClick={() => props.onSelectTheme(theme.id)}>
                    <div class="theme-preview">
                      <div class="theme-swatch-bar" style={{ background: theme.colors["bg-activitybar"] }} />
                      <div class="theme-swatch-sidebar" style={{ background: theme.colors["bg-sidebar"] || theme.colors["bg-dark"] }} />
                      <div class="theme-swatch-main" style={{ background: theme.colors["bg-dark"] }}>
                        <div class="theme-swatch-accent" style={{ background: theme.colors.accent }} />
                        <div class="theme-swatch-text" style={{ background: theme.colors.text }} />
                        <div class="theme-swatch-muted" style={{ background: theme.colors["text-muted"] }} />
                      </div>
                    </div>
                    <div class="theme-card-info">
                      <span class="theme-card-name">{theme.name}</span>
                      <Show when={props.activeTheme === theme.id}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="var(--accent)" stroke="none">
                          <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/>
                        </svg>
                      </Show>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>

          {/* Settings Panel */}
          <Show when={activePanel() === "settings"}>
            <div class="panel-title-bar"><span class="panel-title">SETTINGS</span></div>
            <div class="panel-body settings-panel">
              <div class="settings-section">
                <div class="settings-section-title">Editor Mode</div>
                <div class="setting-row">
                  <div class="setting-info">
                    <span class="setting-label">PyGSC Mode</span>
                    <span class="setting-hint">
                      {props.pygscEnabled
                        ? "Dual-pane editor with Python-like syntax and transpilation"
                        : "Single-pane GSC editor with IntelliSense"}
                    </span>
                  </div>
                  <button
                    class={`toggle-switch ${props.pygscEnabled ? "toggle-on" : "toggle-off"}`}
                    onClick={() => props.onTogglePygsc?.(!props.pygscEnabled)}
                    title={props.pygscEnabled ? "Switch to GSC-only editor" : "Switch to PyGSC transpiler mode"}
                  >
                    <span class="toggle-knob" />
                  </button>
                </div>
              </div>
            </div>
          </Show>

          {/* Resize handle */}
          <div class="panel-resize-handle" onMouseDown={onPanelResizeDown} />
        </div>
      </Show>

      {/* Context Menu */}
      <Show when={contextMenu()}>
        <div class="ctx-menu" style={{ left: `${contextMenu()!.x}px`, top: `${contextMenu()!.y}px` }}
          onClick={(e) => e.stopPropagation()}>
          <Show when={contextMenu()!.isDir}>
            <div class="ctx-item" onClick={() => startNewFile(contextMenu()!.path, ".pygsc")}>
              <span class="ctx-file-badge pygsc">P</span> New .pygsc File
            </div>
            <div class="ctx-item" onClick={() => startNewFile(contextMenu()!.path, ".gsc")}>
              <span class="ctx-file-badge gsc">G</span> New .gsc File
            </div>
            <div class="ctx-item" onClick={() => startNewFile(contextMenu()!.path)}>New File</div>
            <div class="ctx-item" onClick={() => startNewFolder(contextMenu()!.path)}>New Folder</div>
            <div class="ctx-sep" />
          </Show>
          <div class="ctx-item" onClick={() => handleCopy(contextMenu()!.path)}>Copy</div>
          <div class="ctx-item" onClick={() => handleCut(contextMenu()!.path)}>Cut</div>
          <Show when={contextMenu()!.isDir && clipboard()}>
            <div class="ctx-item" onClick={() => handlePaste(contextMenu()!.path)}>Paste</div>
          </Show>
          <div class="ctx-sep" />
          <div class="ctx-item" onClick={() => startRename(contextMenu()!.path, contextMenu()!.name)}>Rename</div>
          <div class="ctx-item ctx-danger" onClick={() => handleDelete(contextMenu()!.path)}>Delete</div>
        </div>
      </Show>
    </div>
  );
}

export default Sidebar;
