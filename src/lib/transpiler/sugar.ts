import { extractStrings, restoreStrings } from "./strings";
import { escapeRegex } from "./utils";

/**
 * Collects all contiguous lines after `startIdx` that have indent > baseIndent.
 * Returns the body lines and the index of the first non-body line.
 */
export function collectIndentedBody(lines: string[], startIdx: number, baseIndent: number): { body: string[]; nextIdx: number } {
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
