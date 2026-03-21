import * as monaco from "monaco-editor";
import { getApiData, getBo3Api } from "./transpiler";

// ══════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════

export interface FunctionSymbol {
  name: string;
  params: string[];
  line: number;       // 1-based
  col: number;        // 1-based (column where the name starts)
  endCol: number;     // 1-based
  uri: string;        // language-service file URI
  kind: "def" | "autoexec";
}

export interface SymbolReference {
  name: string;
  namespace: string | null;   // null = same-file call, "villa" = villa::name()
  line: number;       // 1-based
  col: number;        // 1-based
  endCol: number;
  uri: string;        // file where the reference appears
}

interface FileInfo {
  uri: string;
  namespace: string | null;   // from #namespace directive
  fileName: string;           // filename without extension (fallback namespace)
  functions: FunctionSymbol[];
  references: SymbolReference[];
}

// ══════════════════════════════════════════════
// LANGUAGE SERVICE (singleton)
// ══════════════════════════════════════════════

const fileIndex = new Map<string, FileInfo>();

/** Build a set of all PyGSC API shortcut names so we skip them as references */
let _apiNames: Set<string> | null = null;
function getApiNames(): Set<string> {
  if (_apiNames) return _apiNames;
  _apiNames = new Set<string>();
  const api = getApiData();
  for (const entries of Object.values(api)) {
    for (const key of Object.keys(entries)) {
      _apiNames.add(key.trim());
    }
  }
  return _apiNames;
}

/** Invalidate cached API names (call after merging custom API entries) */
export function invalidateApiNames() {
  _apiNames = null;
}

// ── Parsing ─────────────────────────────────

