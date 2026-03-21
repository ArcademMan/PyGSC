import { extractStrings, restoreStrings } from "./strings";
import { normalizeIndentation } from "./indentation";
import { expandSyntaxSugar } from "./sugar";
import { ensureBracketsWithMap } from "./brackets";
import { getApi, getUsings } from "./state";
import { OPEN_PARENTHESES_WORDS, NO_SEMICOLON } from "./constants";
import { startsWithAny, escapeRegex } from "./utils";
import type { TranspileResult } from "./types";

export function transpile(pseudoCode: string): string {
  return transpileWithMap(pseudoCode).code;
}

export function transpileWithMap(pseudoCode: string): TranspileResult {
  // Phase 1: Expand syntax sugar before standard pipeline
  let gscCode = expandSyntaxSugar(pseudoCode);
  gscCode = gscCode.replace(/\t/g, "    ");
  gscCode = normalizeIndentation(gscCode);
  const usedUsings = new Set<string>();

  // Phase 1.5: Join continuation lines (lines ending with an operator)
  const rawLines = gscCode.split("\n");
  const joinedLines: string[] = [];
  // Maps each joined line index → array of original line indices
  const joinMap: number[][] = [];
  {
    let i = 0;
    let inBlockCommentJoin = false;
    while (i < rawLines.length) {
      let current = rawLines[i];
      const origIndices = [i];
      const trimCheck = current.trim();

      // Track block comments — never join lines inside them
      if (!inBlockCommentJoin && trimCheck.startsWith("/*")) {
        inBlockCommentJoin = true;
        if (trimCheck.includes("*/")) inBlockCommentJoin = false;
        joinedLines.push(current);
        joinMap.push(origIndices);
        i++;
        continue;
      }
      if (inBlockCommentJoin) {
        if (trimCheck.includes("*/")) inBlockCommentJoin = false;
        joinedLines.push(current);
        joinMap.push(origIndices);
        i++;
        continue;
      }

      // Keep joining while the line ends with a continuation operator
      // or has unclosed parentheses/brackets
      while (i + 1 < rawLines.length) {
        const { cleaned } = extractStrings(current);
        const noComment = cleaned.replace(/#.*$/, "").trimEnd();
        // Check if parentheses/brackets are unclosed
        let parenDepth = 0;
        for (const c of cleaned) {
          if (c === "(" || c === "[") parenDepth++;
          else if (c === ")" || c === "]") parenDepth--;
        }
        if (parenDepth > 0 || /(\b(and|or|not|minor|inequal)\s*$|(?<![+\-])[+\-*\/=<>,&|!]\s*$)/.test(noComment)) {
          i++;
          origIndices.push(i);
          current = current.trimEnd() + " " + rawLines[i].trim();
        } else {
          break;
        }
      }
      joinedLines.push(current);
      joinMap.push(origIndices);
      i++;
    }
  }

  let lines = joinedLines;
  const translatedLines: string[] = [];

  let inBlockCommentPhase1 = false;
  for (let line of lines) {
    const stripped = line.trim();

    // Track block comments — pass through without translation
    if (!inBlockCommentPhase1 && stripped.startsWith("/*")) {
      inBlockCommentPhase1 = true;
      if (stripped.includes("*/")) inBlockCommentPhase1 = false;
      translatedLines.push(line);
      continue;
    }
    if (inBlockCommentPhase1) {
      if (stripped.includes("*/")) inBlockCommentPhase1 = false;
      translatedLines.push(line);
      continue;
    }

    // GSC preprocessor directives — pass through without any translation
    if (/^#(define|precache)\b/.test(stripped)) {
      translatedLines.push(line);
      continue;
    }

    // animgeneric → #using_animtree( "generic" ) — emit directly, skip all processing
    if (stripped === "animgeneric") {
      const indent = line.length - line.trimStart().length;
      translatedLines.push(" ".repeat(indent) + '#using_animtree( "generic" )');
      continue;
    }

    // Extract strings to protect them
    const { cleaned, strings } = extractStrings(line);

    let processedClean: string;

    // Find the first # that is actually a comment (not #animtree, #namespace, #using, #insert, #define, #precache)
    const gscHashDirectives = /^#(using_animtree|animtree|namespace|using|insert|define|precache)\b/;
    let commentHashIdx = -1;
    {
      let searchFrom = 0;
      while (searchFrom < cleaned.length) {
        const idx = cleaned.indexOf("#", searchFrom);
        if (idx === -1) break;
        const afterHash = cleaned.substring(idx);
        if (gscHashDirectives.test(afterHash)) {
          searchFrom = idx + 1;
          continue;
        }
        commentHashIdx = idx;
        break;
      }
    }
    if (commentHashIdx !== -1) {
      let mainPart = cleaned.substring(0, commentHashIdx);
      const commentPart = cleaned.substring(commentHashIdx + 1);

      mainPart = applyApiTranslations(mainPart, usedUsings);
      mainPart = applyOperatorTranslations(mainPart);
      processedClean = mainPart + "//" + commentPart.trim();
    } else {
      processedClean = applyApiTranslations(cleaned, usedUsings);
      processedClean = applyOperatorTranslations(processedClean);
    }

    // Now handle $-prefixed replacements INSIDE strings too
    let restored = restoreStrings(processedClean, strings);
    restored = applyDollarTranslations(restored);

    translatedLines.push(restored);
  }

  // Apply function parentheses
  lines = translatedLines.map(applyFunctionParentheses);

  // Apply keyword parentheses (string-safe)
  lines = lines.map((l) => applyParenthesesForKeywords(l, OPEN_PARENTHESES_WORDS));

  // Strip trailing colons (Pythonic block syntax) — must happen before semicolons
  // But preserve colon on case/default lines (it's GSC syntax, not a block opener)
  lines = lines.map((l) => {
    const trimmed = l.trimEnd();
    if (!trimmed.endsWith(":")) return l;
    const s = trimmed.trim();
    if (/^case\b/.test(s) || /^default\s*:/.test(s)) return l;
    return trimmed.slice(0, -1);
  });

  // Add semicolons (string-safe, block-comment-aware)
  let inBlockComment = false;
  for (let i = 0; i < lines.length; i++) {
    const stripped = lines[i].trim();

    // Track block comment state
    if (!inBlockComment && stripped.startsWith("/*")) {
      inBlockComment = true;
      if (stripped.includes("*/")) inBlockComment = false;
      continue;
    }
    if (inBlockComment) {
      if (stripped.includes("*/")) inBlockComment = false;
      continue;
    }

    if (
      stripped &&
      !startsWithAny(stripped, NO_SEMICOLON) &&
      !stripped.endsWith(";") &&
      !stripped.endsWith("{") &&
      !stripped.endsWith("}") &&
      !stripped.endsWith("*/") &&
      !stripped.startsWith("/*")
    ) {
      const { cleaned, strings } = extractStrings(lines[i]);
      if (cleaned.includes("//") && !cleaned.trim().startsWith("//")) {
        const cidx = cleaned.indexOf("//");
        const before = cleaned.substring(0, cidx);
        const after = cleaned.substring(cidx);
        lines[i] = restoreStrings(before.trimEnd() + "; " + after, strings);
      } else if (!cleaned.trim().startsWith("//")) {
        lines[i] = lines[i] + ";";
      }
    }
  }

  gscCode = lines.join("\n");

  // Add curly braces based on indentation (string-safe) — also get line map
  const bracketResult = ensureBracketsWithMap(gscCode);
  gscCode = bracketResult.code;
  // bracketResult.lineMap maps joined-line index → GSC output line index.
  // Expand it back to original PyGSC lines using joinMap.
  let lineMap: number[] = [];
  for (let j = 0; j < bracketResult.lineMap.length; j++) {
    const gscLine = bracketResult.lineMap[j];
    const origIndices = joinMap[j] || [j];
    for (const _oi of origIndices) {
      lineMap.push(gscLine);
    }
  }

  // Add #using lines at the top — offset the line map
  // Skip any that are already present (user wrote them as `import`)
  if (usedUsings.size > 0) {
    const existing = new Set(
      gscCode.split("\n").filter((l) => l.trim().startsWith("#using ")).map((l) => l.trim().replace(/;\s*$/, ""))
    );
    const usingLines = Array.from(usedUsings).filter((u) => !existing.has(u));
    if (usingLines.length === 0) {
      return { code: gscCode, lineMap };
    }
    const offset = usingLines.length + 1; // +1 for the blank line separator
    gscCode = usingLines.join("\n") + "\n\n" + gscCode;
    lineMap = lineMap.map((gscLine) => gscLine + offset);
  }

  return { code: gscCode, lineMap };
}

// ── Internal helpers ──

function applyOperatorTranslations(text: string): string {
  text = text.replace(/(?<!\w)\bor\b(?!\w)/gi, "||");
  text = text.replace(/(?<!\w)\band\b(?!\w)/gi, "&&");
  text = text.replace(/(?<!\w)\bnone\b(?!\w)/g, "undefined");
  text = text.replace(/(?<!\w)\bNone\b(?!\w)/g, "undefined");
  text = text.replace(/(?<!\w)\bTrue\b(?!\w)/g, "true");
  text = text.replace(/(?<!\w)\bFalse\b(?!\w)/g, "false");
  text = text.replace(/(?<![!=])(?<!\w)\bnot\b(?!\w)/g, "!");
  return text;
}

function applyApiTranslations(text: string, usedUsings: Set<string>): string {
  const api = getApi();
  const usingsData = getUsings();
  for (const category of Object.values(api)) {
    for (const [pseudo, details] of Object.entries(category)) {
      const translation = details.translation;
      if (!translation) continue;

      // Skip $-prefixed (handled separately to allow in-string replacement)
      if (pseudo.startsWith("$")) continue;

      // Skip operator-like entries (handled by applyOperatorTranslations)
      if (["or", "and", "not", "none", "None"].includes(pseudo.trim())) continue;

      if (!text.toLowerCase().includes(pseudo.toLowerCase())) continue;

      const escaped = escapeRegex(pseudo);
      const re = new RegExp(`(?<!\\w)${escaped}(?!\\w)`, "gi");
      text = text.replace(re, translation);

      const nsMatch = translation.match(/^([^:]+::)/);
      if (nsMatch && usingsData[nsMatch[1]]) {
        usedUsings.add(usingsData[nsMatch[1]]);
      }
    }
  }
  return text;
}

function applyDollarTranslations(text: string): string {
  const api = getApi();
  for (const category of Object.values(api)) {
    for (const [pseudo, details] of Object.entries(category)) {
      if (!pseudo.startsWith("$") || !details.translation) continue;
      if (!text.toLowerCase().includes(pseudo.toLowerCase())) continue;

      const escaped = escapeRegex(pseudo);
      const re = new RegExp(`${escaped}(?!\\w)`, "gi");
      text = text.replace(re, details.translation);
    }
  }
  return text;
}

function applyFunctionParentheses(line: string): string {
  const stripped = line.trim();

  // Match: function [autoexec] name(params): — parens present, strip colon
  const match = stripped.match(
    /^(function\s+(?:autoexec\s+)?\w+)\s*\([^)]*\)\s*:\s*$/i
  );
  if (match) {
    return stripped.replace(/:\s*$/, "");
  }

  // Match: function [autoexec] name: — no parens, add empty parens, strip colon
  const noParamsMatch = stripped.match(
    /^(function\s+(?:autoexec\s+)?(\w+))\s*:\s*$/i
  );
  if (noParamsMatch) {
    return `${noParamsMatch[1]}()`;
  }

  return line;
}

