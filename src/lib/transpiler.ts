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

const api: PyGscApi = pygscApi as PyGscApi;
const usings: Record<string, string> = usingsMap;

const OPEN_PARENTHESES_WORDS = [
  "if", "elseif", "elif", "else if", "foreach", "for",
  "waittill", "notify", "endon", "while", "#precache",
];

const NO_SEMICOLON = [
  "if", "while", "for", "foreach", "do", "{", "}",
  "function", "func", "elif", "def", "else", "else if",
  "elseif", "#define",
];

const OPEN_BRACES = [
  "function", "if", "while", "for", "else", "foreach",
  "elif", "else if", "elseif", "do",
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
              endonLines.push(`${indentStr}    self endon ${ev}`);
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
      result.push(`${indentStr}while true`);
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
            ? `${indentStr}    ${entity} waittill ${event}, ${varsStr}`
            : `${indentStr}    ${entity} waittill ${event}`;

          const { body, nextIdx } = collectIndentedBody(lines, i + 1, indent);

          if (keyword === "on") {
            result.push(`${indentStr}while true`);
            result.push(waittillLine);
            for (const bl of body) {
              result.push(bl);
            }
          } else {
            // "once" — no while loop, body at same indent as waittill
            const waittillOnce = varsStr
              ? `${indentStr}${entity} waittill ${event}, ${varsStr}`
              : `${indentStr}${entity} waittill ${event}`;
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
      result.push(`${indentStr}if RandomInt(100) < ${n}`);
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
      result.push(`${indentStr}for ${varName} = 0; ${varName} < ${n}; ${varName}++`);
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

  // Pass 1: Collapse @system (REGISTER_SYSTEM_EX → @system)
  for (let i = 0; i < lines.length; i++) {
    const stripped = lines[i].trim();
    const indent = lines[i].length - lines[i].trimStart().length;
    const indentStr = " ".repeat(indent);

    const sysMatch = stripped.match(/^REGISTER_SYSTEM_EX\(\s*("[^"]*"|'[^']*')\s*,\s*&__init__\s*,\s*&__main__\s*,\s*(?:none|undefined)\s*\)$/);
    if (sysMatch) {
      result.push(`${indentStr}@system ${sysMatch[1]}`);
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

        const endonM = bl.match(/^self\s+endon\s+\(?\s*("[^"]*"|'[^']*')\s*\)?\s*$/);
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
          if (bl.match(/^self\s+endon\s+\(?\s*("[^"]*"|'[^']*')\s*\)?\s*$/)) {
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

        // ── on entity "event": — detect while true + entity waittill ──
        // Handle both `entity waittill "event", vars` and `entity waitill ( "event", vars )`
        const waittillMatch = firstBody.match(/^(\w+)\s+wait(?:t)?ill\s+\(?\s*("[^"]*"|'[^']*')(?:\s*,\s*([\w,\s]+?))?\s*\)?\s*$/);
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
      const waittillMatch = stripped.match(/^(\w+)\s+wait(?:t)?ill\s+\(?\s*("[^"]*"|'[^']*')(?:\s*,\s*([\w,\s]+?))?\s*\)?\s*$/);
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
  const usedUsings = new Set<string>();

  let lines = gscCode.split("\n");
  const translatedLines: string[] = [];

  for (let line of lines) {
    // Extract strings to protect them
    const { cleaned, strings } = extractStrings(line);

    let processedClean: string;

    if (cleaned.includes("#")) {
      const hashIdx = cleaned.indexOf("#");
      let mainPart = cleaned.substring(0, hashIdx);
      const commentPart = cleaned.substring(hashIdx + 1);

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
  lines = lines.map((l) => {
    const trimmed = l.trimEnd();
    return trimmed.endsWith(":") ? trimmed.slice(0, -1) : l;
  });

  // Add semicolons (string-safe)
  for (let i = 0; i < lines.length; i++) {
    const stripped = lines[i].trim();
    if (
      stripped &&
      !startsWithAny(stripped, NO_SEMICOLON) &&
      !stripped.endsWith(";") &&
      !stripped.endsWith("{") &&
      !stripped.endsWith("}")
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
  let lineMap = bracketResult.lineMap;

  // Add #using lines at the top — offset the line map
  if (usedUsings.size > 0) {
    const usingLines = Array.from(usedUsings);
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

  // Match: def [autoexec] name(params): or def [autoexec] name():
  const match = stripped.match(
    /^(def|function)\s+(autoexec\s+)?(\w+)\s*\(([^)]*)\)\s*:\s*$/i
  );
  if (match) {
    const autoexec = match[2] ? "autoexec " : "";
    const funcName = match[3];
    const params = match[4].trim();
    return `function ${autoexec}${funcName}(${params})`;
  }

  // Match: def [autoexec] name: (no params, just colon)
  const noParamsMatch = stripped.match(
    /^(def|function)\s+(autoexec\s+)?(\w+)\s*:\s*$/i
  );
  if (noParamsMatch) {
    const autoexec = noParamsMatch[2] ? "autoexec " : "";
    const funcName = noParamsMatch[3];
    return `function ${autoexec}${funcName}()`;
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
  lineBeforeComment = lineBeforeComment.replace(/:\s*$/, "");

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
    let prevIndent = previousIndentation;
    while (currentIndentation < prevIndent) {
      newLines.push(" ".repeat((prevIndent - 1) * indentSize) + "}");
      prevIndent--;
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

    if (matchingKeywords.length > 0 && !stripped.includes("{")) {
      newLines.push(line + " {");
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

const reverseApiMap: ReverseEntry[] = [];
for (const category of Object.values(api)) {
  for (const [pseudo, details] of Object.entries(category)) {
    if (details.translation && details.translation !== pseudo) {
      // Skip operator entries (handled separately)
      if (["or", "and", "not", "none", "None"].includes(pseudo.trim())) continue;
      reverseApiMap.push({ pseudo, translation: details.translation });
    }
  }
}
reverseApiMap.sort((a, b) => b.translation.length - a.translation.length);

export function reverseTranspile(gscCode: string): string {
  // Normalize tabs to 4 spaces
  gscCode = gscCode.replace(/\t/g, "    ");

  let lines = gscCode.split("\n");

  // Remove #using lines
  lines = lines.filter((l) => !l.trim().startsWith("#using "));
  while (lines.length > 0 && lines[0].trim() === "") lines.shift();

  // Remove braces and preserve original indentation
  lines = removeBracesAndIndent(lines);

  const result: string[] = [];
  for (let line of lines) {
    const indent = line.length - line.trimStart().length;
    const indentStr = " ".repeat(indent);
    let stripped = line.trim();

    if (!stripped) { result.push(""); continue; }

    // Keep preprocessor directives as-is (but convert // to #)
    if (stripped.startsWith("#insert") || stripped.startsWith("#precache") || stripped.startsWith("#define")) {
      result.push(indentStr + stripped);
      continue;
    }

    // Keep macro calls like REGISTER_SYSTEM_EX as-is
    if (/^[A-Z_]+\s*\(/.test(stripped)) {
      result.push(indentStr + stripped.replace(/;\s*$/, ""));
      continue;
    }

    // Keep switch/case/break/default as-is (just remove semicolons)
    if (/^(switch|case |default:)/.test(stripped)) {
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

  // Normalize indentation: find the minimum non-zero indent and use it as base
  // This handles cases where GSC uses tab-based indent (converted to spaces)
  let minIndent = Infinity;
  for (const line of result) {
    if (!line.trim()) continue;
    const indent = line.length - line.trimStart().length;
    if (indent > 0 && indent < minIndent) minIndent = indent;
  }

  // If the base indent unit isn't 4, normalize to 4-space indents
  if (minIndent !== Infinity && minIndent !== 4) {
    const normalized: string[] = [];
    for (const line of result) {
      if (!line.trim()) { normalized.push(""); continue; }
      const indent = line.length - line.trimStart().length;
      const level = Math.round(indent / minIndent);
      normalized.push(" ".repeat(level * 4) + line.trim());
    }
    return normalized;
  }

  return result;
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
  "waittill", "notify", "endon",
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
// LINT / DIAGNOSTICS
// ══════════════════════════════════════════════

export interface LintDiagnostic {
  line: number;       // 1-based
  message: string;
  severity: "warning" | "info";
}

export function lint(source: string): LintDiagnostic[] {
  const diagnostics: LintDiagnostic[] = [];
  const lines = source.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const stripped = lines[i].trim();
    const lineNum = i + 1;

    // Warning: while true without wait in body → possible infinite loop
    if (stripped === "while true:" || stripped === "while true") {
      const indent = lines[i].length - lines[i].trimStart().length;
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

    // Warning: every X: without wait in body (after expansion the wait is auto-added,
    // but if someone writes every without a body that's weird)
    if (/^every\s+.+:\s*$/.test(stripped)) {
      const indent = lines[i].length - lines[i].trimStart().length;
      const { body } = collectIndentedBody(lines, i + 1, indent);
      if (body.length === 0) {
        diagnostics.push({
          line: lineNum,
          message: "\"every\" block has no body",
          severity: "warning",
        });
      }
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