// PyGSC: def name(params):  or  autoexec name(params):
const DEF_RE = /^(\s*)(def|autoexec)\s+([a-zA-Z_]\w*)\s*\(([^)]*)\)\s*:/;
// GSC:  function name(params)  or  function autoexec name(params)
const GSC_FUNC_RE = /^(\s*)function\s+(?:autoexec\s+)?([a-zA-Z_]\w*)\s*\(([^)]*)\)/;
// #namespace name (GSC) or fname name (PyGSC)
const NAMESPACE_RE = /^(?:#namespace|fname)\s+([a-zA-Z_]\w*)/;

// Reference patterns
const BARE_CALL_RE = /\b([a-zA-Z_]\w*)\s*\(/g;              // foo(
const THREAD_CALL_RE = /\b(?:thread|thr)\s+([a-zA-Z_]\w*)\s*\(/g;  // thread foo(
const FUNC_REF_RE = /&([a-zA-Z_]\w*)/g;                      // &foo
const NS_CALL_RE = /\b([a-zA-Z_]\w*)::([a-zA-Z_]\w*)/g;     // ns::foo (captures both)

/** Reserved words that should NOT be treated as user function calls */
const RESERVED = new Set([
  "if", "elif", "elseif", "while", "for", "foreach", "do",
  "return", "wait", "waittill", "waitill", "endon", "notify",
  "isdefined", "thread", "thr", "chance", "repeat", "every",
  "on", "once", "def", "autoexec", "function", "Array",
  "Int", "Float", "RandomInt", "RandomFloat", "RandomIntRange", "RandomFloatRange",
  "import", "include",
]);

/** Extract filename without extension from a file URI */
function fileNameFromUri(uri: string): string {
  const lastSlash = Math.max(uri.lastIndexOf("/"), uri.lastIndexOf("\\"));
  const name = uri.substring(lastSlash + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.substring(0, dot) : name;
}

export function parseFile(uri: string, code: string) {
  const lines = code.split("\n");
  const functions: FunctionSymbol[] = [];
  const references: SymbolReference[] = [];
  let namespace: string | null = null;
  const apiNames = getApiNames();

  // Detect #namespace
  for (const line of lines) {
    const nsMatch = line.match(NAMESPACE_RE);
    if (nsMatch) {
      namespace = nsMatch[1];
      break;
    }
  }

  // First pass: collect function definitions
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    const defMatch = line.match(DEF_RE);
    if (defMatch) {
      const name = defMatch[3];
      const params = defMatch[4].split(",").map((p) => p.trim()).filter(Boolean);
      const col = line.indexOf(name) + 1;
      functions.push({
        name, params, line: lineNum, col, endCol: col + name.length,
        uri, kind: defMatch[2] as "def" | "autoexec",
      });
      continue;
    }

    const gscMatch = line.match(GSC_FUNC_RE);
    if (gscMatch) {
      const name = gscMatch[2];
      const params = gscMatch[3].split(",").map((p) => p.trim()).filter(Boolean);
      const col = line.indexOf(name) + 1;
      functions.push({
        name, params, line: lineNum, col, endCol: col + name.length,
        uri, kind: line.includes("autoexec") ? "autoexec" : "def",
      });
    }
  }

  // Second pass: collect references
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Detect definition on this line to skip self-references
    const defMatch = line.match(DEF_RE);
    const gscDefMatch = !defMatch ? line.match(GSC_FUNC_RE) : null;
    const defName = defMatch ? defMatch[3] : gscDefMatch ? gscDefMatch[2] : null;

    // Strip comments
    const stripped = lineWithoutStrings(line);
    const commentIdx = stripped.indexOf("#");
    // Also handle // comments (GSC)
    const lineCommentIdx = stripped.indexOf("//");
    let cutoff = line.length;
    if (commentIdx >= 0) cutoff = Math.min(cutoff, commentIdx);
    if (lineCommentIdx >= 0) cutoff = Math.min(cutoff, lineCommentIdx);
    const effective = line.substring(0, cutoff);

    // ── Namespaced calls: ns::func() ──
    NS_CALL_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = NS_CALL_RE.exec(effective)) !== null) {
      const ns = m[1];
      const name = m[2];
      if (RESERVED.has(name)) continue;
      const col = m.index + m[0].indexOf(name) + 1;
      references.push({
        name, namespace: ns, line: lineNum, col, endCol: col + name.length, uri,
      });
    }

    // ── Bare calls: func(), thread func(), &func ──
    // These are same-file references (no namespace prefix)
    for (const re of [BARE_CALL_RE, THREAD_CALL_RE, FUNC_REF_RE]) {
      re.lastIndex = 0;
      while ((m = re.exec(effective)) !== null) {
        const name = m[1];
        if (RESERVED.has(name)) continue;
        if (name === defName) continue;
        if (apiNames.has(name)) continue;  // PyGSC API shortcut, not a user function

        // Check it wasn't already captured as ns::name
        const charBefore = m.index > 1 ? effective[m.index - 1] : "";
        const twoBefore = m.index > 1 ? effective.substring(Math.max(0, m.index - 2), m.index) : "";
        if (charBefore === ":" && twoBefore.endsWith("::")) continue; // already captured by NS_CALL_RE

        const col = m.index + m[0].indexOf(name) + 1;
        references.push({
          name, namespace: null, line: lineNum, col, endCol: col + name.length, uri,
        });
      }
    }
  }

  fileIndex.set(uri, {
    uri,
    namespace,
    fileName: fileNameFromUri(uri),
    functions,
    references,
  });
}

export function removeFile(uri: string) {
  fileIndex.delete(uri);
}

/** Debug: log the current state of the language service index */
export function debugIndex() {
  console.group("[LanguageService] Index");
  console.log("Files indexed:", fileIndex.size);
  for (const [, info] of fileIndex.entries()) {
    console.log(`  ${info.fileName} (ns: ${info.namespace ?? "none"}) — ${info.functions.length} funcs, ${info.references.length} refs`);
    for (const fn of info.functions) console.log(`    def ${fn.name}(${fn.params.join(", ")}) @ line ${fn.line}`);
    for (const ref of info.references) {
      const prefix = ref.namespace ? `${ref.namespace}::` : "";
      console.log(`    ref ${prefix}${ref.name} @ line ${ref.line}`);
    }
  }
  console.groupEnd();
}

