import type * as monaco from "monaco-editor";

export function getPygscTokensProvider(bo3Names: string[]): monaco.languages.IMonarchLanguage {
  return {
    bo3Api: bo3Names,
    tokenizer: {
      root: [
        [/\/\*/, { token: "comment", next: "@blockComment" }],
        [/#.*$/, "comment"],
        [/"[^"]*"/, "string"],
        [/'[^']*'/, "string"],
        [/\b\d+\.\d+\b/, "number.float"],
        [/\b\d+\b/, "number"],
        [/\b(self|level|game)\b/, "variable.language"],
        [/\b(true|false|none|None|undefined)\b/, "constant.language"],
        [/@(endon|system)\b/, "decorator"],
        [/\b(every|on|once|repeat|chance)\b(?=\s+.*:)/, "keyword.sugar"],
        [/\b(def|autoexec)\b/, { token: "keyword", next: "@funcName" }],
        [/\b(if|elif|elseif|else|for|foreach|while|do|in|return|continue|break|pass|function|import|include|fname|not)\b/, "keyword"],
        [/\b(thread|thr|waittill|waitill|endon|notify|end|isdefined|wait)\b/, "keyword.gsc"],
        [/#precache\b/, "keyword.gsc"],
        [/\bprecache\b/, "keyword.gsc"],
        [/\busing_animtree\b/, "keyword.gsc"],
        [/\b(givepoints|takepoints|getstructs|getstruct|giveweapon|spawnmodel|print|jplayfx|jfloatme|jspinme|maketrigger|randomize|burn|jteleporthere|wait_blackscreen|wait_any|zombie_death_cb|actor_damage_cb|on_spawned_cb|player_damage_cb|on_connect_cb|removepowerups|flaginit|flagset|flagwait|flagclear|getent|getents|playsound|loopsound|stopsound|randint|randfloat)\b/, "pygsc.api"],
        [/\$\w+/, "pygsc.api"],
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
      parens: [
        [/\)/, { token: "delimiter.bracket", next: "@pop" }],
        [/#.*$/, "comment"],
        [/"[^"]*"/, "string"],
        [/'[^']*'/, "string"],
        [/\b\d+\.\d+\b/, "number.float"],
        [/\b\d+\b/, "number"],
        [/\b(self|level|game)\b/, "variable.language"],
        [/\b(true|false|none|None|undefined)\b/, "constant.language"],
        [/\b(if|elif|else|in|return|not)\b/, "keyword"],
        [/\b(thread|thr|waittill|waitill|endon|notify|end|isdefined|wait)\b/, "keyword.gsc"],
        [/&\w+/, "function.reference"],
        [/\$\w+/, "pygsc.api"],
        [/\(/, { token: "delimiter.bracket", next: "@parens" }],
        [/[a-zA-Z_]\w*/, "variable.parameter"],
        [/[,.]/, "delimiter"],
        [/[=!<>]=?/, "operator"],
        [/[+\-*/%]/, "operator"],
        [/&&|\|\|/, "operator"],
      ],
      blockComment: [
        [/\*\//, { token: "comment", next: "@pop" }],
        [/./, "comment"],
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

export function getPygscLanguageConfig(monacoInstance: typeof import("monaco-editor")): monaco.languages.LanguageConfiguration {
  return {
    comments: { lineComment: "#" },
    brackets: [["(", ")"], ["[", "]"]],
    autoClosingPairs: [
      { open: "(", close: ")" },
      { open: "[", close: "]" },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
    ],
    indentationRules: {
      increaseIndentPattern: /^.*:\s*(#.*)?$/,
      decreaseIndentPattern: /^\s*(elif|elseif|else)\b.*$/,
    },
    onEnterRules: [
      {
        beforeText: /^.*:\s*(#.*)?$/,
        action: { indentAction: monacoInstance.languages.IndentAction.Indent },
      },
    ],
  };
}
