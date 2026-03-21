import type * as monaco from "monaco-editor";

export function getGscTokensProvider(bo3Names: string[]): monaco.languages.IMonarchLanguage {
  return {
    bo3Api: bo3Names,
    tokenizer: {
      root: [
        [/\/\*/, { token: "comment", next: "@blockComment" }],
        [/\/\/.*$/, "comment"],
        [/#using\b.*$/, "keyword.using"],
        [/#precache\b.*$/, "keyword.using"],
        [/#define\b/, "keyword.using"],
        [/#namespace\b/, "keyword.using"],
        [/#using_animtree\b.*$/, "keyword.using"],
        [/REGISTER_SYSTEM_EX\b/, "keyword.using"],
        [/"[^"]*"/, "string"],
        [/'[^']*'/, "string"],
        [/\b\d+\.\d+\b/, "number.float"],
        [/\b\d+\b/, "number"],
        [/\b(self|level|game)\b/, "variable.language"],
        [/\b(true|false|undefined)\b/, "constant.language"],
        [/\b(function|autoexec)\b/, { token: "keyword", next: "@funcName" }],
        [/\b(if|else|for|foreach|while|do|return|continue|break|wait|switch|case|default)\b/, "keyword"],
        [/\b(thread|waittill|endon|notify|isdefined)\b/, "keyword.gsc"],
        [/&\w+/, "function.reference"],
        [/\w+::/, "namespace"],
        [/[a-zA-Z_]\w*/, { cases: { "@bo3Api": "bo3.api", "@default": { token: "@rematch", next: "@identOrFunc" } } }],
        [/\(/, { token: "delimiter.bracket", next: "@parens" }],
        [/[{})\[\]]/, "delimiter.bracket"],
        [/[;,.]/, "delimiter"],
        [/[=!<>]=?/, "operator"],
        [/[+\-*/%]/, "operator"],
        [/&&|\|\|/, "operator"],
      ],
      blockComment: [
        [/\*\//, { token: "comment", next: "@pop" }],
        [/./, "comment"],
      ],
      parens: [
        [/\)/, { token: "delimiter.bracket", next: "@pop" }],
        [/\/\/.*$/, "comment"],
        [/"[^"]*"/, "string"],
        [/'[^']*'/, "string"],
        [/\b\d+\.\d+\b/, "number.float"],
        [/\b\d+\b/, "number"],
        [/\b(self|level|game)\b/, "variable.language"],
        [/\b(true|false|undefined)\b/, "constant.language"],
        [/\b(thread|waittill|endon|notify|isdefined)\b/, "keyword.gsc"],
        [/&\w+/, "function.reference"],
        [/\(/, { token: "delimiter.bracket", next: "@parens" }],
        [/[a-zA-Z_]\w*/, "variable.parameter"],
        [/[,.]/, "delimiter"],
        [/[=!<>]=?/, "operator"],
        [/[+\-*/%]/, "operator"],
        [/&&|\|\|/, "operator"],
      ],
      identOrFunc: [
        [/[a-zA-Z_]\w*(?=\s*\()/, { token: "function.call", next: "@pop" }],
        [/[a-zA-Z_]\w*/, { token: "identifier", next: "@pop" }],
      ],
      funcName: [
        [/[a-zA-Z_]\w*/, { token: "function.declaration", next: "@pop" }],
        [/\s+/, ""],
        [/./, { token: "", next: "@pop" }],
      ],
    },
  } as unknown as monaco.languages.IMonarchLanguage;
}

export function getGscLanguageConfig(): monaco.languages.LanguageConfiguration {
  return {
    comments: { lineComment: "//" },
    brackets: [["{", "}"], ["(", ")"], ["[", "]"]],
  };
}