/** Naive comment finder: replaces strings with spaces so we can find # */
function lineWithoutStrings(line: string): string {
  let result = "";
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    if (c === '"' || c === "'") {
      const q = c;
      result += " ";
      i++;
      while (i < line.length && line[i] !== q) {
        result += " ";
        if (line[i] === "\\" && i + 1 < line.length) { result += " "; i++; }
        i++;
      }
      if (i < line.length) { result += " "; i++; }
    } else {
      result += c;
      i++;
    }
  }
  return result;
}

// ── Namespace Resolution ────────────────────

/** Find the file URI that matches a given namespace (or filename) */
function resolveNamespace(ns: string): FileInfo | undefined {
  for (const info of fileIndex.values()) {
    if (info.namespace === ns) return info;
  }
  // Fallback: match by filename
  for (const info of fileIndex.values()) {
    if (info.fileName === ns) return info;
  }
  return undefined;
}

/** Get the namespace identifiers (namespace + filename) for a file */
function getFileNamespaces(info: FileInfo): string[] {
  const names: string[] = [];
  if (info.namespace) names.push(info.namespace);
  if (info.fileName && info.fileName !== info.namespace) names.push(info.fileName);
  return names;
}

// ── Queries ─────────────────────────────────

/**
 * Find the definition of a function, respecting namespace scoping.
 * - If namespace is provided, look in the file with that namespace
 * - If namespace is null, look in the specified file (same-file call)
 */
export function findDefinition(name: string, namespace: string | null = null, callerUri: string | null = null): FunctionSymbol | undefined {
  if (namespace) {
    // Namespaced call: look in the target file
    const target = resolveNamespace(namespace);
    if (target) {
      return target.functions.find((f) => f.name === name);
    }
    return undefined;
  }

  // Bare call: look in caller's own file first
  if (callerUri) {
    const info = fileIndex.get(callerUri);
    if (info) {
      const found = info.functions.find((f) => f.name === name);
      if (found) return found;
    }
  }

  // Fallback: search all files (for Go to Definition when we don't know the context)
  for (const info of fileIndex.values()) {
    const found = info.functions.find((f) => f.name === name);
    if (found) return found;
  }
  return undefined;
}

/**
 * Find all references to a function defined in a specific file.
 * Considers:
 * - Bare calls in the same file
 * - ns::name() calls from other files where ns matches the target file's namespace/filename
 */
export function findReferencesTo(fn: FunctionSymbol): SymbolReference[] {
  const targetInfo = fileIndex.get(fn.uri);
  if (!targetInfo) return [];
  const targetNamespaces = getFileNamespaces(targetInfo);
  const results: SymbolReference[] = [];

  for (const info of fileIndex.values()) {
    for (const ref of info.references) {
      if (ref.name !== fn.name) continue;

      if (ref.namespace === null) {
        // Bare call → only counts if it's in the same file as the definition
        if (ref.uri === fn.uri) {
          results.push(ref);
        }
      } else {
        // Namespaced call → counts if the namespace matches the target file
        if (targetNamespaces.includes(ref.namespace)) {
          results.push(ref);
        }
      }
    }
  }

  return results;
}

export function getAllFunctions(uri?: string): FunctionSymbol[] {
  if (uri) {
    const info = fileIndex.get(uri);
    return info ? info.functions : [];
  }
  const all: FunctionSymbol[] = [];
  for (const info of fileIndex.values()) {
    all.push(...info.functions);
  }
  return all;
}

// ══════════════════════════════════════════════
// ACTIVE FILE TRACKING
// ══════════════════════════════════════════════

let _activeFileUri: string | null = null;
let _activeModelUri: monaco.Uri | null = null;

