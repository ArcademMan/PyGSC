import { extractStrings } from "./strings";
import type { GscDiagnostic } from "./types";

/**
 * Validates the transpiled GSC output for structural syntax issues.
 * Returns diagnostics with GSC line numbers (for display on the GSC editor).
 */
export function lintGsc(gscCode: string): GscDiagnostic[] {
  const diagnostics: GscDiagnostic[] = [];
  const lines = gscCode.split("\n");

  // Helper: strip strings and comments from a line for analysis
  function cleanLine(raw: string): string {
    const { cleaned } = extractStrings(raw);
    return cleaned.replace(/\/\/.*$/, "");
  }

  // ── 1. Unbalanced braces across the whole file ──
  let braceDepth = 0;
  let lastOpenBraceLine = -1;
  for (let i = 0; i < lines.length; i++) {
    const cl = cleanLine(lines[i]);
    for (const c of cl) {
      if (c === "{") { braceDepth++; lastOpenBraceLine = i; }
      else if (c === "}") { braceDepth--; }
    }
    if (braceDepth < 0) {
      diagnostics.push({
        gscLine: i + 1,
        message: "[GSC] \"}\" senza \"{\" corrispondente",
        severity: "error",
      });
      braceDepth = 0;
    }
  }
  if (braceDepth > 0) {
    diagnostics.push({
      gscLine: lastOpenBraceLine + 1,
      message: `[GSC] ${braceDepth} \"{\" non chiuse`,
      severity: "error",
    });
  }

  // ── 2. Unbalanced parentheses per line ──
  for (let i = 0; i < lines.length; i++) {
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
          ? `[GSC] ${depth} "(" non chiuse`
          : `[GSC] ${-depth} ")" inaspettate`,
        severity: "error",
      });
    }
  }

  // ── 3. Statement-level keywords mid-line ──
  const stmtKeywords = /\b(if|while|for|foreach|else|switch|return|break|continue|do)\b/;
  for (let i = 0; i < lines.length; i++) {
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
          message: `[GSC] "${kw}" dopo altro codice sulla stessa riga — possibili statement uniti`,
          severity: "error",
        });
      }
    }
  }

  // ── 5. function declaration without valid signature ──
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (/^function\b/.test(trimmed)) {
      if (!/^function\s+(autoexec\s+)?\w+\s*\(/.test(trimmed)) {
        diagnostics.push({
          gscLine: i + 1,
          message: `[GSC] Dichiarazione "function" non valida`,
          severity: "error",
        });
      }
    }
  }

  // ── 6. Unreachable code after return ──
  for (let i = 0; i < lines.length - 1; i++) {
    const trimmed = lines[i].trim();
    if (/^return\b/.test(trimmed) && trimmed.endsWith(";")) {
      const next = lines[i + 1]?.trim();
      if (next && next !== "}" && !next.startsWith("//") && !next.startsWith("case") && !next.startsWith("default")) {
        diagnostics.push({
          gscLine: i + 2,
          message: `[GSC] Codice irraggiungibile dopo "return"`,
          severity: "warning",
        });
      }
    }
  }

  return diagnostics;
}
