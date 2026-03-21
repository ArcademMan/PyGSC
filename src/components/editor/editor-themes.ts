import type * as monaco from "monaco-editor";

export function getPygscTheme(): monaco.editor.IStandaloneThemeData {
  return {
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
  };
}

export function getGscTheme(): monaco.editor.IStandaloneThemeData {
  return {
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
  };
}
