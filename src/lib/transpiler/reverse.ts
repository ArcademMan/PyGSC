import { extractStrings, restoreStrings } from "./strings";
import { normalizeIndentation } from "./indentation";
import { collapseSyntaxSugar } from "./sugar";
import { getApi, getReverseApiMap } from "./state";
import { PAREN_KEYWORDS } from "./constants";
import { escapeRegex } from "./utils";

export function reverseTranspile(gscCode: string): string {
  // Normalize tabs to 4 spaces
  gscCode = gscCode.replace(/\t/g, "    ");

  let lines = gscCode.split("\n");

  // Remove braces and preserve original indentation
  lines = removeBracesAndIndent(lines);

  const result: string[] = [];
  for (let line of lines) {
    const indent = line.length - line.trimStart().length;
    const indentStr = " ".repeat(indent);
    let stripped = line.trim();

    if (!stripped) { result.push(""); continue; }

    // Preprocessor #define → $define
    if (stripped.startsWith("#define")) {
      result.push(indentStr + stripped.replace(/^#define/, "$define"));
      continue;
    }

    // Keep macro calls like REGISTER_SYSTEM_EX as-is
    if (/^[A-Z_]+\s*\(/.test(stripped)) {
      result.push(indentStr + stripped.replace(/;\s*$/, ""));
      continue;
    }

    // Handle switch/case/break/default
    if (/^switch\s*\(/.test(stripped)) {
      result.push(indentStr + stripped.replace(/;\s*$/, "").replace(/\s*$/, ":"));
      continue;
    }
    if (/^(case\b|default\s*:)/.test(stripped)) {
      result.push(indentStr + stripped.replace(/;\s*$/, ""));
      continue;
    }
    if (stripped === "break;") {
      result.push(indentStr + "break");
      continue;
    }

    // Protect strings
    const { cleaned, strings } = extractStrings(stripped);

    // Split comment
    let mainPart = cleaned;
    let commentPart = "";
    const commentIdx = cleaned.indexOf("//");
    if (commentIdx !== -1) {
      mainPart = cleaned.substring(0, commentIdx).trim();
      commentPart = cleaned.substring(commentIdx + 2).trim();
    }

    // Remove trailing semicolons
    mainPart = mainPart.replace(/;\s*$/, "");

    // Convert function declarations
    mainPart = convertFunctionDecl(mainPart);

    // Reverse API translations
    mainPart = reverseApiTranslations(mainPart);

    // Reverse operators (on protected text, outside strings)
    mainPart = reverseOperators(mainPart);

    // Remove outer parentheses from keywords: if(x) → if x, while(true) → while true
    mainPart = removeKeywordParentheses(mainPart);

    // Restore strings
    mainPart = restoreStrings(mainPart, strings);
    commentPart = restoreStrings(commentPart, strings);

    // Reverse $-prefixed in full line (including strings)
    let fullLine: string;
    if (commentPart) {
      fullLine = indentStr + mainPart + (mainPart ? "  " : "") + "#" + commentPart;
    } else if (mainPart) {
      fullLine = indentStr + mainPart;
    } else if (commentPart) {
      fullLine = indentStr + "#" + commentPart;
    } else {
      fullLine = "";
    }
    fullLine = reverseDollarTranslations(fullLine);

    result.push(fullLine);
  }

  // Phase: Collapse syntax sugar as final step
  return collapseSyntaxSugar(result.join("\n"));
}

// ── Internal helpers ──

function removeBracesAndIndent(lines: string[]): string[] {
  const result: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const stripped = line.trim();

    // Preserve empty lines
    if (!stripped) { result.push(""); continue; }

    // Skip brace-only lines
    if (stripped === "{" || stripped === "}") continue;

    // Get original indentation
    const indent = line.length - line.trimStart().length;
    const indentStr = " ".repeat(indent);

    let workLine = stripped;

    // Handle lines starting with } (e.g. "} else {", "} else if (...) {")
    if (workLine.startsWith("}")) {
      workLine = workLine.substring(1).trim();
      if (!workLine) continue;
    }

    // Handle lines ending with { — just strip it
    if (workLine.endsWith("{")) {
      workLine = workLine.slice(0, -1).trim();
    }

    // Handle switch/case: keep as-is
    if (workLine) {
      result.push(indentStr + workLine);
    }
  }

  // Normalize indentation to 4 spaces per level
  const normalized = normalizeIndentation(result.join("\n"));
  return normalized.split("\n");
}

function convertFunctionDecl(line: string): string {
  const autoexecMatch = line.match(/^function\s+autoexec\s+(\w+)\s*\(([^)]*)\)/i);
  if (autoexecMatch) {
    const name = autoexecMatch[1];
    const params = autoexecMatch[2].trim();
    return `autoexec ${name}(${params}):`;
  }

  const funcMatch = line.match(/^function\s+(\w+)\s*\(([^)]*)\)/i);
  if (funcMatch) {
    const name = funcMatch[1];
    const params = funcMatch[2].trim();
    return `def ${name}(${params}):`;
  }

  return line;
}

function reverseApiTranslations(text: string): string {
  const reverseApiMap = getReverseApiMap();
  for (const { pseudo, translation } of reverseApiMap) {
    if (!text.toLowerCase().includes(translation.toLowerCase())) continue;
    if (pseudo.startsWith("$")) continue; // handled separately

    const escaped = escapeRegex(translation);
    const re = new RegExp(`(?<![\\w:])${escaped}(?!\\w)`, "gi");
    text = text.replace(re, pseudo);
  }
  return text;
}

function reverseDollarTranslations(text: string): string {
  const reverseApiMap = getReverseApiMap();
  for (const { pseudo, translation } of reverseApiMap) {
    if (!pseudo.startsWith("$")) continue;
    if (!text.includes(translation)) continue;
    const escaped = escapeRegex(translation);
    text = text.replace(new RegExp(escaped, "g"), pseudo);
  }
  // Also handle entries from the main api map
  const api = getApi();
  for (const category of Object.values(api)) {
    for (const [pseudo, details] of Object.entries(category)) {
      if (!pseudo.startsWith("$") || !details.translation) continue;
      if (!text.includes(details.translation)) continue;
      text = text.replace(new RegExp(escapeRegex(details.translation), "g"), pseudo);
    }
  }
  return text;
}

function reverseOperators(text: string): string {
  text = text.replace(/\|\|/g, " or ");
  text = text.replace(/&&/g, " and ");
  text = text.replace(/\bundefined\b/g, "none");
  // ! not followed by = → not
  text = text.replace(/!(?!=)/g, "not ");
  // Clean up double spaces
  text = text.replace(/ {2,}/g, " ");
  return text;
}

function removeKeywordParentheses(line: string): string {
  for (const kw of PAREN_KEYWORDS) {
    const re = new RegExp(`^(${escapeRegex(kw)})\\s*\\((.*)\\)\\s*$`, "i");
    const match = line.match(re);
    if (match) {
      if (isBalancedOuterParens(match[0], kw.length)) {
        const content = match[2].trim();
        return `${match[1]} ${content}:`;
      }
    }
  }

  // Add colon to bare block keywords (else, do)
  const bareMatch = line.match(/^(else|do)\s*$/i);
  if (bareMatch) {
    return `${bareMatch[1]}:`;
  }

  return line;
}

function isBalancedOuterParens(line: string, kwLen: number): boolean {
  const rest = line.substring(kwLen).trim();
  if (!rest.startsWith("(") || !rest.endsWith(")")) return false;

  let depth = 0;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "(") depth++;
    else if (rest[i] === ")") depth--;
    if (depth === 0 && i < rest.length - 1) return false;
  }
  return depth === 0;
}
