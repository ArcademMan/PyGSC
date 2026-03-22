import { extractStrings } from "./strings";
import { getBo3Api } from "./state";
import { getAllFunctions } from "../language-service";
import type { GscDiagnostic } from "./types";

// ── Global #define index (populated from .gsh files during project indexing) ──
const gshDefines = new Set<string>();

/** Clear and rebuild the global defines from .gsh file contents */
export function indexGshDefines(gshContents: string[]) {
  gshDefines.clear();
  for (const content of gshContents) {
    for (const line of content.split("\n")) {
      const m = line.trim().match(/^#define\s+([a-zA-Z_]\w*)/);
      if (m) gshDefines.add(m[1]);
    }
  }
}

/** All GSC reserved keywords */
const GSC_KEYWORDS = new Set([
  "function", "autoexec", "if", "else", "for", "foreach", "while", "do",
  "switch", "case", "default", "return", "break", "continue", "wait",
  "thread", "waittill", "waittillmatch", "waittillframeend", "endon", "notify",
  "isdefined", "in", "true", "false", "undefined", "none",
]);

/** Built-in objects / variables always available */
const GSC_BUILTINS = new Set([
  "self", "level", "game", "world",
]);

/** Known engine functions that don't come from BO3 API data but are common */
const GSC_ENGINE = new Set([
  "Array", "Int", "Float", "String",
  "RandomInt", "RandomFloat", "RandomIntRange", "RandomFloatRange",
  "abs", "min", "max", "ceil", "floor", "sqrt", "sin", "cos", "tan",
  "tolower", "toupper", "isstring", "isint", "isfloat", "isarray",
  "GetTime", "GetDvar", "GetDvarInt", "GetDvarFloat", "SetDvar",
  "MakeDvarServerInfo", "SessionModeIsZombiesGame", "SessionModeIsMultiplayerGame",
  "IsDefined", "IsAlive", "IsPlayer", "IsAI", "IsAgent",
  "SpawnStruct", "Spawn", "GetEnt", "GetEntArray",
  "GetStruct", "GetStructArray",
  "Distance", "Distance2D", "DistanceSquared",
  "VectorScale", "VectorNormalize", "VectorDot", "VectorCross",
  "AnglesToForward", "AnglesToRight", "AnglesToUp",
  "BulletTrace", "PhysicsTrace", "SightTracePassed",
  "Assert", "AssertMsg", "AssertEx",
  "YOURFLAG", // placeholder
  "IPrintLn", "IPrintLnBold", "Print", "PrintLn",
  "GetArrayKeys", "ArraySort", "ArraySortClosest",
  "StrTok", "IsSubStr", "GetSubStr",
  "REGISTER_SYSTEM", "REGISTER_SYSTEM_EX",
  "MAP_POP", "StructureToArray",
  "animtree",
]);

/**
 * Validates GSC code for structural and semantic issues.
 */
export function lintGsc(gscCode: string): GscDiagnostic[] {
  const diagnostics: GscDiagnostic[] = [];
  const lines = gscCode.replace(/\r/g, "").split("\n");

  // Pre-process: mark lines inside block comments so all checks can skip them
  const inBlockComment = new Array<boolean>(lines.length).fill(false);
  {
    let inside = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let j = 0;
      while (j < line.length) {
        if (inside) {
          const end = line.indexOf("*/", j);
          if (end === -1) { break; } // rest of line is comment
          inside = false;
          j = end + 2;
        } else {
          const start = line.indexOf("/*", j);
          if (start === -1) break;
          inside = true;
          j = start + 2;
        }
      }
      if (inside) inBlockComment[i] = true;
      // Also mark lines that are entirely a block comment opening/closing
      if (/^\s*\/\*/.test(line) && !line.includes("*/")) inBlockComment[i] = true;
      if (/^\s*\*\//.test(line)) inBlockComment[i] = true;
    }
  }

  // Helper: strip strings and comments from a line for analysis
  function cleanLine(raw: string): string {
    const { cleaned } = extractStrings(raw);
    return cleaned.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "");
  }

  // ── 1. Unbalanced braces across the whole file ──
  let braceDepth = 0;
  let lastOpenBraceLine = -1;
  for (let i = 0; i < lines.length; i++) {
    if (inBlockComment[i]) continue;
    const cl = cleanLine(lines[i]);
    for (const c of cl) {
      if (c === "{") { braceDepth++; lastOpenBraceLine = i; }
      else if (c === "}") { braceDepth--; }
    }
    if (braceDepth < 0) {
      diagnostics.push({
        gscLine: i + 1,
        message: `"}" without matching "{"`,
        severity: "error",
      });
      braceDepth = 0;
    }
  }
  if (braceDepth > 0) {
    diagnostics.push({
      gscLine: lastOpenBraceLine + 1,
      message: `${braceDepth} unclosed "{"`,
      severity: "error",
    });
  }

  // ── 2. Unbalanced parentheses per line ──
  for (let i = 0; i < lines.length; i++) {
    if (inBlockComment[i]) continue;
    const cl = cleanLine(lines[i]);
    let depth = 0;
    for (const c of cl) {
      if (c === "(") depth++;
      else if (c === ")") depth--;
    }
    if (depth !== 0) {
      diagnostics.push({
        gscLine: i + 1,
        message: depth > 0
          ? `${depth} unclosed "("`
          : `${-depth} unexpected ")"`,
        severity: "error",
      });
    }
  }

  // ── 3. Missing semicolons ──
  // Collect all macro names (#define from this file + .gsh files)
  const macroNames = new Set<string>(gshDefines);
  for (const line of lines) {
    const dm = line.trim().match(/^#define\s+([a-zA-Z_]\w*)/);
    if (dm) macroNames.add(dm[1]);
  }

  for (let i = 0; i < lines.length; i++) {
    if (inBlockComment[i]) continue;
    const cl = cleanLine(lines[i]);
    const trimmed = cl.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("#") || trimmed.startsWith("/*")) continue;

    // Lines that don't need semicolons
    if (trimmed === "{" || trimmed === "}") continue;
    if (trimmed.endsWith("{") || trimmed.endsWith("}")) continue;
    if (trimmed.endsWith(";")) continue;
    if (/^REGISTER_SYSTEM(_EX)?\b/.test(trimmed)) continue;
    // Skip macro invocations (macros may include their own semicolons)
    // Known macros from #define + .gsh, or UPPER_CASE convention (likely external macros)
    const firstWord = trimmed.match(/^([a-zA-Z_]\w*)/);
    if (firstWord && (macroNames.has(firstWord[1]) || /^[A-Z][A-Z0-9_]+$/.test(firstWord[1]))) continue;
    if (trimmed.endsWith(",")) continue; // multi-line args
    if (trimmed.endsWith(":")) continue; // case label
    if (/^(function|if|else|for|foreach|while|do|switch)\b/.test(trimmed)) continue;
    if (/^\}\s*(else|while)\b/.test(trimmed)) continue;
    if (/^(case|default)\b/.test(trimmed)) continue;
    if (trimmed === ")") continue; // multi-line condition closing
    if (/^\/{2}/.test(trimmed)) continue;

    diagnostics.push({
      gscLine: i + 1,
      message: `Missing ";" at end of statement`,
      severity: "error",
    });
  }

  // ── 4. function declaration without valid signature ──
  for (let i = 0; i < lines.length; i++) {
    if (inBlockComment[i]) continue;
    const trimmed = lines[i].trim();
    if (/^function\b/.test(trimmed)) {
      if (!/^function\s+(autoexec\s+)?\w+\s*\(/.test(trimmed)) {
        diagnostics.push({
          gscLine: i + 1,
          message: `Invalid "function" declaration`,
          severity: "error",
        });
      }
    }
  }

  // ── 5. #animtree used without #using_animtree ──
  {
    const hasUsingAnimtree = lines.some(l => /^\s*#using_animtree\b/.test(l));
    for (let i = 0; i < lines.length; i++) {
      if (inBlockComment[i]) continue;
      if (/\b#animtree\b/.test(lines[i]) && !hasUsingAnimtree) {
        diagnostics.push({
          gscLine: i + 1,
          message: `"#animtree" used but "#using_animtree" is missing — add it at the top of the file`,
          severity: "error",
        });
      }
    }
  }

  // ── 6. Unreachable code after return ──
  for (let i = 0; i < lines.length - 1; i++) {
    if (inBlockComment[i]) continue;
    const trimmed = lines[i].trim();
    if (/^return\b/.test(trimmed) && trimmed.endsWith(";")) {
      const next = lines[i + 1]?.trim();
      if (next && next !== "}" && !next.startsWith("//") && !next.startsWith("case") && !next.startsWith("default")) {
        diagnostics.push({
          gscLine: i + 2,
          message: `Unreachable code after "return"`,
          severity: "warning",
        });
      }
    }
  }

  // ── 6. Undefined identifiers & variables used before definition ──
  // Build the set of all known names
  const knownNames = new Set<string>([
    ...GSC_KEYWORDS,
    ...GSC_BUILTINS,
    ...GSC_ENGINE,
    ...Object.keys(getBo3Api()),
    ...gshDefines,
  ]);

  // Add all project functions from the language service
  for (const fn of getAllFunctions()) {
    knownNames.add(fn.name);
  }

  // Add #define macros as known names
  for (const line of lines) {
    const defineMatch = line.trim().match(/^#define\s+([a-zA-Z_]\w*)/);
    if (defineMatch) {
      knownNames.add(defineMatch[1]);
    }
  }

  // Build case-insensitive lookup: lowercase → correct name
  const knownNamesLower = new Map<string, string>();
  for (const name of knownNames) {
    const lower = name.toLowerCase();
    // Keep the first (most authoritative) casing
    if (!knownNamesLower.has(lower)) {
      knownNamesLower.set(lower, name);
    }
  }

  // Per-function scope analysis: track variables defined within each function
  // We do a simple pass tracking assignments and function params
  type ScopeInfo = { definedVars: Set<string>; startLine: number; endLine: number };
  const scopes: ScopeInfo[] = [];
  let currentScope: ScopeInfo | null = null;
  let scopeBraceDepth = 0;

  // First pass: identify function scopes
  for (let i = 0; i < lines.length; i++) {
    const cl = cleanLine(lines[i]);
    const trimmed = cl.trim();

    // Detect function start
    const funcMatch = trimmed.match(/^function\s+(?:autoexec\s+)?\w+\s*\(([^)]*)\)/);
    if (funcMatch) {
      const params = funcMatch[1].split(",").map(p => p.trim().replace(/\s*=.*$/, "")).filter(Boolean);
      currentScope = {
        definedVars: new Set(params),
        startLine: i,
        endLine: -1,
      };
      scopeBraceDepth = 0;
    }

    if (currentScope) {
      for (const c of cl) {
        if (c === "{") scopeBraceDepth++;
        else if (c === "}") {
          scopeBraceDepth--;
          if (scopeBraceDepth === 0) {
            currentScope.endLine = i;
            scopes.push(currentScope);
            currentScope = null;
            break;
          }
        }
      }

      // Track variable assignments within scope
      if (currentScope) {
        // Simple assignment: identifier = expr;  (but not ==, !=, <=, >=)
        const assignMatch = trimmed.match(/^([a-zA-Z_]\w*)\s*=[^=]/);
        if (assignMatch) {
          currentScope.definedVars.add(assignMatch[1]);
        }
        // for loop variable: for(var = ...; ...)
        const forMatch = trimmed.match(/^for\s*\(\s*([a-zA-Z_]\w*)\s*=/);
        if (forMatch) {
          currentScope.definedVars.add(forMatch[1]);
        }
        // foreach variable: foreach(var in ...)
        const foreachMatch = trimmed.match(/^foreach\s*\(\s*([a-zA-Z_]\w*)\s+in\b/);
        if (foreachMatch) {
          currentScope.definedVars.add(foreachMatch[1]);
        }
        // waittill variables: entity waittill("event", var1, var2)
        const waittillMatch = trimmed.match(/waittill\s*\([^,]+(?:,\s*([^)]+))\)/);
        if (waittillMatch) {
          const vars = waittillMatch[1].split(",").map(v => v.trim()).filter(Boolean);
          for (const v of vars) {
            if (/^[a-zA-Z_]\w*$/.test(v)) {
              currentScope.definedVars.add(v);
            }
          }
        }
      }
    }
  }

  // Second pass: check identifiers within each scope
  for (const scope of scopes) {
    // Track which variables have been assigned so far (line by line within scope)
    const assignedByLine = new Map<string, number>(); // varName -> first assignment line

    // Pre-scan: collect all assignments with their line numbers
    for (let i = scope.startLine; i <= scope.endLine; i++) {
      const cl = cleanLine(lines[i]);
      const trimmed = cl.trim();

      const assignMatch = trimmed.match(/^([a-zA-Z_]\w*)\s*=[^=]/);
      if (assignMatch && !assignedByLine.has(assignMatch[1])) {
        assignedByLine.set(assignMatch[1], i);
      }
      const forMatch = trimmed.match(/^for\s*\(\s*([a-zA-Z_]\w*)\s*=/);
      if (forMatch && !assignedByLine.has(forMatch[1])) {
        assignedByLine.set(forMatch[1], i);
      }
      const foreachMatch = trimmed.match(/^foreach\s*\(\s*([a-zA-Z_]\w*)\s+in\b/);
      if (foreachMatch && !assignedByLine.has(foreachMatch[1])) {
        assignedByLine.set(foreachMatch[1], i);
      }
      const waittillMatch = trimmed.match(/waittill\s*\([^,]+(?:,\s*([^)]+))\)/);
      if (waittillMatch) {
        const vars = waittillMatch[1].split(",").map(v => v.trim()).filter(Boolean);
        for (const v of vars) {
          if (/^[a-zA-Z_]\w*$/.test(v) && !assignedByLine.has(v)) {
            assignedByLine.set(v, i);
          }
        }
      }
    }

    // Function params are considered assigned at the function start (always override)
    const funcLine = scope.startLine;
    const funcCl = cleanLine(lines[funcLine]);
    const funcMatch = funcCl.trim().match(/^function\s+(?:autoexec\s+)?\w+\s*\(([^)]*)\)/);
    if (funcMatch) {
      const params = funcMatch[1].split(",").map(p => p.trim().replace(/\s*=.*$/, "")).filter(Boolean);
      for (const p of params) {
        assignedByLine.set(p, funcLine);
      }
    }

    // Now check each line for undefined/unassigned identifiers
    for (let i = scope.startLine + 1; i <= scope.endLine; i++) {
      if (inBlockComment[i]) continue;
      const cl = cleanLine(lines[i]);
      const trimmed = cl.trim();
      if (!trimmed || trimmed === "{" || trimmed === "}" || trimmed.startsWith("//") || trimmed.startsWith("#")) continue;

      // Extract all bare identifiers from the line
      // Skip identifiers that are:
      //   - after "." (member access)
      //   - after "::" (namespace call — the namespace part is a file, not a variable)
      //   - the left side of an assignment (it's being defined)
      //   - part of a function declaration line

      if (/^function\b/.test(trimmed)) continue;

      // Check if line is an assignment — skip the LHS identifier
      const isAssignment = /^([a-zA-Z_]\w*)\s*=[^=]/.test(trimmed);
      const assignLHS = isAssignment ? trimmed.match(/^([a-zA-Z_]\w*)/)?.[1] : null;

      // Find all identifiers (skip string placeholders \x00STR_N\x00)
      const identRe = /\b([a-zA-Z_]\w*)\b/g;
      let m: RegExpExecArray | null;
      while ((m = identRe.exec(cl)) !== null) {
        const name = m[1];
        const startIdx = m.index;
        const endIdx = startIdx + name.length;

        // Skip string placeholders (e.g. \x00STR_0\x00)
        if (startIdx > 0 && cl[startIdx - 1] === "\x00") continue;
        if (name.startsWith("STR_")) continue;
        // Skip if preceded by "." (member access like obj.field)
        if (startIdx > 0 && cl[startIdx - 1] === ".") continue;
        // Skip if preceded by "::" (namespace::func — the func part)
        if (startIdx >= 2 && cl.substring(startIdx - 2, startIdx) === "::") continue;
        // Skip if followed by "::" (namespace prefix like callback::)
        if (cl.substring(endIdx, endIdx + 2) === "::") continue;
        // Skip if preceded by "&" (function reference like &on_connect)
        if (startIdx > 0 && cl[startIdx - 1] === "&") continue;
        // Skip method calls on entities (pattern: identifier/parenthesis + space + Func()
        // e.g. "fx MoveTo(...)", "enemy GetTagOrigin(...)", "(expr) Delete()"
        if (startIdx > 0) {
          const before = cl.substring(0, startIdx);
          if (/[\w)\]]\s+$/.test(before) && /^\s*\(/.test(cl.substring(endIdx))) continue;
        }
        // Skip if it's the LHS of an assignment on this line
        if (name === assignLHS && startIdx === cl.indexOf(assignLHS!)) continue;
        // Skip known names (keywords, builtins, BO3 API, engine funcs, project funcs)
        if (knownNames.has(name)) continue;
        // Skip UPPER_CASE identifiers (likely external macros from system headers)
        if (/^[A-Z][A-Z0-9_]+$/.test(name)) continue;

        // Check if it's a local variable assigned before this line
        const assignLine = assignedByLine.get(name);
        if (assignLine !== undefined && assignLine <= i) continue;

        // Check case-insensitive match (BO3 is case-insensitive)
        const correctName = knownNamesLower.get(name.toLowerCase());
        if (correctName) {
          diagnostics.push({
            gscLine: i + 1,
            message: `"${name}" — wrong casing, should be "${correctName}"`,
            severity: "warning",
          });
          continue;
        }

        // It's undefined — check if it looks like a typo of a keyword
        const suggestion = findClosestKeyword(name);
        const msg = suggestion
          ? `"${name}" is not defined — did you mean "${suggestion}"?`
          : `"${name}" is not defined`;

        diagnostics.push({
          gscLine: i + 1,
          message: msg,
          severity: "error",
        });
      }
    }
  }

  // ── 7. Statement-level keywords mid-line ──
  const stmtKeywords = /\b(if|while|for|foreach|else|switch|return|break|continue|do)\b/;
  for (let i = 0; i < lines.length; i++) {
    if (inBlockComment[i]) continue;
    const cl = cleanLine(lines[i]);
    const trimmed = cl.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("#")) continue;

    if (stmtKeywords.test(trimmed) && /^(if|while|for|foreach|else|switch|return|break|continue|do|} while|} else)\b/.test(trimmed)) continue;
    if (trimmed.startsWith("}")) continue;

    const match = trimmed.match(/\S+\s+.*?\b(if|while|for|foreach|else|switch|return|break|continue|do)\b/);
    if (match) {
      const kw = match[1];
      const kwIdx = trimmed.lastIndexOf(kw);
      const before = trimmed.substring(0, kwIdx).trim();
      if (before && before !== ")" && !/[,(]$/.test(before)) {
        diagnostics.push({
          gscLine: i + 1,
          message: `"${kw}" after other code on the same line — possible merged statements`,
          severity: "error",
        });
      }
    }
  }

  return diagnostics;
}

/**
 * Find the closest GSC keyword to a misspelled word (Levenshtein distance <= 2).
 */
function findClosestKeyword(word: string): string | null {
  const lw = word.toLowerCase();
  let best: string | null = null;
  let bestDist = 3; // max distance threshold

  const candidates = [
    "function", "autoexec", "if", "else", "for", "foreach", "while", "do",
    "switch", "case", "default", "return", "break", "continue", "wait",
    "thread", "waittill", "waittillmatch", "endon", "notify",
    "isdefined", "true", "false", "undefined", "self", "level", "game",
  ];

  for (const kw of candidates) {
    const d = levenshtein(lw, kw);
    if (d < bestDist) {
      bestDist = d;
      best = kw;
    }
  }

  return best;
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp: number[][] = [];
  for (let i = 0; i <= m; i++) {
    dp[i] = [i];
    for (let j = 1; j <= n; j++) {
      dp[i][j] = i === 0 ? j : 0;
    }
  }

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }

  return dp[m][n];
}
