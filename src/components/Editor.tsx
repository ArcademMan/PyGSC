import { onMount, onCleanup, createEffect, createSignal, Show, For } from "solid-js";
import * as monaco from "monaco-editor";
import type { OpenTab } from "../App";
import { lint, lintGsc } from "../lib/transpiler";
import {
  parseFile,
  setActiveFile,
  findReferencesTo,
  resolveDefinitionAtPosition,
  getActiveFileUri,
} from "../lib/language-service";
import type { FunctionSymbol, SymbolReference } from "../lib/language-service";
import ApiReferencePage from "./ApiReferencePage";
import { registerLanguages } from "./editor/register-languages";

interface EditorProps {
  tabs: OpenTab[];
  activeTabPath: string | null;
  code: string;
  output: string;
  lineMap?: number[];
  onCodeChange: (value: string) => void;
  onSwitchTab: (path: string) => void;
  onCloseTab: (path: string) => void;
  onSaveFile: () => void;
  onNavigateToFile: (filePath: string, line: number, col: number) => void;
  initialSplitPercent?: number;
  onSplitPercentChange?: (percent: number) => void;
  pygscEnabled: boolean;
  onCursorChange?: (line: number, column: number) => void;
  projectPath: string | null;
}

/** Convert a file path to a stable URI for the language service */
function fileUri(path: string): string {
  return "file:///" + path.replace(/\\/g, "/");
}