export function setActiveFile(fileUri: string, modelUri: monaco.Uri) {
  _activeFileUri = fileUri;
  _activeModelUri = modelUri;
}

export function getActiveFileUri(): string | null {
  return _activeFileUri;
}

/**
 * Resolve a Ctrl+Click on a word: find where the function under cursor is defined.
 * Returns the definition symbol, or null.
 */
export function resolveDefinitionAtPosition(
  lineText: string,
  wordText: string,
  wordStartCol: number,
): FunctionSymbol | undefined {
  const beforeWord = lineText.substring(0, wordStartCol - 1);
  const nsMatch = beforeWord.match(/([a-zA-Z_]\w*)::$/);
  const namespace = nsMatch ? nsMatch[1] : null;
  return findDefinition(wordText, namespace, _activeFileUri);
}

function resolveUri(lsUri: string): monaco.Uri {
  if (lsUri === _activeFileUri && _activeModelUri) {
    return _activeModelUri;
  }
  return monaco.Uri.parse(lsUri);
}

// ══════════════════════════════════════════════
// MONACO PROVIDERS
// ══════════════════════════════════════════════

/** Go to Definition — same-file only (cross-file is handled by Editor keybinding) */
export const definitionProvider: monaco.languages.DefinitionProvider = {
  provideDefinition(model, position) {
    const word = model.getWordAtPosition(position);
    if (!word) return null;

    const lineText = model.getLineContent(position.lineNumber);
    const def = resolveDefinitionAtPosition(lineText, word.word, word.startColumn);

    if (def && def.uri === _activeFileUri && _activeModelUri) {
      return {
        uri: _activeModelUri,
        range: new monaco.Range(def.line, def.col, def.line, def.endCol),
      };
    }

    // Cross-file or not found: return null (Editor handles cross-file via mousedown)
    return null;
  },
};

/** Find all references */
export const referenceProvider: monaco.languages.ReferenceProvider = {
  provideReferences(model, position, context) {
    const word = model.getWordAtPosition(position);
    if (!word) return [];
    const name = word.word;

    // Find the definition first (to know which file's function we're looking at)
    const lineText = model.getLineContent(position.lineNumber);
    const beforeWord = lineText.substring(0, word.startColumn - 1);
    const nsMatch = beforeWord.match(/([a-zA-Z_]\w*)::$/);
    const namespace = nsMatch ? nsMatch[1] : null;

    const def = findDefinition(name, namespace, _activeFileUri);
    if (!def) return [];

    const results: monaco.languages.Location[] = [];

    if (context.includeDeclaration) {
      results.push({
        uri: resolveUri(def.uri),
        range: new monaco.Range(def.line, def.col, def.line, def.endCol),
      });
    }

    for (const ref of findReferencesTo(def)) {
      results.push({
        uri: resolveUri(ref.uri),
        range: new monaco.Range(ref.line, ref.col, ref.line, ref.endCol),
      });
    }

    return results;
  },
};

/** Document symbols (Outline / Ctrl+Shift+O) */
export const documentSymbolProvider: monaco.languages.DocumentSymbolProvider = {
  provideDocumentSymbols(model) {
    const uri = _activeFileUri;
    const fns = uri ? getAllFunctions(uri) : [];

    return fns.map((f) => ({
      name: f.name,
      detail: `${f.kind} ${f.name}(${f.params.join(", ")})`,
      kind: monaco.languages.SymbolKind.Function,
      range: new monaco.Range(f.line, 1, f.line, model.getLineMaxColumn(f.line)),
      selectionRange: new monaco.Range(f.line, f.col, f.line, f.endCol),
      tags: [],
    }));
  },
};

