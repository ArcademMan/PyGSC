export const STRING_PLACEHOLDER_PREFIX = "\x00STR_";

export function extractStrings(text: string): { cleaned: string; strings: string[] } {
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

export function restoreStrings(text: string, strings: string[]): string {
  return text.replace(/\x00STR_(\d+)\x00/g, (_, idx) => strings[parseInt(idx)]);
}
