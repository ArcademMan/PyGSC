import { extractStrings } from "./strings";
import { collectIndentedBody } from "./sugar";
import { getBo3LowerMap, getPygscApiNames, countBo3Params, countCallArgs, extractCallArgs } from "./state";
import { BLOCK_KEYWORDS_RE, NO_COLON_KEYWORDS } from "./constants";
import type { LintDiagnostic } from "./types";

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
        // Check if parentheses/brackets are unclosed
        let parenDepth = 0;
        for (const c of cleaned) {
          if (c === "(" || c === "[") parenDepth++;
          else if (c === ")" || c === "]") parenDepth--;
        }
        if (parenDepth > 0 || /(\b(and|or|not|minor|inequal)\s*$|(?<![+\-])[+\-*\/=<>,&|!]\s*$)/.test(noComment)) {
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
