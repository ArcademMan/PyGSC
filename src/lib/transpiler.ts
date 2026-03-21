import pygscApi from "../data/pygsc-api.json";
import usingsMap from "../data/usings.json";
import bo3Api from "../data/bo3-api.json";

interface ApiEntry {
  translation: string;
  fullAPI?: string;
  summary?: string;
  example?: string;
  [key: string]: string | undefined;
}

type PyGscApi = Record<string, Record<string, ApiEntry>>;

let api: PyGscApi = pygscApi as PyGscApi;
let usings: Record<string, string> = { ...usingsMap };

const OPEN_PARENTHESES_WORDS = [
  "if", "elseif", "elif", "else if", "foreach", "for",
  "while",
];

const NO_SEMICOLON = [
  "if", "while", "for", "foreach", "do", "{", "}",
  "function", "func", "elif", "else", "else if",
  "elseif", "#define", "switch", "case", "default",
  "/*", "*/", "REGISTER_SYSTEM_EX",
];

const OPEN_BRACES = [
  "function", "if", "while", "for", "else", "foreach",
  "elif", "else if", "elseif", "do", "switch",
];

// ══════════════════════════════════════════════
// STRING PROTECTION
// ══════════════════════════════════════════════

const STRING_PLACEHOLDER_PREFIX = "\x00STR_";

function extractStrings(text: string): { cleaned: string; strings: string[] } {
  const strings: string[] = [];
  let result = "";
  let i = 0;

  while (i < text.length) {
    const c = text[i];
    if (c === '"' || c === "'") {
      const quote = c;
      let str = quote;
      i++;
      while (i < text.length && text[i] !== quote) {
        if (text[i] === "\\" && i + 1 < text.length) {
          str += text[i] + text[i + 1];
          i += 2;
        } else {
          str += text[i];
          i++;
        }
      }
      if (i < text.length) {
        str += text[i]; // closing quote
        i++;
      }
      const idx = strings.length;
      strings.push(str);
      result += STRING_PLACEHOLDER_PREFIX + idx + "\x00";
    } else {
      result += c;
      i++;
    }
  }

  return { cleaned: result, strings };
}

function restoreStrings(text: string, strings: string[]): string {
  return text.replace(/\x00STR_(\d+)\x00/g, (_, idx) => strings[parseInt(idx)]);
}

// ══════════════════════════════════════════════
// INDENTATION NORMALIZATION
// ══════════════════════════════════════════════

/**
 * Detects the indent unit used in the source and normalizes
 * all indentation to 4 spaces per level.
 */
function normalizeIndentation(source: string): string {
  const lines = source.split("\n");

  // Find the smallest non-zero indentation (the indent unit)
  let minIndent = Infinity;
  for (const line of lines) {
    if (!line.trim()) continue;
    const indent = line.length - line.trimStart().length;
    if (indent > 0 && indent < minIndent) minIndent = indent;
  }

  // Already 4-space or no indentation found — nothing to do
  if (minIndent === Infinity || minIndent === 4) return source;

  const result: string[] = [];
  for (const line of lines) {
    if (!line.trim()) { result.push(line); continue; }
    const indent = line.length - line.trimStart().length;
    const level = Math.round(indent / minIndent);
    result.push(" ".repeat(level * 4) + line.trim());
  }
  return result.join("\n");
}

// ══════════════════════════════════════════════
// SYNTAX SUGAR: EXPAND (PyGSC sugar → PyGSC standard)
// ══════════════════════════════════════════════

/**
 * Collects all contiguous lines after `startIdx` that have indent > baseIndent.
 * Returns the body lines and the index of the first non-body line.
 */
function collectIndentedBody(lines: string[], startIdx: number, baseIndent: number): { body: string[]; nextIdx: number } {
  const body: string[] = [];
  let i = startIdx;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      // Blank lines are part of the body if followed by more indented content
      body.push(line);
      i++;
      continue;
    }
    const indent = line.length - line.trimStart().length;
    if (indent > baseIndent) {
      body.push(line);
      i++;
    } else {
      break;
    }
  }
  // Trim trailing blank lines from body
  while (body.length > 0 && body[body.length - 1].trim() === "") {
    body.pop();
    i--;
  }
  return { body, nextIdx: i };
}

/** Track nesting depth for repeat variable names */
let repeatNestingDepth = 0;