function applyParenthesesForKeywords(line: string, keywords: string[]): string {
  const stripped = line.trim();
  if (!stripped) return line;

  // Protect strings
  const { cleaned, strings } = extractStrings(line);
  const cleanedStripped = cleaned.trim();

  let lineBeforeComment: string;
  let commentPart = "";

  if (cleanedStripped.includes("//")) {
    const idx = cleaned.indexOf("//");
    lineBeforeComment = cleaned.substring(0, idx);
    commentPart = cleaned.substring(idx);
  } else {
    lineBeforeComment = cleaned;
  }

  // Strip trailing colon (Pythonic block-opening syntax)
  // Preserve colon on case/default lines (it's GSC syntax)
  const trimmedForCheck = lineBeforeComment.trim();
  if (!/^case\b/.test(trimmedForCheck) && !/^default\s*:/.test(trimmedForCheck)) {
    lineBeforeComment = lineBeforeComment.replace(/:\s*$/, "");
  }

  const keywordInLine = keywords.find((kw) => {
    const re = new RegExp(`\\b${escapeRegex(kw)}\\b`, "i");
    return re.test(lineBeforeComment);
  });

  if (keywordInLine) {
    const kwIdx = lineBeforeComment.toLowerCase().indexOf(keywordInLine.toLowerCase());
    if (kwIdx !== -1) {
      const afterKw = lineBeforeComment.substring(kwIdx + keywordInLine.length).trimStart();
      if (!afterKw.startsWith("(")) {
        lineBeforeComment =
          lineBeforeComment.substring(0, kwIdx) +
          keywordInLine +
          " (" +
          lineBeforeComment.substring(kwIdx + keywordInLine.length) +
          " )";
      }
    }
  }

  const result = commentPart ? lineBeforeComment + commentPart : lineBeforeComment;
  return restoreStrings(result, strings);
}
