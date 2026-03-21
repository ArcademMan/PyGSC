import pygscApi from "../../data/pygsc-api.json";
import usingsMap from "../../data/usings.json";
import bo3Api from "../../data/bo3-api.json";
import type { PyGscApi, Bo3Function, ReverseEntry } from "./types";

// ══════════════════════════════════════════════
// MUTABLE STATE
// ══════════════════════════════════════════════

let api: PyGscApi = pygscApi as PyGscApi;
let usings: Record<string, string> = { ...usingsMap };
let reverseApiMap: ReverseEntry[] = [];

// Lazy caches
let _bo3Lookup: Record<string, Bo3Function> | null = null;
let _bo3LowerMap: Map<string, { name: string; fn: Bo3Function }> | null = null;
let _pygscApiFlat: Set<string> | null = null;
let _pygscApiTranslations: Map<string, string> | null = null;

// ══════════════════════════════════════════════
// INTERNAL ACCESSORS (for other transpiler modules)
// ══════════════════════════════════════════════

export function getApi(): PyGscApi {
  return api;
}

export function getUsings(): Record<string, string> {
  return usings;
}

export function getReverseApiMap(): ReverseEntry[] {
  return reverseApiMap;
}

// ══════════════════════════════════════════════
// REVERSE API MAP BUILDER
// ══════════════════════════════════════════════

function buildReverseApiMap() {
  reverseApiMap = [];
  for (const category of Object.values(api)) {
    for (const [pseudo, details] of Object.entries(category)) {
      if (details.translation && details.translation !== pseudo) {
        if (["or", "and", "not", "none", "None"].includes(pseudo.trim())) continue;
        reverseApiMap.push({ pseudo, translation: details.translation });
      }
    }
  }
  reverseApiMap.sort((a, b) => b.translation.length - a.translation.length);
}

// Build initial map
buildReverseApiMap();

// ══════════════════════════════════════════════
// PUBLIC API — Data Access
// ══════════════════════════════════════════════

/**
 * Returns the full API data for use in the UI
 */
export function getApiData(): PyGscApi {
  return api;
}

/**
 * Returns a flat list of all API keywords for autocomplete.
 */
export function getApiKeywords(): string[] {
  const keywords: string[] = [];
  for (const category of Object.values(api)) {
    for (const key of Object.keys(category)) {
      keywords.push(key);
    }
  }
  return keywords;
}

/**
 * Returns the BO3 engine API as a record of function name → details.
 */
export function getBo3Api(): Record<string, Bo3Function> {
  return bo3Api as Record<string, Bo3Function>;
}

// ══════════════════════════════════════════════
// PUBLIC API — Custom API/Usings Management
// ══════════════════════════════════════════════

/**
 * Merge user-defined custom API entries into the transpiler.
 */
export function mergeCustomApi(customApi: PyGscApi) {
  // Start from built-in base
  api = { ...(pygscApi as PyGscApi) };
  // Merge custom categories
  for (const [category, entries] of Object.entries(customApi)) {
    if (api[category]) {
      api[category] = { ...api[category], ...entries };
    } else {
      api[category] = { ...entries };
    }
  }
  buildReverseApiMap();
  // Invalidate derived caches
  _pygscApiFlat = null;
  _pygscApiTranslations = null;
}

/**
 * Merge user-defined custom usings into the transpiler.
 */
export function mergeCustomUsings(customUsings: Record<string, string>) {
  usings = { ...usingsMap, ...customUsings };
}

/**
 * Get the current custom API entries (excluding built-in ones).
 */
export function getCustomApiEntries(): PyGscApi {
  const builtIn = pygscApi as PyGscApi;
  const custom: PyGscApi = {};
  for (const [category, entries] of Object.entries(api)) {
    for (const [key, value] of Object.entries(entries)) {
      if (!builtIn[category]?.[key]) {
        if (!custom[category]) custom[category] = {};
        custom[category][key] = value;
      }
    }
  }
  return custom;
}

/**
 * Get the current custom usings entries (excluding built-in ones).
 */
