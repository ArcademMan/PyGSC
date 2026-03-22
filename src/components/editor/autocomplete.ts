import * as monaco from "monaco-editor";
import { getApiData, getBo3Api } from "../../lib/transpiler";
import { getAvailableNamespaces, getFunctionsForNamespace } from "../../lib/language-service";

export function createCompletionProvider(pygscMode: boolean = true): monaco.languages.CompletionItemProvider {
  return {
    triggerCharacters: [".", ":"],
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      // ── Namespace member completion: detect "name::" before cursor ──
      const lineContent = model.getLineContent(position.lineNumber);
      const textBefore = lineContent.substring(0, position.column - 1);
      const nsMatch = textBefore.match(/\b([a-zA-Z_]\w*)::$/);
      if (nsMatch) {
        const ns = nsMatch[1];
        const fns = getFunctionsForNamespace(ns);
        const nsSuggestions: monaco.languages.CompletionItem[] = [];
        for (const fn of fns) {
          let insertText = fn.name;
          if (fn.params.length > 0) {
            const parts = fn.params.map((p, i) => `\${${i + 1}:${p}}`);
            insertText = fn.name + "(" + parts.join(", ") + ")";
          } else {
            insertText = fn.name + "()";
          }
          nsSuggestions.push({
            label: fn.name,
            kind: monaco.languages.CompletionItemKind.Function,
            insertText,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            range,
            detail: `${fn.kind} ${fn.name}(${fn.params.join(", ")})`,
            documentation: { value: `**${ns}::${fn.name}**(${fn.params.join(", ")})` },
            sortText: "0" + fn.name, // prioritize these suggestions
          });
        }
        if (nsSuggestions.length > 0) return { suggestions: nsSuggestions };
      }

      const suggestions: monaco.languages.CompletionItem[] = [];
      const seen = new Set<string>();

      // ── Namespace suggestions: offer "name::" completions ──
      for (const ns of getAvailableNamespaces()) {
        const key = ns.label + "::";
        if (seen.has(key)) continue;
        seen.add(key);
        suggestions.push({
          label: key,
          kind: monaco.languages.CompletionItemKind.Module,
          insertText: key,
          range,
          detail: `→ ${ns.fileName}`,
          documentation: { value: `Namespace **${ns.label}** — access functions from \`${ns.fileName}\`` },
          sortText: "1" + ns.label,
        });
      }

      if (pygscMode) {
        // PyGSC keywords (with Pythonic snippets for block-opening keywords)
        const blockKeywords = [
          { label: "def", insertText: "def ${1:name}(${2:params}):", detail: "Function definition" },
          { label: "autoexec", insertText: "autoexec ${1:name}(${2:params}):", detail: "Autoexec function" },
          { label: "if", insertText: "if ${1:condition}:", detail: "If statement" },
          { label: "elif", insertText: "elif ${1:condition}:", detail: "Else-if statement" },
          { label: "elseif", insertText: "elseif ${1:condition}:", detail: "Else-if statement" },
          { label: "else", insertText: "else:", detail: "Else statement" },
          { label: "for", insertText: "for ${1:var} in ${2:array}:", detail: "For loop" },
          { label: "foreach", insertText: "foreach ${1:var} in ${2:array}:", detail: "Foreach loop" },
          { label: "while", insertText: "while ${1:condition}:", detail: "While loop" },
          { label: "do", insertText: "do:", detail: "Do block" },
        ];
        for (const bk of blockKeywords) {
          if (seen.has(bk.label)) continue;
          seen.add(bk.label);
          suggestions.push({
            label: bk.label,
            kind: monaco.languages.CompletionItemKind.Keyword,
            insertText: bk.insertText,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            range,
            detail: bk.detail,
          });
        }

        const simpleKeywords = ["in", "return", "continue", "break", "pass"];
        for (const kw of simpleKeywords) {
          if (seen.has(kw)) continue;
          seen.add(kw);
          suggestions.push({
            label: kw,
            kind: monaco.languages.CompletionItemKind.Keyword,
            insertText: kw,
            range,
            detail: "PyGSC keyword",
          });
        }
      } else {
        // GSC-native keywords with C-style snippets
        const gscBlockKeywords = [
          { label: "function", insertText: "function ${1:name}(${2:params})\n{\n\t${0}\n}", detail: "Function definition" },
          { label: "function autoexec", insertText: "function autoexec ${1:name}()\n{\n\t${0}\n}", detail: "Autoexec function" },
          { label: "if", insertText: "if(${1:condition})\n{\n\t${0}\n}", detail: "If statement" },
          { label: "else if", insertText: "else if(${1:condition})\n{\n\t${0}\n}", detail: "Else-if statement" },
          { label: "else", insertText: "else\n{\n\t${0}\n}", detail: "Else statement" },
          { label: "for", insertText: "for(${1:init}; ${2:condition}; ${3:increment})\n{\n\t${0}\n}", detail: "For loop" },
          { label: "foreach", insertText: "foreach(${1:var} in ${2:array})\n{\n\t${0}\n}", detail: "Foreach loop" },
          { label: "while", insertText: "while(${1:condition})\n{\n\t${0}\n}", detail: "While loop" },
          { label: "switch", insertText: "switch(${1:value})\n{\n\tcase ${2:val}:\n\t\t${0}\n\t\tbreak;\n}", detail: "Switch statement" },
        ];
        for (const bk of gscBlockKeywords) {
          if (seen.has(bk.label)) continue;
          seen.add(bk.label);
          suggestions.push({
            label: bk.label,
            kind: monaco.languages.CompletionItemKind.Keyword,
            insertText: bk.insertText,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            range,
            detail: bk.detail,
          });
        }

        const gscSimpleKeywords = ["return", "continue", "break", "case", "default"];
        for (const kw of gscSimpleKeywords) {
          if (seen.has(kw)) continue;
          seen.add(kw);
          suggestions.push({
            label: kw,
            kind: monaco.languages.CompletionItemKind.Keyword,
            insertText: kw,
            range,
            detail: "GSC keyword",
          });
        }
      }

      // GSC keywords (common to both modes)
      const gscKw = [
        "thread", "thr", "waittill", "endon", "notify", "wait",
        "isdefined", "precache", "using_animtree", "self", "level", "game",
        "true", "false", "none",
      ];
      for (const kw of gscKw) {
        if (seen.has(kw)) continue;
        seen.add(kw);
        suggestions.push({
          label: kw,
          kind: monaco.languages.CompletionItemKind.Keyword,
          insertText: kw,
          range,
          detail: "GSC keyword",
        });
      }

      if (pygscMode) {
        // Syntax Sugar keywords (with snippets)
        const sugarSnippets = [
          { label: "every", detail: "Polling loop → while true + wait", insertText: "every ${1:0.05}:\n\t${0}" },
          { label: "on", detail: "Waittill loop → while true + waittill", insertText: "on ${1:self} \"${2:event}\", ${3:var}:\n\t${0}" },
          { label: "once", detail: "Single waittill → waittill + body", insertText: "once ${1:self} \"${2:event}\":\n\t${0}" },
          { label: "repeat", detail: "Count loop → for i = 0; i < N; i++", insertText: "repeat ${1:5}:\n\t${0}" },
          { label: "chance", detail: "Random check → if RandomInt(100) < N", insertText: "chance ${1:30}:\n\t${0}" },
          { label: "@endon", detail: "Decorator → self endon at function start", insertText: "@endon \"${1:disconnect}\"\n" },
          { label: "@system", detail: "System registration → REGISTER_SYSTEM_EX", insertText: "@system \"${1:system_name}\"\n" },
        ];
        for (const s of sugarSnippets) {
          if (seen.has(s.label)) continue;
          seen.add(s.label);
          suggestions.push({
            label: s.label,
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText: s.insertText,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            range,
            detail: s.detail,
            documentation: { value: `**${s.label}** — PyGSC syntax sugar\n\n${s.detail}` },
          });
        }

        // Operators
        const ops = [
          { label: "or", detail: "→ ||" },
          { label: "and", detail: "→ &&" },
          { label: "not", detail: "→ !" },
        ];
        for (const op of ops) {
          if (seen.has(op.label)) continue;
          seen.add(op.label);
          suggestions.push({
            label: op.label,
            kind: monaco.languages.CompletionItemKind.Operator,
            insertText: op.label,
            range,
            detail: op.detail,
          });
        }

        // PyGSC API shortcuts
        const apiData = getApiData();
        for (const [category, entries] of Object.entries(apiData)) {
          for (const [key, val] of Object.entries(entries)) {
            if (seen.has(key.trim())) continue;
            if (["#"].includes(key.trim())) continue;
            seen.add(key.trim());

            let insertText = key;
            let detail = `→ ${val.translation}`;

            if (val.fullAPI && val.fullAPI.includes("(")) {
              const match = val.fullAPI.match(/\(([^)]*)\)/);
              if (match) {
                const params = match[1];
                if (params) {
                  const parts = params.split(",").map((p, i) => `\${${i + 1}:${p.trim()}}`);
                  insertText = key + "(" + parts.join(", ") + ")";
                } else {
                  insertText = key + "()";
                }
              }
            }

            suggestions.push({
              label: key,
              kind: monaco.languages.CompletionItemKind.Function,
              insertText,
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              range,
              detail,
              documentation: {
                value: [
                  val.summary || "",
                  val.example ? `\n**Example:** \`${val.example}\`` : "",
                  `\n**Category:** ${category}`,
                ].filter(Boolean).join("\n"),
              },
            });
          }
        }
      }

      // BO3 Engine functions
      const bo3Data = getBo3Api();
      for (const [name, details] of Object.entries(bo3Data)) {
        if (seen.has(name)) continue;
        seen.add(name);
        let insertText = name;
        if (details.fullAPI && details.fullAPI.includes("(")) {
          const match = details.fullAPI.match(/\(([^)]*)\)/);
          if (match) {
            const params = match[1];
            if (params) {
              const parts = params.split(",").map((p, i) => `\${${i + 1}:${p.trim()}}`);
              insertText = name + "(" + parts.join(", ") + ")";
            } else {
              insertText = name + "()";
            }
          }
        }

        suggestions.push({
          label: name,
          kind: monaco.languages.CompletionItemKind.Method,
          insertText,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range,
          detail: details.side ? `BO3 ${details.side}` : "BO3 Engine",
          documentation: {
            value: [
              details.summary || "",
              details.callOn ? `\n**Call on:** ${details.callOn}` : "",
              details.example ? `\n**Example:** \`${details.example}\`` : "",
              details.fullAPI ? `\n**Signature:** \`${details.fullAPI}\`` : "",
            ].filter(Boolean).join("\n"),
          },
        });
      }

      return { suggestions };
    },
  };
}
