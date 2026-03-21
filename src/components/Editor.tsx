import { onMount, onCleanup, createEffect, createSignal, Show, For } from "solid-js";
import * as monaco from "monaco-editor";
import type { OpenTab } from "../App";
import { getApiData, getBo3Api, lint, lintGsc } from "../lib/transpiler";
import {
  parseFile,
  setActiveFile,
  findReferencesTo,
  resolveDefinitionAtPosition,
  getActiveFileUri,
  referenceProvider,
  documentSymbolProvider,
  signatureHelpProvider,
  codeLensProvider,
} from "../lib/language-service";
import type { FunctionSymbol, SymbolReference } from "../lib/language-service";
import ApiReferencePage from "./ApiReferencePage";

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

// Persist disposables on window so they survive HMR module re-execution
const _win = window as unknown as { __pygscDisposables?: monaco.IDisposable[]; __pygscLangRegistered?: boolean };
if (!_win.__pygscDisposables) _win.__pygscDisposables = [];

function registerLanguages() {
  // Dispose previous registrations (handles HMR re-execution)
  for (const d of _win.__pygscDisposables!) d.dispose();
  _win.__pygscDisposables!.length = 0;

  // Only register the language id once (cannot be undone)
  if (!_win.__pygscLangRegistered) {
    _win.__pygscLangRegistered = true;
    monaco.languages.register({ id: "pygsc" });
  }

  // Build BO3 API names list for the tokenizer
  const bo3Names = Object.keys(getBo3Api());

  _win.__pygscDisposables!.push(
    monaco.languages.setMonarchTokensProvider("pygsc", {
      bo3Api: bo3Names,
      tokenizer: {
        root: [
          [/\/\*/, { token: "comment", next: "@blockComment" }],
          [/#.*$/, "comment"],
          [/"[^"]*"/, "string"],
          [/'[^']*'/, "string"],
          [/\b\d+\.\d+\b/, "number.float"],
          [/\b\d+\b/, "number"],
          [/\b(self|level|game)\b/, "variable.language"],
          [/\b(true|false|none|None|undefined)\b/, "constant.language"],
          [/@(endon|system)\b/, "decorator"],
          [/\b(every|on|once|repeat|chance)\b(?=\s+.*:)/, "keyword.sugar"],
          [/\b(def|autoexec)\b/, { token: "keyword", next: "@funcName" }],
          [/\b(if|elif|elseif|else|for|foreach|while|do|in|return|continue|break|pass|function|import|include|fname|not)\b/, "keyword"],
          [/\b(thread|thr|waittill|waitill|endon|notify|end|isdefined|wait)\b/, "keyword.gsc"],
          [/#precache\b/, "keyword.gsc"],
          [/\bprecache\b/, "keyword.gsc"],
          [/\busing_animtree\b/, "keyword.gsc"],
          [/\b(givepoints|takepoints|getstructs|getstruct|giveweapon|spawnmodel|print|jplayfx|jfloatme|jspinme|maketrigger|randomize|burn|jteleporthere|wait_blackscreen|wait_any|zombie_death_cb|actor_damage_cb|on_spawned_cb|player_damage_cb|on_connect_cb|removepowerups|flaginit|flagset|flagwait|flagclear|getent|getents|playsound|loopsound|stopsound|randint|randfloat)\b/, "pygsc.api"],
          [/\$\w+/, "pygsc.api"],
          [/&\w+/, "function.reference"],
          [/\w+::/, "namespace"],
          [/[a-zA-Z_]\w*/, { cases: { "@bo3Api": "bo3.api", "@default": { token: "@rematch", next: "@identOrFunc" } } }],
          [/\(/, { token: "delimiter.bracket", next: "@parens" }],
          [/[{})\[\]]/, "delimiter.bracket"],
          [/[;,.]/, "delimiter"],
          [/[=!<>]=?/, "operator"],
          [/[+\-*/%]/, "operator"],
          [/&&|\|\|/, "operator"],
        ],
        parens: [
          [/\)/, { token: "delimiter.bracket", next: "@pop" }],
          [/#.*$/, "comment"],
          [/"[^"]*"/, "string"],
          [/'[^']*'/, "string"],
          [/\b\d+\.\d+\b/, "number.float"],
          [/\b\d+\b/, "number"],
          [/\b(self|level|game)\b/, "variable.language"],
          [/\b(true|false|none|None|undefined)\b/, "constant.language"],
          [/\b(if|elif|else|in|return|not)\b/, "keyword"],
          [/\b(thread|thr|waittill|waitill|endon|notify|end|isdefined|wait)\b/, "keyword.gsc"],
          [/&\w+/, "function.reference"],
          [/\$\w+/, "pygsc.api"],
          [/\(/, { token: "delimiter.bracket", next: "@parens" }],
          [/[a-zA-Z_]\w*/, "variable.parameter"],
          [/[,.]/, "delimiter"],
          [/[=!<>]=?/, "operator"],
          [/[+\-*/%]/, "operator"],
          [/&&|\|\|/, "operator"],
        ],
        blockComment: [
          [/\*\//, { token: "comment", next: "@pop" }],
          [/./, "comment"],
        ],
        identOrFunc: [
          [/[a-zA-Z_]\w*(?=\s*\()/, { token: "function.call", next: "@pop" }],
          [/[a-zA-Z_]\w*/, { token: "identifier", next: "@pop" }],
        ],
        funcName: [
          [/[a-zA-Z_]\w*/, { token: "function.declaration", next: "@pop" }],
          [/\s+/, ""],
          [/./, { token: "", next: "@pop" }],
        ],
      },
    })
  );

  monaco.languages.setLanguageConfiguration("pygsc", {
    comments: { lineComment: "#" },
    brackets: [["(", ")"], ["[", "]"]],
    autoClosingPairs: [
      { open: "(", close: ")" },
      { open: "[", close: "]" },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
    ],
    indentationRules: {
      increaseIndentPattern: /^.*:\s*(#.*)?$/,
      decreaseIndentPattern: /^\s*(elif|elseif|else)\b.*$/,
    },
    onEnterRules: [
      {
        beforeText: /^.*:\s*(#.*)?$/,
        action: { indentAction: monaco.languages.IndentAction.Indent },
      },
    ],
  });

  // ── Theme definition (global for both editors) ──
  monaco.editor.defineTheme("pygsc-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "", foreground: "D4D4D4" },
      { token: "comment", foreground: "6A9955", fontStyle: "italic" },
      { token: "string", foreground: "CE9178" },
      { token: "number", foreground: "B5CEA8" },
      { token: "number.float", foreground: "B5CEA8" },
      { token: "keyword", foreground: "569CD6" },
      { token: "keyword.gsc", foreground: "569CD6" },
      { token: "keyword.sugar", foreground: "C586C0" },
      { token: "keyword.using", foreground: "C586C0" },
      { token: "decorator", foreground: "C586C0" },
      { token: "variable.language", foreground: "569CD6" },
      { token: "constant.language", foreground: "569CD6" },
      { token: "pygsc.api", foreground: "C586C0" },
      { token: "function.declaration", foreground: "DCDCAA" },
      { token: "function.call", foreground: "DCDCAA" },
      { token: "function.reference", foreground: "DCDCAA" },
      { token: "bo3.api", foreground: "4EC9B0" },
      { token: "namespace", foreground: "4EC9B0" },
      { token: "variable.parameter", foreground: "9CDCFE" },
      { token: "identifier", foreground: "D4D4D4" },
      { token: "delimiter.bracket", foreground: "D4D4D4" },
      { token: "delimiter", foreground: "D4D4D4" },
      { token: "operator", foreground: "D4D4D4" },
    ],
    colors: {
      "editor.background": "#1e1e1e",
      "editor.foreground": "#c7d5e0",
      "editorLineNumber.foreground": "#8f98a0",
      "editor.selectionBackground": "#334d6e",
      "editor.lineHighlightBackground": "#2a475e40",
      "editorCursor.foreground": "#66c0f4",
    },
  });

  if (!(_win as unknown as { __gscLangRegistered?: boolean }).__gscLangRegistered) {
    (_win as unknown as { __gscLangRegistered?: boolean }).__gscLangRegistered = true;
    monaco.languages.register({ id: "gsc" });
  }

  monaco.languages.setMonarchTokensProvider("gsc", {
    bo3Api: bo3Names,
    tokenizer: {
      root: [
        [/\/\*/, { token: "comment", next: "@blockComment" }],
        [/\/\/.*$/, "comment"],
        [/#using\b.*$/, "keyword.using"],
        [/#precache\b.*$/, "keyword.using"],
        [/#define\b/, "keyword.using"],
        [/#namespace\b/, "keyword.using"],
        [/#using_animtree\b.*$/, "keyword.using"],
        [/REGISTER_SYSTEM_EX\b/, "keyword.using"],
        [/"[^"]*"/, "string"],
        [/'[^']*'/, "string"],
        [/\b\d+\.\d+\b/, "number.float"],
        [/\b\d+\b/, "number"],
        [/\b(self|level|game)\b/, "variable.language"],
        [/\b(true|false|undefined)\b/, "constant.language"],
        [/\b(function|autoexec)\b/, { token: "keyword", next: "@funcName" }],
        [/\b(if|else|for|foreach|while|do|return|continue|break|wait|switch|case|default)\b/, "keyword"],
        [/\b(thread|waittill|endon|notify|isdefined)\b/, "keyword.gsc"],
        [/&\w+/, "function.reference"],
        [/\w+::/, "namespace"],
        [/[a-zA-Z_]\w*/, { cases: { "@bo3Api": "bo3.api", "@default": { token: "@rematch", next: "@identOrFunc" } } }],
        [/\(/, { token: "delimiter.bracket", next: "@parens" }],
        [/[{})\[\]]/, "delimiter.bracket"],
        [/[;,.]/, "delimiter"],
        [/[=!<>]=?/, "operator"],
        [/[+\-*/%]/, "operator"],
        [/&&|\|\|/, "operator"],
      ],
      blockComment: [
        [/\*\//, { token: "comment", next: "@pop" }],
        [/./, "comment"],
      ],
      parens: [
        [/\)/, { token: "delimiter.bracket", next: "@pop" }],
        [/\/\/.*$/, "comment"],
        [/"[^"]*"/, "string"],
        [/'[^']*'/, "string"],
        [/\b\d+\.\d+\b/, "number.float"],
        [/\b\d+\b/, "number"],
        [/\b(self|level|game)\b/, "variable.language"],
        [/\b(true|false|undefined)\b/, "constant.language"],
        [/\b(thread|waittill|endon|notify|isdefined)\b/, "keyword.gsc"],
        [/&\w+/, "function.reference"],
        [/\(/, { token: "delimiter.bracket", next: "@parens" }],
        [/[a-zA-Z_]\w*/, "variable.parameter"],
        [/[,.]/, "delimiter"],
        [/[=!<>]=?/, "operator"],
        [/[+\-*/%]/, "operator"],
        [/&&|\|\|/, "operator"],
      ],
      identOrFunc: [
        [/[a-zA-Z_]\w*(?=\s*\()/, { token: "function.call", next: "@pop" }],
        [/[a-zA-Z_]\w*/, { token: "identifier", next: "@pop" }],
      ],
      funcName: [
        [/[a-zA-Z_]\w*/, { token: "function.declaration", next: "@pop" }],
        [/\s+/, ""],
        [/./, { token: "", next: "@pop" }],
      ],
    },
  });

  monaco.languages.setLanguageConfiguration("gsc", {
    comments: { lineComment: "//" },
    brackets: [["{", "}"], ["(", ")"], ["[", "]"]],
  });

  monaco.editor.defineTheme("gsc-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "6A9955", fontStyle: "italic" },
      { token: "string", foreground: "CE9178" },
      { token: "number", foreground: "B5CEA8" },
      { token: "number.float", foreground: "B5CEA8" },
      { token: "keyword", foreground: "569CD6" },
      { token: "keyword.gsc", foreground: "569CD6" },
      { token: "keyword.using", foreground: "C586C0" },
      { token: "variable.language", foreground: "569CD6" },
      { token: "constant.language", foreground: "569CD6" },
      { token: "function.reference", foreground: "FFD700" },
      { token: "namespace", foreground: "4EC9B0" },
      { token: "identifier", foreground: "D4D4D4" },
    ],
    colors: {
      "editor.background": "#162029",
      "editor.foreground": "#c7d5e0",
      "editorLineNumber.foreground": "#8f98a0",
      "editor.selectionBackground": "#334d6e",
      "editor.lineHighlightBackground": "#2a475e40",
      "editorCursor.foreground": "#5ba32b",
    },
  });

  // ── Autocomplete Provider ──
  _win.__pygscDisposables!.push(monaco.languages.registerCompletionItemProvider("pygsc", {
    triggerCharacters: ["."],
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      const suggestions: monaco.languages.CompletionItem[] = [];
      const seen = new Set<string>();

      // PyGSC keywords (with Pythonic snippets for block-opening keywords)
      const blockKeywords = [
        { label: "def", insertText: "def ${1:name}(${2:params}):", detail: "Function definition" },
        { label: "autoexec", insertText: "autoexec ${1:name}(${2:params}):", detail: "Autoexec function" },
        { label: "if", insertText: "if ${1:condition}:", detail: "If statement" },
        { label: "elif", insertText: "elif ${1:condition}:", detail: "Else-if statement" },
        { label: "elseif", insertText: "elseif ${1:condition}:", detail: "Else-if statement" },
        { label: "else", insertText: "else:", detail: "Else statement" },
        { label: "for", insertText: "for ${1:var} in ${2:array}:", detail: "For loop" },
        { label: "foreach", insertText: "foreach ${1:var} in ${2:array}:", detail: "Foreach loop" },
        { label: "while", insertText: "while ${1:condition}:", detail: "While loop" },
        { label: "do", insertText: "do:", detail: "Do block" },
      ];
      for (const bk of blockKeywords) {
        if (seen.has(bk.label)) continue;
        seen.add(bk.label);
        suggestions.push({
          label: bk.label,
          kind: monaco.languages.CompletionItemKind.Keyword,
          insertText: bk.insertText,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range,
          detail: bk.detail,
        });
      }

      const simpleKeywords = ["in", "return", "continue", "break", "pass"];
      for (const kw of simpleKeywords) {
        if (seen.has(kw)) continue;
        seen.add(kw);
        suggestions.push({
          label: kw,
          kind: monaco.languages.CompletionItemKind.Keyword,
          insertText: kw,
          range,
          detail: "PyGSC keyword",
        });
      }

      // GSC keywords
      const gscKw = [
        "thread", "thr", "waittill", "endon", "notify", "wait",
        "isdefined", "precache", "using_animtree", "self", "level", "game",
        "true", "false", "none",
      ];
      for (const kw of gscKw) {
        if (seen.has(kw)) continue;
        seen.add(kw);
        suggestions.push({
          label: kw,
          kind: monaco.languages.CompletionItemKind.Keyword,
          insertText: kw,
          range,
          detail: "GSC keyword",
        });
      }

      // Syntax Sugar keywords (with snippets)
      const sugarSnippets = [
        { label: "every", detail: "Polling loop → while true + wait", insertText: "every ${1:0.05}:\n\t${0}" },
        { label: "on", detail: "Waittill loop → while true + waittill", insertText: "on ${1:self} \"${2:event}\", ${3:var}:\n\t${0}" },
        { label: "once", detail: "Single waittill → waittill + body", insertText: "once ${1:self} \"${2:event}\":\n\t${0}" },
        { label: "repeat", detail: "Count loop → for i = 0; i < N; i++", insertText: "repeat ${1:5}:\n\t${0}" },
        { label: "chance", detail: "Random check → if RandomInt(100) < N", insertText: "chance ${1:30}:\n\t${0}" },
        { label: "@endon", detail: "Decorator → self endon at function start", insertText: "@endon \"${1:disconnect}\"\n" },
        { label: "@system", detail: "System registration → REGISTER_SYSTEM_EX", insertText: "@system \"${1:system_name}\"\n" },
      ];
      for (const s of sugarSnippets) {
        if (seen.has(s.label)) continue;
        seen.add(s.label);
        suggestions.push({
          label: s.label,
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: s.insertText,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range,
          detail: s.detail,
          documentation: { value: `**${s.label}** — PyGSC syntax sugar\n\n${s.detail}` },
        });
      }

      // Operators
      const ops = [
        { label: "or", detail: "→ ||" },
        { label: "and", detail: "→ &&" },
        { label: "not", detail: "→ !" },
      ];
      for (const op of ops) {
        if (seen.has(op.label)) continue;
        seen.add(op.label);
        suggestions.push({
          label: op.label,
          kind: monaco.languages.CompletionItemKind.Operator,
          insertText: op.label,
          range,
          detail: op.detail,
        });
      }

      // PyGSC API shortcuts
      const apiData = getApiData();
      for (const [category, entries] of Object.entries(apiData)) {
        for (const [key, val] of Object.entries(entries)) {
          // Skip already-added entries
          if (seen.has(key.trim())) continue;
          if (["#"].includes(key.trim())) continue;
          seen.add(key.trim());

          let insertText = key;
          let detail = `→ ${val.translation}`;

          // For function-like APIs, add snippet with parentheses
          if (val.fullAPI && val.fullAPI.includes("(")) {
            const match = val.fullAPI.match(/\(([^)]*)\)/);
            if (match) {
              const params = match[1];
              if (params) {
                // Create snippet with tab stops
                const parts = params.split(",").map((p, i) => `\${${i + 1}:${p.trim()}}`);
                insertText = key + "(" + parts.join(", ") + ")";
              } else {
                insertText = key + "()";
              }
            }
          }

          suggestions.push({
            label: key,
            kind: monaco.languages.CompletionItemKind.Function,
            insertText,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            range,
            detail,
            documentation: {
              value: [
                val.summary || "",
                val.example ? `\n**Example:** \`${val.example}\`` : "",
                `\n**Category:** ${category}`,
              ].filter(Boolean).join("\n"),
            },
          });
        }
      }

      // BO3 Engine functions
      const bo3Data = getBo3Api();
      for (const [name, details] of Object.entries(bo3Data)) {
        if (seen.has(name)) continue;
        seen.add(name);
        let insertText = name;
        if (details.fullAPI && details.fullAPI.includes("(")) {
          const match = details.fullAPI.match(/\(([^)]*)\)/);
          if (match) {
            const params = match[1];
            if (params) {
              const parts = params.split(",").map((p, i) => `\${${i + 1}:${p.trim()}}`);
              insertText = name + "(" + parts.join(", ") + ")";
            } else {
              insertText = name + "()";
            }
          }
        }

        suggestions.push({
          label: name,
          kind: monaco.languages.CompletionItemKind.Method,
          insertText,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range,
          detail: details.side ? `BO3 ${details.side}` : "BO3 Engine",
          documentation: {
            value: [
              details.summary || "",
              details.callOn ? `\n**Call on:** ${details.callOn}` : "",
              details.example ? `\n**Example:** \`${details.example}\`` : "",
              details.fullAPI ? `\n**Signature:** \`${details.fullAPI}\`` : "",
            ].filter(Boolean).join("\n"),
          },
        });
      }

      return { suggestions };
    },
  }));

  // ── Hover Provider ──
  _win.__pygscDisposables!.push(monaco.languages.registerHoverProvider("pygsc", {
    provideHover(model, position) {
      const word = model.getWordAtPosition(position);
      if (!word) return null;
      const token = word.word;

      // Check Syntax Sugar keywords
      const sugarDocs: Record<string, string> = {
        every: "**every** `<interval>`**:**\n\nPolling loop. Expands to:\n```\nwhile true\n    wait <interval>\n    ...\n```",
        on: "**on** `[entity]` `\"event\"`, `vars`**:**\n\nWaittill loop. Expands to:\n```\nwhile true\n    entity waittill \"event\", vars\n    ...\n```",
        once: "**once** `[entity]` `\"event\"`**:**\n\nSingle waittill. Expands to:\n```\nentity waittill \"event\"\n...\n```",
        repeat: "**repeat** `<N>`**:**\n\nCount loop. Expands to:\n```\nfor i = 0; i < N; i++\n    ...\n```",
        chance: "**chance** `<N>`**:**\n\nRandom check (0-100). Expands to:\n```\nif RandomInt(100) < N\n    ...\n```",
      };
      if (sugarDocs[token]) {
        return {
          range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
          contents: [{ value: sugarDocs[token] }],
        };
      }

      // Check decorators (@endon, @system) - look at the full line text
      const lineText = model.getLineContent(position.lineNumber).trim();
      if (lineText.startsWith("@endon")) {
        return {
          range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
          contents: [{ value: "**@endon** `\"event1\"`, `\"event2\"`\n\nDecorator: inserts `self endon \"event\"` lines at the start of the next function body." }],
        };
      }
      if (lineText.startsWith("@system")) {
        return {
          range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
          contents: [{ value: "**@system** `\"name\"`\n\nDecorator: inserts `REGISTER_SYSTEM_EX( \"name\", &__init__, &__main__, none )` before the script." }],
        };
      }

      // Check PyGSC API
      const apiData = getApiData();
      for (const [category, entries] of Object.entries(apiData)) {
        for (const [key, val] of Object.entries(entries)) {
          if (key.trim().toLowerCase() === token.toLowerCase()) {
            const lines = [
              `**${key}** → \`${val.translation}\``,
              "",
              val.summary || "",
              val.fullAPI ? `\n**Syntax:** \`${val.fullAPI}\`` : "",
              val.example ? `\n**Example:** \`${val.example}\`` : "",
              `\n*Category: ${category}*`,
            ];
            // Add mandatory/optional params
            for (const [k, v] of Object.entries(val)) {
              if (k.startsWith("mandatory") && v) lines.push(`\n- 🔴 ${v}`);
              if (k.startsWith("optional") && v) lines.push(`\n- 🔵 ${v}`);
            }
            return {
              range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
              contents: [{ value: lines.filter(Boolean).join("\n") }],
            };
          }
        }
      }

      // Check BO3 API
      const bo3Data = getBo3Api();
      if (bo3Data[token]) {
        const fn = bo3Data[token];
        const lines = [
          `**${token}** — BO3 Engine${fn.side ? ` (${fn.side})` : ""}`,
          "",
          fn.summary || "",
          fn.fullAPI ? `\n**Signature:** \`${fn.fullAPI}\`` : "",
          fn.callOn ? `\n**Call on:** ${fn.callOn}` : "",
          fn.example ? `\n**Example:** \`${fn.example}\`` : "",
        ];
        return {
          range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
          contents: [{ value: lines.filter(Boolean).join("\n") }],
        };
      }

      return null;
    },
  }));

  // Go to Definition is handled by onMouseDown in the Editor component (not a Monaco provider)

  // ── Find References (Shift+F12) ──
  _win.__pygscDisposables!.push(monaco.languages.registerReferenceProvider("pygsc", referenceProvider));

  // ── Document Symbols (Ctrl+Shift+O) ──
  _win.__pygscDisposables!.push(monaco.languages.registerDocumentSymbolProvider("pygsc", documentSymbolProvider));

  // ── Signature Help (parameter hints) ──
  _win.__pygscDisposables!.push(monaco.languages.registerSignatureHelpProvider("pygsc", signatureHelpProvider));

  // ── CodeLens (N usages above functions) ──
  _win.__pygscDisposables!.push(monaco.languages.registerCodeLensProvider("pygsc", codeLensProvider));
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
      if (!outputEditor) return;
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

  createEffect(() => {
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

      {/* Empty state overlay */}
      <Show when={!props.activeTabPath}>
        <div class="editor-empty">
          <p>Open a file to start editing</p>
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
        <div class="editor-panel" style={{ width: `${splitPercent()}%` }}>
          <div class="panel-header">
            <span class="dot dot-input" />
            PyGSC
          </div>
          <div class="monaco-wrapper" ref={inputContainerRef} />
        </div>
        <div class="resize-handle" onMouseDown={onMouseDown} />
        <div class="editor-panel" style={{ width: `${100 - splitPercent()}%` }}>
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
