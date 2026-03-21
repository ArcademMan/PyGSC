import { extractStrings } from "./strings";
import { OPEN_BRACES } from "./constants";
import { escapeRegex } from "./utils";

export function ensureBracketsWithMap(gscCode: string): { code: string; lineMap: number[] } {
  const lines = gscCode.split("\n");
  const newLines: string[] = [];
  // Maps each input line index to the output line index it ends up at
  const lineMap: number[] = new Array(lines.length);
  const indentSize = 4;
  let previousIndentation = 0;
  let blankBuffer: { inputIdx: number }[] = []; // Buffer blank lines with their source index
  const switchCaseIndentStack: number[] = []; // indent levels of case labels (no brace opened)
  const doBlockIndentStack: number[] = []; // indent levels where a 'do' block was opened

  let inBlockCommentBrackets = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const stripped = line.trim();

    // Buffer empty lines — don't emit yet
    if (!stripped) {
      blankBuffer.push({ inputIdx: i });
      continue;
    }

    // Pass block comments through without brace insertion
    if (!inBlockCommentBrackets && stripped.startsWith("/*")) {
      inBlockCommentBrackets = true;
      for (const bl of blankBuffer) { lineMap[bl.inputIdx] = newLines.length; newLines.push(""); }
      blankBuffer = [];
      lineMap[i] = newLines.length;
      newLines.push(line);
      if (stripped.includes("*/")) inBlockCommentBrackets = false;
      continue;
    }
    if (inBlockCommentBrackets) {
      for (const bl of blankBuffer) { lineMap[bl.inputIdx] = newLines.length; newLines.push(""); }
      blankBuffer = [];
      lineMap[i] = newLines.length;
      newLines.push(line);
      if (stripped.includes("*/")) inBlockCommentBrackets = false;
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
      const indentStr = " ".repeat(currentIndentation * indentSize);
      const whileLine = stripped.replace(/:\s*$/, "");
      newLines.push(indentStr + "} " + whileLine + ";");
      previousIndentation = currentIndentation;
    } else if (matchingKeywords.length > 0 && !stripped.includes("{")) {
      newLines.push(line + " {");
      if (matchingKeywords.includes("switch")) {
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