export function expandSyntaxSugar(source: string): string {
  const lines = source.split("\n");
  const result: string[] = [];
  let i = 0;

  // Collect @endon and @system decorators
  const pendingDecorators: string[] = [];

  while (i < lines.length) {
    const line = lines[i];
    const stripped = line.trim();
    const indent = line.length - line.trimStart().length;
    const indentStr = " ".repeat(indent);

    // Protect strings for pattern matching
    const { cleaned } = extractStrings(stripped);

    // ── @system "name" ──
    const systemMatch = cleaned.match(/^@system\s+(.+)$/);
    if (systemMatch) {
      const nameWithPlaceholders = systemMatch[1].trim();
      // Restore strings to get the actual name
      const { cleaned: c2, strings: s2 } = extractStrings(stripped);
      const m2 = c2.match(/^@system\s+(.+)$/);
      if (m2) {
        const name = restoreStrings(m2[1].trim(), s2);
        result.push(`${indentStr}REGISTER_SYSTEM_EX( ${name}, &__init__, &__main__, none )`);
      }
      i++;
      continue;
    }

    // ── @endon "event1", "event2" ──
    const endonMatch = cleaned.match(/^@endon\s+(.+)$/);
    if (endonMatch) {
      // Collect the raw decorator line for later
      pendingDecorators.push(stripped);
      i++;
      continue;
    }

    // ── Apply pending @endon decorators to def/autoexec ──
    if (pendingDecorators.length > 0 && /^(def|autoexec)\b/.test(cleaned)) {
      // Emit the def line
      result.push(line);
      i++;

      // Parse all @endon decorators to get the event strings
      const endonLines: string[] = [];
      for (const dec of pendingDecorators) {
        const { cleaned: dc, strings: ds } = extractStrings(dec);
        const dm = dc.match(/^@endon\s+(.+)$/);
        if (dm) {
          const restored = restoreStrings(dm[1].trim(), ds);
          // Split by comma to get individual events (could be "event1", "event2")
          const events = restored.match(/"[^"]*"|'[^']*'/g);
          if (events) {
            for (const ev of events) {
              endonLines.push(`${indentStr}    self endon(${ev})`);
            }
          }
        }
      }
      pendingDecorators.length = 0;

      // Insert endon lines at the start of the function body
      for (const el of endonLines) {
        result.push(el);
      }
      continue;
    }

    // If we have pending decorators but no def follows, just emit them as-is
    if (pendingDecorators.length > 0 && stripped !== "") {
      for (const dec of pendingDecorators) {
        result.push(indentStr + dec);
      }
      pendingDecorators.length = 0;
    }

    // ── every X: ──
    const everyMatch = cleaned.match(/^every\s+(.+):\s*$/);
    if (everyMatch) {
      const waitVal = restoreStrings(everyMatch[1].trim(), extractStrings(stripped).strings);
      const { body, nextIdx } = collectIndentedBody(lines, i + 1, indent);
      result.push(`${indentStr}while true:`);
      result.push(`${indentStr}    wait ${waitVal}`);
      for (const bl of body) {
        result.push(bl);
      }
      i = nextIdx;
      continue;
    }

    // ── on/once entity "event", vars: ──
    {
      const { cleaned: sc, strings: ss } = extractStrings(stripped);
      const onMatch2 = sc.match(/^(on|once)\s+(?:(\w+)\s+)?(\x00STR_\d+\x00(?:\s*,\s*[\w,\s]+)?):\s*$/);
      if (onMatch2) {
        const keyword = onMatch2[1]; // "on" or "once"
        const entity = onMatch2[2] || "self";
        const rest = restoreStrings(onMatch2[3].trim(), ss);

        // Parse event and variables: "event", var1, var2
        const eventVarMatch = rest.match(/^("[^"]*"|'[^']*')(.*)$/);
        if (eventVarMatch) {
          const event = eventVarMatch[1];
          const varsStr = eventVarMatch[2].trim().replace(/^,\s*/, "");
          const waittillLine = varsStr
            ? `${indentStr}    ${entity} waittill(${event}, ${varsStr})`
            : `${indentStr}    ${entity} waittill(${event})`;

          const { body, nextIdx } = collectIndentedBody(lines, i + 1, indent);

          if (keyword === "on") {
            result.push(`${indentStr}while true:`);
            result.push(waittillLine);
            for (const bl of body) {
              result.push(bl);
            }
          } else {
            // "once" — no while loop, body at same indent as waittill
            const waittillOnce = varsStr
              ? `${indentStr}${entity} waittill(${event}, ${varsStr})`
              : `${indentStr}${entity} waittill(${event})`;
            result.push(waittillOnce);
            // De-indent body to same level as waittill (remove one indent level)
            for (const bl of body) {
              if (bl.trim() === "") {
                result.push(bl);
              } else {
                const blIndent = bl.length - bl.trimStart().length;
                const newIndent = Math.max(indent, blIndent - 4);
                result.push(" ".repeat(newIndent) + bl.trim());
              }
            }
          }
          i = nextIdx;
          continue;
        }
      }
    }

    // ── chance N: ──
    const chanceMatch = cleaned.match(/^chance\s+(\d+):\s*$/);
    if (chanceMatch) {
      const n = chanceMatch[1];
      const { body, nextIdx } = collectIndentedBody(lines, i + 1, indent);
      result.push(`${indentStr}if RandomInt(100) < ${n}:`);
      for (const bl of body) {
        result.push(bl);
      }
      i = nextIdx;
      continue;
    }

    // ── repeat N: ──
    const repeatMatch = cleaned.match(/^repeat\s+(\d+):\s*$/);
    if (repeatMatch) {
      const n = repeatMatch[1];
      const varNames = ["i", "j", "k", "ii", "jj", "kk"];
      const varName = varNames[Math.min(repeatNestingDepth, varNames.length - 1)];
      const { body, nextIdx } = collectIndentedBody(lines, i + 1, indent);
      result.push(`${indentStr}for ${varName} = 0; ${varName} < ${n}; ${varName}++:`);
      repeatNestingDepth++;
      for (const bl of body) {
        result.push(bl);
      }
      repeatNestingDepth = Math.max(0, repeatNestingDepth - 1);
      i = nextIdx;
      continue;
    }

    // No sugar match — emit as-is
    result.push(line);
    i++;
  }

  return result.join("\n");
}

// ══════════════════════════════════════════════
// SYNTAX SUGAR: COLLAPSE (PyGSC standard → PyGSC sugar)
// ══════════════════════════════════════════════

export function collapseSyntaxSugar(source: string): string {
  let lines = source.split("\n");
  let result: string[] = [];

  // Pass 1: Collapse @system and animgeneric
  for (let i = 0; i < lines.length; i++) {
    const stripped = lines[i].trim();
    const indent = lines[i].length - lines[i].trimStart().length;
    const indentStr = " ".repeat(indent);

    const sysMatch = stripped.match(/^REGISTER_SYSTEM_EX\(\s*("[^"]*"|'[^']*')\s*,\s*&__init__\s*,\s*&__main__\s*,\s*(?:none|undefined)\s*\)$/);
    if (sysMatch) {
      result.push(`${indentStr}@system ${sysMatch[1]}`);
      continue;
    }
    if (/^#using_animtree\(\s*"generic"\s*\)/.test(stripped)) {
      result.push(`${indentStr}animgeneric`);
      continue;
    }
    result.push(lines[i]);
  }

  // Pass 2: Collapse @endon (self endon at start of def → @endon decorator)
  lines = result;
  result = [];
  for (let i = 0; i < lines.length; i++) {
    const stripped = lines[i].trim();
    const indent = lines[i].length - lines[i].trimStart().length;
    const indentStr = " ".repeat(indent);

    if (/^(def|autoexec)\b/.test(stripped)) {
      // Look ahead for self endon lines at start of body
      const bodyIndent = indent + 4;
      const endonEvents: string[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const bl = lines[j].trim();
        if (bl === "") { j++; continue; }
        const blIndent = lines[j].length - lines[j].trimStart().length;
        if (blIndent !== bodyIndent) break;

        const endonM = bl.match(/^self\s+endon\s*\(\s*("[^"]*"|'[^']*')\s*\)\s*$/);
        if (endonM) {
          endonEvents.push(endonM[1]);
          j++;
        } else {
          break;
        }
      }

      if (endonEvents.length > 0) {
        // Emit @endon decorator(s) before def
        result.push(`${indentStr}@endon ${endonEvents.join(", ")}`);
        result.push(lines[i]); // the def line
        // Skip the endon lines in the body
        let skip = i + 1;
        let count = 0;
        while (skip < lines.length && count < endonEvents.length) {
          const bl = lines[skip].trim();
          if (bl === "") { result.push(lines[skip]); skip++; continue; }
          if (bl.match(/^self\s+endon\s*\(\s*("[^"]*"|'[^']*')\s*\)\s*$/)) {
            count++;
            skip++;
          } else {
            break;
          }
        }
        i = skip - 1;
      } else {
        result.push(lines[i]);
      }
      continue;
    }
    result.push(lines[i]);
  }

  // Pass 3: Collapse every, on/once, chance, repeat
  lines = result;
  result = [];
  let idx = 0;
  while (idx < lines.length) {
    const line = lines[idx];
    const stripped = line.trim();
    const indent = line.length - line.trimStart().length;
    const indentStr = " ".repeat(indent);

    // ── every X: — detect while true: + wait X as first body line ──
    if (stripped === "while true:" || stripped === "while true") {
      const { body, nextIdx } = collectIndentedBody(lines, idx + 1, indent);
      if (body.length > 0) {
        const firstBody = body[0].trim();
        const waitMatch = firstBody.match(/^wait\s+(.+)$/);
        if (waitMatch) {
          const waitVal = waitMatch[1];
          // Check if this is actually a waittill pattern (on/once)
          const secondLine = body.length > 0 ? body[0].trim() : "";
          // It's an "every" pattern — wait is the first line
          result.push(`${indentStr}every ${waitVal}:`);
          // Emit rest of body (skip the wait line)
          for (let b = 1; b < body.length; b++) {
            result.push(body[b]);
          }
          idx = nextIdx;
          continue;
        }

        // ── on entity "event": — detect while true: + entity waittill("event", vars) ──
        const waittillMatch = firstBody.match(/^(\w+)\s+wait(?:t)?ill\s*\(\s*("[^"]*"|'[^']*')(?:\s*,\s*([\w,\s]+?))?\s*\)\s*$/);
        if (waittillMatch) {
          const entity = waittillMatch[1];
          const event = waittillMatch[2];
          const vars = (waittillMatch[3] || "").trim();
          const entityPart = entity === "self" ? "" : entity + " ";
          const varsPart = vars ? `, ${vars}` : "";
          result.push(`${indentStr}on ${entityPart}${event}${varsPart}:`);
          for (let b = 1; b < body.length; b++) {
            result.push(body[b]);
          }
          idx = nextIdx;
          continue;
        }
      }
      // Not a sugar pattern — emit as-is
      result.push(line);
      idx++;
      continue;
    }

    // ── once entity "event": — detect standalone entity waittill + indented body ──
    {
      const waittillMatch = stripped.match(/^(\w+)\s+wait(?:t)?ill\s*\(\s*("[^"]*"|'[^']*')(?:\s*,\s*([\w,\s]+?))?\s*\)\s*$/);
      if (waittillMatch) {
        const { body, nextIdx } = collectIndentedBody(lines, idx + 1, indent);
        if (body.length > 0) {
          const entity = waittillMatch[1];
          const event = waittillMatch[2];
          const vars = (waittillMatch[3] || "").trim();
          const entityPart = entity === "self" ? "" : entity + " ";
          const varsPart = vars ? `, ${vars}` : "";
          result.push(`${indentStr}once ${entityPart}${event}${varsPart}:`);
          for (const bl of body) {
            result.push(bl);
          }
          idx = nextIdx;
          continue;
        }
      }
    }

    // ── chance N: — detect if RandomInt(100) < N or if randint(100) minor N ──
    {
      const chanceMatch = stripped.match(/^if\s+(?:RandomInt|randint)\(100\)\s*(?:<|minor)\s*(\d+):?$/);
      if (chanceMatch) {
        const { body, nextIdx } = collectIndentedBody(lines, idx + 1, indent);
        result.push(`${indentStr}chance ${chanceMatch[1]}:`);
        for (const bl of body) {
          result.push(bl);
        }
        idx = nextIdx;
        continue;
      }
    }

    // ── repeat N: — detect for i = 0; i < N; i++ where body doesn't use i ──
    {
      const repeatM = stripped.match(/^for\s+(\w+)\s*=\s*0;\s*\1\s*(?:<|minor)\s*(\d+);\s*\1\+\+:?$/);
      if (repeatM) {
        const varName = repeatM[1];
        const n = repeatM[2];
        const { body, nextIdx } = collectIndentedBody(lines, idx + 1, indent);
        // Check if body uses the variable
        const bodyText = body.map(l => l.trim()).join(" ");
        const varRegex = new RegExp(`\\b${escapeRegex(varName)}\\b`);
        if (!varRegex.test(bodyText)) {
          result.push(`${indentStr}repeat ${n}:`);
          for (const bl of body) {
            result.push(bl);
          }
          idx = nextIdx;
          continue;
        }
      }
    }

    result.push(line);
    idx++;
  }

  return result.join("\n");
}

// ══════════════════════════════════════════════
// FORWARD TRANSPILER: PyGSC → GSC
// ══════════════════════════════════════════════

export interface TranspileResult {
  code: string;
  /** Maps each PyGSC line (0-based index) to its GSC line (0-based index) */
  lineMap: number[];
}

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
  // A line ending with and, or, not, +, -, *, /, =, ==, !=, <, >, <=, >=,
  // comma, ||, &&, minor, inequal, etc. is joined with the next line.
  const rawLines = gscCode.split("\n");
  const joinedLines: string[] = [];
  // Maps each joined line index → array of original line indices
  const joinMap: number[][] = [];
  {
    let i = 0;
    while (i < rawLines.length) {
      let current = rawLines[i];
      const origIndices = [i];
      // Keep joining while the line ends with a continuation operator
      while (i + 1 < rawLines.length) {
        const { cleaned } = extractStrings(current);
        const noComment = cleaned.replace(/#.*$/, "").trimEnd();
        if (/(\b(and|or|not|minor|inequal)\s*$|[+\-*\/=<>,&|!]\s*$)/.test(noComment)) {
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
      if (stripped.endsWith("*/")) inBlockCommentPhase1 = false;
      translatedLines.push(line);
      continue;
    }
    if (inBlockCommentPhase1) {
      if (stripped.endsWith("*/")) inBlockCommentPhase1 = false;
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
  console.log("🔧 SEMICOLON PHASE - new code running");
  let inBlockComment = false;
  for (let i = 0; i < lines.length; i++) {
    const stripped = lines[i].trim();

    // Track block comment state
    if (stripped.includes("/*") || stripped.includes("*/")) {
      console.log(`🔧 BLOCK [${i}]: "${stripped}" inBC=${inBlockComment}`);
    }
    if (!inBlockComment && stripped.startsWith("/*")) {
      inBlockComment = true;
      if (stripped.endsWith("*/")) inBlockComment = false;
      continue;
    }
    if (inBlockComment) {
      if (stripped.endsWith("*/")) inBlockComment = false;
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

// Operator translations done on string-protected text
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
      if (nsMatch && usings[nsMatch[1]]) {
        usedUsings.add(usings[nsMatch[1]]);
      }
    }
  }
  return text;
}

// $-prefixed translations that should work inside strings too
function applyDollarTranslations(text: string): string {
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

  // At this point, API has already translated def → function, autoexec → function autoexec.
  // We just need to handle the structure: strip trailing colon, ensure parens exist.

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

function ensureBracketsWithMap(gscCode: string): { code: string; lineMap: number[] } {
  const lines = gscCode.split("\n");
  const newLines: string[] = [];
  // Maps each input line index to the output line index it ends up at
  const lineMap: number[] = new Array(lines.length);
  const indentSize = 4;
  let previousIndentation = 0;
  let blankBuffer: { inputIdx: number }[] = []; // Buffer blank lines with their source index
  const switchCaseIndentStack: number[] = []; // indent levels of case labels (no brace opened)
  const doBlockIndentStack: number[] = []; // indent levels where a 'do' block was opened

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const stripped = line.trim();

    // Buffer empty lines — don't emit yet
    if (!stripped) {
      blankBuffer.push({ inputIdx: i });
      continue;
    }

    const currentIndentation = Math.floor(
      (line.length - line.trimStart().length) / indentSize
    );

    // Close braces BEFORE emitting buffered blank lines
    const isCaseOrDefault = /^(case\b|default\s*:?)/.test(stripped);
    const isElseBranch = /^(else\b|elif\b|elseif\b)/.test(stripped);
    const isDoWhile = /^while\b/.test(stripped) &&
      doBlockIndentStack.length > 0 &&
      doBlockIndentStack[doBlockIndentStack.length - 1] === currentIndentation;
    let prevIndent = previousIndentation;
    if (isCaseOrDefault) {
      // case/default don't close braces — they're inside the switch block
      prevIndent = currentIndentation;
    } else if (isDoWhile && currentIndentation < prevIndent) {
      // do...while: close inner blocks but stop at do's level + 1
      while (prevIndent > currentIndentation + 1) {
        if (
          switchCaseIndentStack.length > 0 &&
          prevIndent - 1 === switchCaseIndentStack[switchCaseIndentStack.length - 1]
        ) {
          switchCaseIndentStack.pop();
          prevIndent--;
          continue;
        }
        newLines.push(" ".repeat((prevIndent - 1) * indentSize) + "}");
        prevIndent--;
      }
      // Don't close the do block's brace here — it'll be emitted as "} while(...);" below
      prevIndent = currentIndentation;
    } else if (isElseBranch && currentIndentation < prevIndent) {
      // else/elif: close all inner blocks down to this level, then one more
      // for the preceding if/elif block that this else continues
      while (prevIndent > currentIndentation + 1) {
        if (
          switchCaseIndentStack.length > 0 &&
          prevIndent - 1 === switchCaseIndentStack[switchCaseIndentStack.length - 1]
        ) {
          switchCaseIndentStack.pop();
          prevIndent--;
          continue;
        }
        newLines.push(" ".repeat((prevIndent - 1) * indentSize) + "}");
        prevIndent--;
      }
      // Close the if/elif block that this else continues
      newLines.push(" ".repeat(currentIndentation * indentSize) + "}");
      prevIndent = currentIndentation;
    } else {
      while (currentIndentation < prevIndent) {
        // If this level is a switch-case indent (no brace was opened), skip it
        if (
          switchCaseIndentStack.length > 0 &&
          prevIndent - 1 === switchCaseIndentStack[switchCaseIndentStack.length - 1]
        ) {
          switchCaseIndentStack.pop();
          prevIndent--;
          continue;
        }
        newLines.push(" ".repeat((prevIndent - 1) * indentSize) + "}");
        prevIndent--;
      }
    }
    previousIndentation = prevIndent;

    // Now emit buffered blank lines (after closing braces, before current line)
    for (const bl of blankBuffer) {
      lineMap[bl.inputIdx] = newLines.length;
      newLines.push("");
    }
    blankBuffer = [];

    // Extract strings so keywords inside strings don't trigger brace insertion
    const { cleaned } = extractStrings(stripped);
    const commentIndex = cleaned.indexOf("//");

    const matchingKeywords = OPEN_BRACES.filter((kw) => {
      const re = new RegExp(`\\b${escapeRegex(kw)}\\b`);
      return re.test(cleaned) && (commentIndex === -1 || cleaned.indexOf(kw) < commentIndex);
    });

    // Record the mapping before pushing
    lineMap[i] = newLines.length;

    // Detect do...while: if this is a 'while' at the same indent as a pending 'do',
    // close the do block and emit "} while (...);" instead of opening a new block
    if (
      matchingKeywords.includes("while") &&
      doBlockIndentStack.length > 0 &&
      doBlockIndentStack[doBlockIndentStack.length - 1] === currentIndentation
    ) {
      doBlockIndentStack.pop();
      // Close the do block's brace and append while condition with semicolon
      const indentStr = " ".repeat(currentIndentation * indentSize);
      // Remove trailing colon if present, add semicolon
      const whileLine = stripped.replace(/:\s*$/, "");
      newLines.push(indentStr + "} " + whileLine + ";");
      previousIndentation = currentIndentation;
    } else if (matchingKeywords.length > 0 && !stripped.includes("{")) {
      newLines.push(line + " {");
      if (matchingKeywords.includes("switch")) {
        // case/default labels will be at currentIndentation + 1 but don't open braces
        switchCaseIndentStack.push(currentIndentation + 1);
      }
      if (matchingKeywords.includes("do")) {
        doBlockIndentStack.push(currentIndentation);
      }
      previousIndentation = currentIndentation + 1;
    } else {
      newLines.push(line);
      previousIndentation = currentIndentation;
    }
  }

  // Emit any trailing buffered blank lines
  for (const bl of blankBuffer) {
    lineMap[bl.inputIdx] = newLines.length;
    newLines.push("");
  }

  // Close remaining braces
  while (previousIndentation > 0) {
    // Skip switch-case indent levels (no brace to close)
    if (
      switchCaseIndentStack.length > 0 &&
      previousIndentation - 1 === switchCaseIndentStack[switchCaseIndentStack.length - 1]
    ) {
      switchCaseIndentStack.pop();
      previousIndentation--;
      continue;
    }
    newLines.push(" ".repeat((previousIndentation - 1) * indentSize) + "}");
    previousIndentation--;
  }

  return { code: newLines.join("\n"), lineMap };
}

function startsWithAny(text: string, prefixes: string[]): boolean {
  return prefixes.some((p) => text.startsWith(p));
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ══════════════════════════════════════════════
// REVERSE TRANSPILER: GSC → PyGSC
// ══════════════════════════════════════════════

interface ReverseEntry {
  pseudo: string;
  translation: string;
}

let reverseApiMap: ReverseEntry[] = [];

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
      // switch(type) → switch(type): (Pythonic block opener)
      result.push(indentStr + stripped.replace(/;\s*$/, "").replace(/\s*$/, ":"));
      continue;
    }
    if (/^(case\b|default\s*:)/.test(stripped)) {
      // case/default: keep as-is, just remove semicolons
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
  for (const { pseudo, translation } of reverseApiMap) {
    if (!pseudo.startsWith("$")) continue;
    if (!text.includes(translation)) continue;
    const escaped = escapeRegex(translation);
    text = text.replace(new RegExp(escaped, "g"), pseudo);
  }
  // Also handle entries from the main api map
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

const PAREN_KEYWORDS = [
  "if", "else if", "elseif", "elif", "foreach", "for", "while",
];

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

// ══════════════════════════════════════════════
// CUSTOM API MERGING
// ══════════════════════════════════════════════

/**
 * Merge user-defined custom API entries into the transpiler.
 * Custom entries are added under a "custom" category.
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
// LINT / DIAGNOSTICS
// ══════════════════════════════════════════════

export interface LintDiagnostic {
  line: number;       // 1-based
  message: string;
  severity: "warning" | "info" | "error";
}

// Build lookup tables once
let _bo3Lookup: Record<string, Bo3Function> | null = null;
function getBo3Lookup(): Record<string, Bo3Function> {
  if (!_bo3Lookup) _bo3Lookup = bo3Api as Record<string, Bo3Function>;
  return _bo3Lookup;
}

// Case-insensitive BO3 function lookup
let _bo3LowerMap: Map<string, { name: string; fn: Bo3Function }> | null = null;
function getBo3LowerMap(): Map<string, { name: string; fn: Bo3Function }> {
  if (!_bo3LowerMap) {
    _bo3LowerMap = new Map();
    const lookup = getBo3Lookup();
    for (const [name, fn] of Object.entries(lookup)) {
      _bo3LowerMap.set(name.toLowerCase(), { name, fn });
    }
  }
  return _bo3LowerMap;
}

/** Count mandatory params from a Bo3Function's fullAPI signature */
function countBo3Params(fn: Bo3Function): { min: number; max: number } {
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
  // Also count from mandatory/optional fields
  let i = 1;
  while (fn[`mandatory${i}`]) i++;
  const mandatoryCount = Math.max(mandatory, i - 1);
  i = 1;
  while (fn[`optional${i}`]) i++;
  const optionalCount = Math.max(optional, i - 1);
  return { min: mandatoryCount, max: mandatoryCount + optionalCount };
}

/** Count arguments in a function call (respects nested parens and strings) */
function countCallArgs(argsStr: string): number {
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
function extractCallArgs(line: string, funcEndIdx: number): string | null {
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

// Block-opening keywords that require ':'
const BLOCK_KEYWORDS_RE = /^(def|autoexec|if|elif|elseif|else|for|foreach|while|switch|do)\b/;
// Keywords that don't need ':' (waittill, endon, etc.)
const NO_COLON_KEYWORDS = new Set(["case", "default", "break", "continue", "return", "pass", "import", "include", "precache", "fname"]);

// PyGSC API names (flat set for quick lookup)
let _pygscApiFlat: Set<string> | null = null;
function getPygscApiNames(): Set<string> {
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

// PyGSC API translations (for resolving shortcuts to BO3 names)
let _pygscApiTranslations: Map<string, string> | null = null;
function getPygscApiTranslations(): Map<string, string> {
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

export function lint(source: string): LintDiagnostic[] {
  const diagnostics: LintDiagnostic[] = [];
  const bo3Lower = getBo3LowerMap();
  const pygscNames = getPygscApiNames();

  // Join continuation lines (ending with operators) so multi-line
  // conditions are analysed as a single logical line.
  const rawLines = source.split("\n");
  const lines: string[] = [];
  const lineNumMap: number[] = []; // joined index → original 1-based line number
  {
    let i = 0;
    while (i < rawLines.length) {
      let current = rawLines[i];
      const firstLine = i;
      while (i + 1 < rawLines.length) {
        const { cleaned } = extractStrings(current);
        const noComment = cleaned.replace(/#.*$/, "").trimEnd();
        if (/(\b(and|or|not|minor|inequal)\s*$|[+\-*\/=<>,&|!]\s*$)/.test(noComment)) {
          i++;
          current = current.trimEnd() + " " + rawLines[i].trim();
        } else {
          break;
        }
      }
      lines.push(current);
      lineNumMap.push(firstLine + 1); // 1-based
      i++;
    }
  }

  // Track function scopes for waittill/endon analysis
  interface FuncScope {
    name: string;
    startLine: number;
    indent: number;
    hasWaittill: boolean;
    waittillLine: number;
    hasEndon: boolean;
  }

  const funcScopes: FuncScope[] = [];
  let loopDepth = 0; // Track nesting inside loops
  let switchDepth = 0;
  const loopStack: number[] = []; // indent levels of loops
  const switchStack: number[] = [];
  const doIndentStack: number[] = []; // track do block indents for do...while detection

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const stripped = line.trim();
    const lineNum = lineNumMap[i];
    const indent = line.length - line.trimStart().length;

    if (!stripped || stripped.startsWith("#")) continue;

    // Warn about #animtree used directly — should use 'animtree' keyword instead
    if (/\b#animtree\b/.test(stripped)) {
      diagnostics.push({
        line: lineNum,
        message: "Use \"animtree\" instead of \"#animtree\" — the # is treated as a comment",
        severity: "warning",
      });
    }

    // Protect strings for analysis
    const { cleaned } = extractStrings(stripped);

    // ── Track function scopes ──
    const defMatch = cleaned.match(/^(def|autoexec)\s+\w+\s*\([^)]*\)\s*:\s*$/);
    if (defMatch) {
      funcScopes.push({
        name: cleaned.match(/^(?:def|autoexec)\s+(\w+)/)?.[1] || "?",
        startLine: lineNum,
        indent,
        hasWaittill: false,
        waittillLine: 0,
        hasEndon: false,
      });
      loopDepth = 0;
      switchDepth = 0;
      loopStack.length = 0;
      switchStack.length = 0;
    }

    // Close function scopes when indentation returns
    while (funcScopes.length > 0 && indent <= funcScopes[funcScopes.length - 1].indent && !defMatch) {
      const scope = funcScopes.pop()!;
      if (scope.hasWaittill && !scope.hasEndon) {
        diagnostics.push({
          line: scope.waittillLine,
          message: `waittill in "${scope.name}" without endon — potential thread leak`,
          severity: "warning",
        });
      }
      break;
    }

    // ── Track loops and switch for break/continue validation ──
    if (/^do\b/.test(cleaned)) {
      doIndentStack.push(indent);
    }
    if (/^(while|for|foreach|every|repeat|on|do)\b/.test(cleaned)) {
      loopStack.push(indent);
      loopDepth++;
    }
    if (/^switch\b/.test(cleaned)) {
      switchStack.push(indent);
      switchDepth++;
    }
    // Pop loops/switches when indent returns
    while (loopStack.length > 0 && indent <= loopStack[loopStack.length - 1] && !/^(while|for|foreach|every|repeat|on|do)\b/.test(cleaned)) {
      loopStack.pop();
      loopDepth--;
    }
    while (switchStack.length > 0 && indent <= switchStack[switchStack.length - 1] && !/^switch\b/.test(cleaned)) {
      switchStack.pop();
      switchDepth--;
    }

    // Track waittill/endon in current function
    if (funcScopes.length > 0) {
      const scope = funcScopes[funcScopes.length - 1];
      if (/\bwaittill\s*\(/.test(cleaned)) {
        scope.hasWaittill = true;
        if (!scope.waittillLine) scope.waittillLine = lineNum;
      }
      if (/\bendon\s*\(/.test(cleaned)) {
        scope.hasEndon = true;
      }
    }

    // ══════════════════════════════════════════
    // LEVEL 1 CHECKS
    // ══════════════════════════════════════════

    // 1. while true without wait
    if (stripped === "while true:" || stripped === "while true") {
      const { body } = collectIndentedBody(lines, i + 1, indent);
      const hasWait = body.some(l => /\bwait\b/.test(l.trim()));
      if (!hasWait) {
        diagnostics.push({
          line: lineNum,
          message: "\"while true\" without \"wait\" in body — may cause infinite loop",
          severity: "warning",
        });
      }
    }

    // 2. every without body
    if (/^every\s+.+:\s*$/.test(stripped)) {
      const { body } = collectIndentedBody(lines, i + 1, indent);
      if (body.length === 0) {
        diagnostics.push({
          line: lineNum,
          message: "\"every\" block has no body",
          severity: "warning",
        });
      }
    }

    // 3. Missing colon on block-opening keywords
    if (BLOCK_KEYWORDS_RE.test(cleaned)) {
      const firstWord = cleaned.match(/^\w+/)?.[0] || "";
      if (!NO_COLON_KEYWORDS.has(firstWord) && !stripped.endsWith(":")) {
        // Ignore lines that are part of sugar syntax (on, once, every, etc.)
        if (!/^(on|once|every|repeat|chance)\b/.test(cleaned)) {
          // Ignore 'while' that terminates a do...while (no colon needed)
          const isDoWhileEnd = firstWord === "while" &&
            doIndentStack.length > 0 &&
            doIndentStack[doIndentStack.length - 1] === indent;
          if (isDoWhileEnd) {
            doIndentStack.pop();
          } else {
            diagnostics.push({
              line: lineNum,
              message: `"${firstWord}" statement missing trailing ":"`,
              severity: "error",
            });
          }
        }
      }
    }

    // 4. break outside loop/switch
    if (cleaned === "break") {
      if (loopDepth === 0 && switchDepth === 0) {
        diagnostics.push({
          line: lineNum,
          message: "\"break\" outside of loop or switch",
          severity: "error",
        });
      }
    }

    // 5. continue outside loop
    if (cleaned === "continue") {
      if (loopDepth === 0) {
        diagnostics.push({
          line: lineNum,
          message: "\"continue\" outside of loop",
          severity: "error",
        });
      }
    }

    // 6. Unbalanced parentheses
    {
      let depth = 0;
      for (const c of cleaned) {
        if (c === "(") depth++;
        else if (c === ")") depth--;
      }
      if (depth !== 0) {
        diagnostics.push({
          line: lineNum,
          message: depth > 0 ? `${depth} unclosed "("` : `${-depth} unexpected ")"`,
          severity: "error",
        });
      }
    }

    // 7. Empty function body
    if (defMatch) {
      const { body } = collectIndentedBody(lines, i + 1, indent);
      const nonEmpty = body.filter(l => l.trim() !== "" && !l.trim().startsWith("#"));
      if (nonEmpty.length === 0) {
        diagnostics.push({
          line: lineNum,
          message: "Function has no body",
          severity: "info",
        });
      }
    }

    // ══════════════════════════════════════════
    // LEVEL 2 CHECKS — BO3 function validation
    // ══════════════════════════════════════════

    // Find function calls: word( or entity word(
    // Skip: def/autoexec lines, keywords, comments
    if (!defMatch && !BLOCK_KEYWORDS_RE.test(cleaned) && !/^(case|default|break|continue|return)\b/.test(cleaned)) {
      // Match: funcName( or entity funcName(
      const callRegex = /\b([a-zA-Z_]\w*)\s*\(/g;
      let callMatch: RegExpExecArray | null;
      while ((callMatch = callRegex.exec(cleaned)) !== null) {
        const funcName = callMatch[1];
        const funcLower = funcName.toLowerCase();
        const callIdx = callMatch.index + callMatch[0].length - 1; // index of '('

        // Skip language constructs, PyGSC API shortcuts, common keywords
        if (pygscNames.has(funcLower)) continue;
        if (/^(if|while|for|foreach|switch|RandomInt|RandomFloat|Int|Float|Array|IsDefined|IsAlive|IsPlayer|IsString|IsArray|GetDvar|GetDvarInt|GetDvarFloat|GetPlayers|Spawn|SpawnStruct|GetEnt|GetEntArray|GetStruct|GetStructArray|Distance|DistanceSquared|VectorScale|VectorNormalize|AnglesToForward|AnglesToRight|AnglesToUp|BulletTrace|SightTracePassed|abs|min|max|ceil|floor|cos|sin|tan|acos|asin|atan|sqrt|pow|log|exp|tolower|isSubStr|GetSubStr|strtok|int|float|string)$/i.test(funcName)) continue;

        // Skip if preceded by :: (namespace call — handled differently)
        if (callMatch.index >= 2 && cleaned.substring(callMatch.index - 2, callMatch.index) === "::") continue;

        // Check: does entity precede this call? (e.g., "self funcName(" or "player funcName(")
        const beforeCall = cleaned.substring(0, callMatch.index).trim();
        const hasEntity = /\b(self|level|player|entity|zombie|struct|game)\s*$/.test(beforeCall) ||
                          /\w+\s*$/.test(beforeCall);

        // Look up in BO3 API (case-insensitive)
        const bo3Entry = bo3Lower.get(funcLower);
        if (bo3Entry) {
          const { fn } = bo3Entry;

          // Check callOn requirement
          if (fn.callOn && !hasEntity) {
            diagnostics.push({
              line: lineNum,
              message: `"${funcName}" requires calling on ${fn.callOn} (e.g., self ${funcName}(...))`,
              severity: "warning",
            });
          }

          // Check parameter count
          const argsStr = extractCallArgs(cleaned, callIdx);
          if (argsStr !== null) {
            const argCount = argsStr.trim() === "" ? 0 : countCallArgs(argsStr);
            const { min, max } = countBo3Params(fn);
            if (argCount < min) {
              diagnostics.push({
                line: lineNum,
                message: `"${funcName}" expects at least ${min} parameter(s), got ${argCount}`,
                severity: "error",
              });
            } else if (max > 0 && argCount > max) {
              diagnostics.push({
                line: lineNum,
                message: `"${funcName}" expects at most ${max} parameter(s), got ${argCount}`,
                severity: "warning",
              });
            }
          }
        }
      }
    }
  }

  // Check remaining open function scopes (end of file)
  for (const scope of funcScopes) {
    if (scope.hasWaittill && !scope.hasEndon) {
      diagnostics.push({
        line: scope.waittillLine,
        message: `waittill in "${scope.name}" without endon — potential thread leak`,
        severity: "warning",
      });
    }
  }

  return diagnostics;
}

export interface Bo3Function {
  fullAPI: string;
  callOn?: string;
  summary?: string;
  example?: string;
  side?: string;
  [key: string]: string | undefined;
}

/**
 * Returns the BO3 engine API as a record of function name → details.
 */
export function getBo3Api(): Record<string, Bo3Function> {
  return bo3Api as Record<string, Bo3Function>;
}
