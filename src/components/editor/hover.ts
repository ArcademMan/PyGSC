import * as monaco from "monaco-editor";
import { getApiData, getBo3Api } from "../../lib/transpiler";

export function createHoverProvider(): monaco.languages.HoverProvider {
  return {
    provideHover(model, position) {
      const word = model.getWordAtPosition(position);
      if (!word) return null;
      const token = word.word;

      // Check Syntax Sugar keywords
      const sugarDocs: Record<string, string> = {
        every: "**every** `<interval>`**:**\n\nPolling loop. Expands to:\n```\nwhile true\n    wait <interval>\n    ...\n```",
        on: "**on** `[entity]` `\"event\"`, `vars`**:**\n\nWaittill loop. Expands to:\n```\nwhile true\n    entity waittill \"event\", vars\n    ...\n```",
        once: "**once** `[entity]` `\"event\"`**:**\n\nSingle waittill. Expands to:\n```\nentity waittill \"event\"\n...\n```",
        repeat: "**repeat** `<N>`**:**\n\nCount loop. Expands to:\n```\nfor i = 0; i < N; i++\n    ...\n```",
        chance: "**chance** `<N>`**:**\n\nRandom check (0-100). Expands to:\n```\nif RandomInt(100) < N\n    ...\n```",
      };
      if (sugarDocs[token]) {
        return {
          range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
          contents: [{ value: sugarDocs[token] }],
        };
      }

      // Check decorators (@endon, @system) - look at the full line text
      const lineText = model.getLineContent(position.lineNumber).trim();
      if (lineText.startsWith("@endon")) {
        return {
          range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
          contents: [{ value: "**@endon** `\"event1\"`, `\"event2\"`\n\nDecorator: inserts `self endon \"event\"` lines at the start of the next function body." }],
        };
      }
      if (lineText.startsWith("@system")) {
        return {
          range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
          contents: [{ value: "**@system** `\"name\"`\n\nDecorator: inserts `REGISTER_SYSTEM_EX( \"name\", &__init__, &__main__, none )` before the script." }],
        };
      }

      // Check PyGSC API
      const apiData = getApiData();
      for (const [category, entries] of Object.entries(apiData)) {
        for (const [key, val] of Object.entries(entries)) {
          if (key.trim().toLowerCase() === token.toLowerCase()) {
            const lines = [
              `**${key}** → \`${val.translation}\``,
              "",
              val.summary || "",
              val.fullAPI ? `\n**Syntax:** \`${val.fullAPI}\`` : "",
              val.example ? `\n**Example:** \`${val.example}\`` : "",
              `\n*Category: ${category}*`,
            ];
            // Add mandatory/optional params
            for (const [k, v] of Object.entries(val)) {
              if (k.startsWith("mandatory") && v) lines.push(`\n- 🔴 ${v}`);
              if (k.startsWith("optional") && v) lines.push(`\n- 🔵 ${v}`);
            }
            return {
              range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
              contents: [{ value: lines.filter(Boolean).join("\n") }],
            };
          }
        }
      }

      // Check BO3 API
      const bo3Data = getBo3Api();
      if (bo3Data[token]) {
        const fn = bo3Data[token];
        const lines = [
          `**${token}** — BO3 Engine${fn.side ? ` (${fn.side})` : ""}`,
          "",
          fn.summary || "",
          fn.fullAPI ? `\n**Signature:** \`${fn.fullAPI}\`` : "",
          fn.callOn ? `\n**Call on:** ${fn.callOn}` : "",
          fn.example ? `\n**Example:** \`${fn.example}\`` : "",
        ];
        return {
          range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
          contents: [{ value: lines.filter(Boolean).join("\n") }],
        };
      }

      return null;
    },
  };
}
