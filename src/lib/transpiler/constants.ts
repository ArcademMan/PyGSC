export const OPEN_PARENTHESES_WORDS = [
  "if", "elseif", "elif", "else if", "foreach", "for",
  "while",
];

export const NO_SEMICOLON = [
  "if", "while", "for", "foreach", "do", "{", "}",
  "function", "func", "elif", "else", "else if",
  "elseif", "#define", "switch", "case", "default",
  "/*", "*/", "REGISTER_SYSTEM_EX",
];

export const OPEN_BRACES = [
  "function", "if", "while", "for", "else", "foreach",
  "elif", "else if", "elseif", "do", "switch",
];

export const PAREN_KEYWORDS = [
  "if", "else if", "elseif", "elif", "foreach", "for", "while",
];

// Block-opening keywords that require ':'
export const BLOCK_KEYWORDS_RE = /^(def|autoexec|if|elif|elseif|else|for|foreach|while|switch|do)\b/;
// Keywords that don't need ':' (waittill, endon, etc.)
export const NO_COLON_KEYWORDS = new Set(["case", "default", "break", "continue", "return", "pass", "import", "include", "precache", "fname"]);