/** Convert a language-service URI back to a file path */
function filePathFromUri(uri: string): string {
  return uri.replace(/^file:\/\/\//, "").replace(/\//g, "\\");
}

/** Get just the filename from a URI */
function fileNameFromUri(uri: string): string {
  const lastSlash = Math.max(uri.lastIndexOf("/"), uri.lastIndexOf("\\"));
  return uri.substring(lastSlash + 1);
}

function Editor(props: EditorProps) {
  let inputContainerRef!: HTMLDivElement;
  let outputContainerRef!: HTMLDivElement;
  let containerRef!: HTMLDivElement;
  let inputEditor: monaco.editor.IStandaloneCodeEditor | undefined;
  let outputEditor: monaco.editor.IStandaloneCodeEditor | undefined;
  const [splitPercent, setSplitPercent] = createSignal(props.initialSplitPercent ?? 50);
  const [usagesList, setUsagesList] = createSignal<{
    items: { label: string; filePath: string; line: number; col: number; preview: string }[];
    top: number;
    left: number;
  } | null>(null);
  let dragging = false;

  // Per-tab view state (scroll + cursor) — persists across tab switches
  const viewStates = new Map<string, monaco.editor.ICodeEditorViewState | null>();
  let prevTabPath: string | null = null;

  function onMouseDown(e: MouseEvent) {
    e.preventDefault();
    dragging = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMove = (ev: MouseEvent) => {
      if (!dragging || !containerRef) return;
      const rect = containerRef.getBoundingClientRect();
      const pct = ((ev.clientX - rect.left) / rect.width) * 100;
      setSplitPercent(Math.max(15, Math.min(85, pct)));
    };

    const onUp = () => {
      dragging = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      props.onSplitPercentChange?.(splitPercent());
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  function tabDisplayName(tab: OpenTab): string {
    return tab.name;
  }

  function isApiRefTab(): boolean {
    const activeTab = props.tabs.find((t) => t.path === props.activeTabPath);
    return activeTab?.type === "api-reference";
  }

  function gscFileName(): string {
    const tab = props.tabs.find((t) => t.path === props.activeTabPath);
    if (!tab) return "output.gsc";
    return tab.name.replace(/\.pygsc$/, ".gsc");
  }

  onMount(() => {
    registerLanguages();

    inputEditor = monaco.editor.create(inputContainerRef, {
      value: props.code,
      language: "pygsc",
      theme: "pygsc-dark",
      fontSize: 14,
      fontFamily: "'Consolas', 'Fira Code', 'Courier New', monospace",
      minimap: { enabled: false },
      lineNumbers: "on",
      scrollBeyondLastLine: true,
      automaticLayout: true,
      tabSize: 4,
      insertSpaces: true,
      autoIndent: "full",
      wordWrap: "off",
      wordBasedSuggestions: "off",
      renderWhitespace: "none",
      padding: { top: 8 },
    });


    // ── CodeLens commands ──
    // Single usage → navigate directly (same file or cross-file)
    monaco.editor.registerCommand("pygsc.goToUsage", (_accessor, ref: SymbolReference) => {
      const filePath = filePathFromUri(ref.uri);
      props.onNavigateToFile(filePath, ref.line, ref.col);
    });

    // Multiple usages → show custom usages list (reuses showUsagesPopup helper)
    monaco.editor.registerCommand("pygsc.showUsages", (_accessor, fn: FunctionSymbol) => {
      if (!inputEditor) return;
      showUsagesPopup(fn, fn.line);
    });

    outputEditor = monaco.editor.create(outputContainerRef, {
      value: props.output,
      language: "gsc",
      theme: "pygsc-dark",
      fontSize: 14,
      fontFamily: "'Consolas', 'Fira Code', 'Courier New', monospace",
      minimap: { enabled: false },
      lineNumbers: "on",
      scrollBeyondLastLine: true,
      automaticLayout: true,
      tabSize: 4,
      readOnly: true,
      wordWrap: "off",
      renderWhitespace: "none",
      padding: { top: 8 },
      overviewRulerLanes: 3,
      overviewRulerBorder: true,
      renderValidationDecorations: "on",
    });

    inputEditor.onDidChangeModelContent(() => {
      const value = inputEditor!.getValue();
      props.onCodeChange(value);

      // Run lint diagnostics + update language service
      const model = inputEditor!.getModel();
      if (model) {
        const activePath = props.activeTabPath;
        if (activePath) {
          parseFile(fileUri(activePath), value);
        }

        if (props.pygscEnabled) {
          const diagnostics = lint(value);
          const markers: monaco.editor.IMarkerData[] = diagnostics.map(d => ({
            severity: d.severity === "error"
              ? monaco.MarkerSeverity.Error
              : d.severity === "warning"
                ? monaco.MarkerSeverity.Warning
                : monaco.MarkerSeverity.Info,
            message: d.message,
            startLineNumber: d.line,
            startColumn: 1,
            endLineNumber: d.line,
            endColumn: model.getLineMaxColumn(d.line),
          }));
          monaco.editor.setModelMarkers(model, "pygsc-lint", markers);
        } else {
          // GSC-only mode: run GSC linter on input
          monaco.editor.setModelMarkers(model, "pygsc-lint", []);
          const gscDiags = lintGsc(value);
          const markers: monaco.editor.IMarkerData[] = gscDiags.map(d => ({
            severity: d.severity === "error"
              ? monaco.MarkerSeverity.Error
              : d.severity === "warning"
                ? monaco.MarkerSeverity.Warning
                : monaco.MarkerSeverity.Info,
            message: d.message,
            startLineNumber: d.gscLine,
            startColumn: 1,
            endLineNumber: d.gscLine,
            endColumn: model.getLineMaxColumn(d.gscLine),
          }));
          monaco.editor.setModelMarkers(model, "gsc-lint", markers);
        }
      }
    });

    // Bridge lineMap into a plain variable via createEffect so it's always
    // up-to-date when read from Monaco event handlers (outside SolidJS tracking)
    let currentLineMap: number[] | undefined;
    createEffect(() => {
      currentLineMap = props.lineMap;
    });

    // Helper: map PyGSC line (1-based) to GSC line (1-based) using lineMap
    function mapLine(pygscLine: number): number {
      const lineMap = currentLineMap;
      if (!lineMap) return pygscLine; // fallback: same line
      const idx = pygscLine - 1; // lineMap is 0-based
      if (idx >= 0 && idx < lineMap.length) {
        return lineMap[idx] + 1; // convert back to 1-based
      }
      return pygscLine;
    }

    // Sync scroll: PyGSC → GSC (using line map for accurate positioning)
    let syncing = false;
    inputEditor.onDidScrollChange(() => {
      if (!props.pygscEnabled) return;
      if (syncing || !outputEditor) return;
      syncing = true;

      const scrollTop = inputEditor!.getScrollTop();
      const lineHeight = inputEditor!.getOption(monaco.editor.EditorOption.lineHeight);
      const inputPadding = inputEditor!.getOption(monaco.editor.EditorOption.padding);
      const paddingTop = inputPadding?.top ?? 0;

      // Calculate which input line is at the top and the sub-line fraction
      const adjustedScroll = Math.max(0, scrollTop - paddingTop);
      const topLineIndex = Math.floor(adjustedScroll / lineHeight); // 0-based
      const fraction = (adjustedScroll / lineHeight) - topLineIndex;
      const topLine = topLineIndex + 1; // 1-based

      const mappedLine = mapLine(topLine);

      const outputLineHeight = outputEditor.getOption(monaco.editor.EditorOption.lineHeight);
      const outputPadding = outputEditor.getOption(monaco.editor.EditorOption.padding);
      const outputPaddingTop = outputPadding?.top ?? 0;

      outputEditor.setScrollTop(
        (mappedLine - 1) * outputLineHeight + fraction * outputLineHeight + outputPaddingTop
      );

      syncing = false;
    });

    // Sync cursor position: highlight corresponding line in GSC
    inputEditor.onDidChangeCursorPosition((e) => {
      props.onCursorChange?.(e.position.lineNumber, e.position.column);
      if (!props.pygscEnabled || !outputEditor) return;
      const line = e.position.lineNumber;
      const mappedLine = mapLine(line);
      // Reveal the mapped line in the output editor
      outputEditor.revealLineInCenterIfOutsideViewport(mappedLine);
      // Highlight the line with a decoration
      outputEditor.deltaDecorations(
        outputEditor.getModel()?.getAllDecorations()
          ?.filter(d => d.options.className === "synced-line-highlight")
          ?.map(d => d.id) ?? [],
        [{
          range: new monaco.Range(mappedLine, 1, mappedLine, 1),
          options: {
            isWholeLine: true,
            className: "synced-line-highlight",
          },
        }]
      );
    });

    // Ctrl+S in editor
    inputEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      props.onSaveFile();
    });

    // Helper: show the usages popup for a function at a given editor line
    function showUsagesPopup(fn: FunctionSymbol, atLine: number) {
      const refs = findReferencesTo(fn);
      if (refs.length === 0) return;

      if (refs.length === 1) {
        // Single usage → go directly
        const filePath = filePathFromUri(refs[0].uri);
        props.onNavigateToFile(filePath, refs[0].line, refs[0].col);
        return;
      }

      // Build items with code preview
      const items = refs.map((ref) => {
        const filePath = filePathFromUri(ref.uri);
        const fileName = fileNameFromUri(ref.uri);
        const tab = props.tabs.find((t) => fileUri(t.path) === ref.uri);
        const lines = tab ? tab.code.split("\n") : [];
        const preview = (lines[ref.line - 1] ?? "").trim();
        return { label: fileName, filePath, line: ref.line, col: ref.col, preview };
      });

      const lineTop = inputEditor!.getTopForLineNumber(atLine);
      const scrollTop = inputEditor!.getScrollTop();
      const editorDom = inputEditor!.getDomNode();
      if (!editorDom) return;
      const rect = editorDom.getBoundingClientRect();

      setUsagesList({
        items,
        top: rect.top + (lineTop - scrollTop) + 20,
        left: rect.left + 60,
      });
    }

    // Ctrl+Click → find definition, then show its usages (same popup as CodeLens)
    inputEditor.onMouseDown((e) => {
      if (!e.event.ctrlKey && !e.event.metaKey) return;
      if (e.target.type !== monaco.editor.MouseTargetType.CONTENT_TEXT) return;
      const pos = e.target.position;
      if (!pos) return;

      const model = inputEditor!.getModel();
      if (!model) return;
      const word = model.getWordAtPosition(pos);
      if (!word) return;

      const lineText = model.getLineContent(pos.lineNumber);
      const def = resolveDefinitionAtPosition(lineText, word.word, word.startColumn);
      if (!def) return;

      e.event.preventDefault();
      e.event.stopPropagation();

      // If clicking on the definition itself, show its usages
      // If clicking on a call, go to the definition
      const activeUri = getActiveFileUri();
      const isOnDefinition = def.uri === activeUri && def.line === pos.lineNumber;

      if (isOnDefinition) {
        showUsagesPopup(def, pos.lineNumber);
      } else {
        // Navigate to the definition
        const filePath = filePathFromUri(def.uri);
        props.onNavigateToFile(filePath, def.line, def.col);
      }
    });
  });

  // Track active file + save/restore view state on tab switch
  createEffect(() => {
    const activePath = props.activeTabPath;
    if (!inputEditor) return;

    // Save view state for the tab we're leaving
    if (prevTabPath && prevTabPath !== activePath) {
      viewStates.set(prevTabPath, inputEditor.saveViewState());
    }

    // Update code content
    const newCode = props.code;
    if (inputEditor.getValue() !== newCode) {
      inputEditor.setValue(newCode);
    }

    // Restore view state for the tab we're entering
    if (activePath && activePath !== prevTabPath) {
      const savedState = viewStates.get(activePath);
      if (savedState) {
        inputEditor.restoreViewState(savedState);
      }
    }

    prevTabPath = activePath;

    // Update language service URI mapping
    if (activePath) {
      const model = inputEditor.getModel();
      if (model) {
        setActiveFile(fileUri(activePath), model.uri);
      }
    }
  });

  // Switch editor language when pygscEnabled changes
  createEffect(() => {
    if (!inputEditor) return;
    const model = inputEditor.getModel();
    if (!model) return;
    const targetLang = props.pygscEnabled ? "pygsc" : "gsc";
    if (model.getLanguageId() !== targetLang) {
      monaco.editor.setModelLanguage(model, targetLang);
    }
  });

  createEffect(() => {
    if (!props.pygscEnabled) {
      // In GSC-only mode, clear output editor and its markers
      if (outputEditor) {
        if (outputEditor.getValue() !== "") outputEditor.setValue("");
        const outputModel = outputEditor.getModel();
        if (outputModel) monaco.editor.setModelMarkers(outputModel, "gsc-lint", []);
      }
      return;
    }

    const newOutput = props.output;
    if (outputEditor && outputEditor.getValue() !== newOutput) {
      outputEditor.setValue(newOutput);
    }

    // GSC structural lint — runs after output model is updated
    const outputModel = outputEditor?.getModel();
    if (!outputModel || !newOutput) {
      if (outputModel) monaco.editor.setModelMarkers(outputModel, "gsc-lint", []);
      return;
    }
    const gscDiags = lintGsc(newOutput);
    const gscMarkers: monaco.editor.IMarkerData[] = gscDiags.map(d => ({
      severity: d.severity === "error"
        ? monaco.MarkerSeverity.Error
        : d.severity === "warning"
          ? monaco.MarkerSeverity.Warning
          : monaco.MarkerSeverity.Info,
      message: d.message,
      startLineNumber: d.gscLine,
      startColumn: 1,
      endLineNumber: d.gscLine,
      endColumn: outputModel.getLineMaxColumn(d.gscLine),
    }));
    monaco.editor.setModelMarkers(outputModel, "gsc-lint", gscMarkers);
  });

  // Listen for navigation events from App (cross-file go-to)
  function handleNavigate(e: Event) {
    const { line, col } = (e as CustomEvent).detail;
    if (inputEditor) {
      inputEditor.revealLineInCenter(line);
      inputEditor.setPosition({ lineNumber: line, column: col });
      inputEditor.focus();
    }
  }
  window.addEventListener("pygsc-navigate", handleNavigate);

  onCleanup(() => {
    window.removeEventListener("pygsc-navigate", handleNavigate);
    inputEditor?.dispose();
    outputEditor?.dispose();
  });

  function getBreadcrumbs(): string[] {
    const tab = props.tabs.find((t) => t.path === props.activeTabPath);
    if (!tab) return [];
    const filePath = tab.path.replace(/\\/g, "/");
    const projectRoot = props.projectPath?.replace(/\\/g, "/");
    let relativePath: string;
    if (projectRoot && filePath.startsWith(projectRoot)) {
      relativePath = filePath.substring(projectRoot.length + 1);
    } else {
      relativePath = tab.name;
    }
    return relativePath.split("/");
  }

  return (
    <div class="editor-area">
      {/* Tab Bar */}
      <div class="tab-bar">
        <div class="tab-list">
          <For each={props.tabs}>
            {(tab) => (
              <div
                class={`tab ${props.activeTabPath === tab.path ? "tab-active" : ""}`}
                onClick={() => props.onSwitchTab(tab.path)}
                title={tab.path}
              >
                <Show when={tab.unsaved}>
                  <span class="tab-dot" />
                </Show>
                <span class="tab-name">{tabDisplayName(tab)}</span>
                <button
                  class="tab-close"
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onCloseTab(tab.path);
                  }}
                  title="Close"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            )}
          </For>
        </div>
      </div>

      {/* Breadcrumbs */}
      <Show when={props.activeTabPath && !isApiRefTab()}>
        <div class="breadcrumbs">
          <For each={getBreadcrumbs()}>
            {(crumb, i) => (
              <>
                <Show when={i() > 0}>
                  <span class="breadcrumb-sep">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
                  </span>
                </Show>
                <span class={`breadcrumb-item ${i() === getBreadcrumbs().length - 1 ? "breadcrumb-active" : ""}`}>{crumb}</span>
              </>
            )}
          </For>
        </div>
      </Show>

      {/* Welcome Screen */}
      <Show when={!props.activeTabPath}>
        <div class="welcome">
          <div class="welcome-content">
            <div class="welcome-logo">
              <div class="welcome-logo-icon">PY</div>
              <h1 class="welcome-title">PyGSC</h1>
              <p class="welcome-subtitle">Pseudo-Python to GSC Transpiler for BO3 Zombies</p>
            </div>

            <div class="welcome-sections">
              <div class="welcome-section">
                <h2 class="welcome-section-title">Get Started</h2>
                <div class="welcome-links">
                  <div class="welcome-link">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                    <span>Open a project folder from the sidebar to begin</span>
                  </div>
                  <div class="welcome-link">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    <span>Create <code>.pygsc</code> files and see live GSC output</span>
                  </div>
                  <div class="welcome-link">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                    <span>Browse 3000+ BO3 engine functions in the API panel</span>
                  </div>
                </div>
              </div>

              <div class="welcome-section">
                <h2 class="welcome-section-title">Quick Reference</h2>
                <div class="welcome-shortcuts">
                  <div class="welcome-shortcut">
                    <kbd>Ctrl+S</kbd>
                    <span>Save file</span>
                  </div>
                  <div class="welcome-shortcut">
                    <kbd>Ctrl+Click</kbd>
                    <span>Go to definition</span>
                  </div>
                  <div class="welcome-shortcut">
                    <kbd>Ctrl+Space</kbd>
                    <span>Autocomplete</span>
                  </div>
                </div>
              </div>

              <div class="welcome-section">
                <h2 class="welcome-section-title">PyGSC Syntax</h2>
                <pre class="welcome-code"><code>{`def on_player_spawn(player):
    player endon "disconnect"

    every 0.05:
        if player is_on_ground():
            player set_move_speed(1.2)

    on player "weapon_fired", weapon:
        chance 30:
            player give_ammo(weapon, 10)`}</code></pre>
              </div>
            </div>
          </div>
        </div>
      </Show>

      {/* API Reference Page */}
      <Show when={isApiRefTab()}>
        <ApiReferencePage initialSearch={props.code} />
      </Show>

      {/* Editor Panels — always rendered so Monaco refs stay alive */}
      <div
        class="editor-container"
        ref={containerRef}
        style={{ display: props.activeTabPath && !isApiRefTab() ? "flex" : "none" }}
      >
        <div class="editor-panel" style={{ width: props.pygscEnabled ? `${splitPercent()}%` : "100%" }}>
          <div class="panel-header">
            <span class={`dot ${props.pygscEnabled ? "dot-input" : "dot-output"}`} />
            {props.pygscEnabled ? "PyGSC" : gscFileName()}
          </div>
          <div class="monaco-wrapper" ref={inputContainerRef} />
        </div>
        <div class="resize-handle" onMouseDown={onMouseDown} style={{ display: props.pygscEnabled ? undefined : "none" }} />
        <div class="editor-panel" style={{ width: `${100 - splitPercent()}%`, display: props.pygscEnabled ? undefined : "none" }}>
          <div class="panel-header">
            <span class="dot dot-output" />
            {gscFileName()}
          </div>
          <div class="monaco-wrapper" ref={outputContainerRef} />
        </div>
      </div>

      {/* Usages popup */}
      <Show when={usagesList()}>
        {(list) => (
          <>
            <div class="usages-backdrop" onClick={() => setUsagesList(null)} />
            <div
              class="usages-popup"
              style={{ top: `${list().top}px`, left: `${list().left}px` }}
            >
              <div class="usages-header">{list().items.length} usages</div>
              <For each={list().items}>
                {(item) => (
                  <div
                    class="usages-item"
                    onClick={() => {
                      setUsagesList(null);
                      props.onNavigateToFile(item.filePath, item.line, item.col);
                    }}
                  >
                    <span class="usages-file">{item.label}</span>
                    <span class="usages-line">:{item.line}</span>
                    <span class="usages-preview">{item.preview}</span>
                  </div>
                )}
              </For>
            </div>
          </>
        )}
      </Show>
    </div>
  );
}

export default Editor;
