export function startsWithAny(text: string, prefixes: string[]): boolean {
  return prefixes.some((p) => {
    if (!text.startsWith(p)) return false;
    // Ensure it's a whole word — next char must be non-word or end of string
    const next = text[p.length];
    return next === undefined || /\W/.test(next);
  });
}

export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