export function getCustomUsingsEntries(): Record<string, string> {
  const custom: Record<string, string> = {};
  for (const [key, value] of Object.entries(usings)) {
    if (!(usingsMap as Record<string, string>)[key]) {
      custom[key] = value;
    }
  }
  return custom;
}

// ══════════════════════════════════════════════
// BO3 LOOKUP HELPERS (used by linter)
// ══════════════════════════════════════════════

export function getBo3Lookup(): Record<string, Bo3Function> {
  if (!_bo3Lookup) _bo3Lookup = bo3Api as Record<string, Bo3Function>;
  return _bo3Lookup;
}

export function getBo3LowerMap(): Map<string, { name: string; fn: Bo3Function }> {
  if (!_bo3LowerMap) {
    _bo3LowerMap = new Map();
    const lookup = getBo3Lookup();
    for (const [name, fn] of Object.entries(lookup)) {
      _bo3LowerMap.set(name.toLowerCase(), { name, fn });
    }
  }
  return _bo3LowerMap;
}

export function getPygscApiNames(): Set<string> {
  if (!_pygscApiFlat) {
    _pygscApiFlat = new Set();
    for (const category of Object.values(api)) {
      for (const key of Object.keys(category)) {
        _pygscApiFlat.add(key.trim().toLowerCase());
      }
    }
  }
  return _pygscApiFlat;
}

export function getPygscApiTranslations(): Map<string, string> {
  if (!_pygscApiTranslations) {
    _pygscApiTranslations = new Map();
    for (const category of Object.values(api)) {
      for (const [key, details] of Object.entries(category)) {
        if (details.translation) {
          _pygscApiTranslations.set(key.trim().toLowerCase(), details.translation);
        }
      }
    }
  }
  return _pygscApiTranslations;
}

// ══════════════════════════════════════════════
// PARAM COUNTING HELPERS (used by linter)
// ══════════════════════════════════════════════

/** Count mandatory params from a Bo3Function's fullAPI signature */
export function countBo3Params(fn: Bo3Function): { min: number; max: number } {
  const match = fn.fullAPI.match(/\(([^)]*)\)/);
  if (!match || !match[1].trim()) return { min: 0, max: 0 };
  const params = match[1].split(",");
  let mandatory = 0;
  let optional = 0;
  for (const p of params) {
    if (p.includes("[") || p.toLowerCase().includes("optional")) {
      optional++;
    } else {
      mandatory++;
    }
  }
  // Count optionalN fields — these are more reliable than mandatoryN
  let fieldOptionals = 0;
  let oi = 1;
  while (fn[`optional${oi}`]) { fieldOptionals++; oi++; }

  // Use the higher of: optionals from signature vs optionals from fields
  const totalParams = mandatory + optional;
  const realOptional = Math.max(optional, fieldOptionals);
  const realMandatory = Math.max(0, totalParams - realOptional);
  return { min: realMandatory, max: totalParams };
}

/** Count arguments in a function call (respects nested parens and strings) */
export function countCallArgs(argsStr: string): number {
  const trimmed = argsStr.trim();
  if (!trimmed) return 0;
  let depth = 0;
  let inStr: string | null = null;
  let count = 1;
  for (let i = 0; i < trimmed.length; i++) {
    const c = trimmed[i];
    if (inStr) {
      if (c === inStr && trimmed[i - 1] !== "\\") inStr = null;
      continue;
    }
    if (c === '"' || c === "'") { inStr = c; continue; }
    if (c === "(" || c === "[") { depth++; continue; }
    if (c === ")" || c === "]") { depth--; continue; }
    if (c === "," && depth === 0) count++;
  }
  return count;
}

/** Extract the arguments string between the outer parentheses of a call */
export function extractCallArgs(line: string, funcEndIdx: number): string | null {
  if (funcEndIdx >= line.length || line[funcEndIdx] !== "(") return null;
  let depth = 0;
  for (let i = funcEndIdx; i < line.length; i++) {
    if (line[i] === "(") depth++;
    else if (line[i] === ")") {
      depth--;
      if (depth === 0) return line.substring(funcEndIdx + 1, i);
    }
  }
  return null;
}