/** Signature help (parameter hints when typing inside parentheses) */
export const signatureHelpProvider: monaco.languages.SignatureHelpProvider = {
  signatureHelpTriggerCharacters: ["(", ","],
  signatureHelpRetriggerCharacters: [","],

  provideSignatureHelp(model, position) {
    const textUntilPosition = model.getValueInRange({
      startLineNumber: position.lineNumber,
      startColumn: 1,
      endLineNumber: position.lineNumber,
      endColumn: position.column,
    });

    let depth = 0;
    let parenPos = -1;
    let commaCount = 0;
    for (let i = textUntilPosition.length - 1; i >= 0; i--) {
      const ch = textUntilPosition[i];
      if (ch === ")") depth++;
      else if (ch === "(") {
        if (depth === 0) { parenPos = i; break; }
        depth--;
      } else if (ch === "," && depth === 0) {
        commaCount++;
      }
    }
    if (parenPos < 0) return null;

    const before = textUntilPosition.substring(0, parenPos).trimEnd();

    // Check for ns::func pattern
    const nsCallMatch = before.match(/([a-zA-Z_]\w*)::([a-zA-Z_]\w*)$/);
    const bareMatch = before.match(/([a-zA-Z_]\w*)$/);
    const funcName = nsCallMatch ? nsCallMatch[2] : bareMatch ? bareMatch[1] : null;
    const ns = nsCallMatch ? nsCallMatch[1] : null;
    if (!funcName) return null;

    // Look up in user definitions
    const def = findDefinition(funcName, ns, _activeFileUri);
    if (def && def.params.length > 0) {
      return {
        value: {
          signatures: [{
            label: `${def.name}(${def.params.join(", ")})`,
            parameters: def.params.map((p) => ({ label: p })),
          }],
          activeSignature: 0,
          activeParameter: Math.min(commaCount, def.params.length - 1),
        },
        dispose() {},
      };
    }

    // Look up in BO3 API
    const bo3 = getBo3Api();
    const bo3Fn = bo3[funcName];
    if (bo3Fn?.fullAPI) {
      const paramMatch = bo3Fn.fullAPI.match(/\(([^)]*)\)/);
      if (paramMatch && paramMatch[1]) {
        const params = paramMatch[1].split(",").map((p: string) => p.trim());
        return {
          value: {
            signatures: [{
              label: bo3Fn.fullAPI,
              documentation: bo3Fn.summary || "",
              parameters: params.map((p: string) => ({ label: p })),
            }],
            activeSignature: 0,
            activeParameter: Math.min(commaCount, params.length - 1),
          },
          dispose() {},
        };
      }
    }

    // Look up in PyGSC API
    const api = getApiData();
    for (const entries of Object.values(api)) {
      const entry = entries[funcName];
      if (entry?.fullAPI) {
        const paramMatch = entry.fullAPI.match(/\(([^)]*)\)/);
        if (paramMatch && paramMatch[1]) {
          const params = paramMatch[1].split(",").map((p: string) => p.trim());
          return {
            value: {
              signatures: [{
                label: entry.fullAPI,
                documentation: entry.summary || "",
                parameters: params.map((p: string) => ({ label: p })),
              }],
              activeSignature: 0,
              activeParameter: Math.min(commaCount, params.length - 1),
            },
            dispose() {},
          };
        }
      }
    }

    return null;
  },
};

/** CodeLens: show "N usages" above each function definition (like PyCharm) */
export const codeLensProvider: monaco.languages.CodeLensProvider = {
  provideCodeLenses() {
    const uri = _activeFileUri;
    const fns = uri ? getAllFunctions(uri) : [];

    const lenses: monaco.languages.CodeLens[] = [];

    for (const fn of fns) {
      const refs = findReferencesTo(fn);
      const count = refs.length;

      lenses.push({
        range: new monaco.Range(fn.line, 1, fn.line, 1),
        command: count === 0
          ? { id: "", title: "0 usages" }
          : count === 1
            ? { id: "pygsc.goToUsage", title: "1 usage", arguments: [refs[0]] }
            : { id: "pygsc.showUsages", title: `${count} usages`, arguments: [fn] },
      });
    }

    return { lenses, dispose() {} };
  },
};
