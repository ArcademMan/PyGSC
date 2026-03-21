/**
 * Detects the indent unit used in the source and normalizes
 * all indentation to 4 spaces per level.
 */
export function normalizeIndentation(source: string): string {
  const lines = source.split("\n");

  // Find the smallest non-zero indentation (the indent unit)
  let minIndent = Infinity;
  for (const line of lines) {
    if (!line.trim()) continue;
    const indent = line.length - line.trimStart().length;
    if (indent > 0 && indent < minIndent) minIndent = indent;
  }

  // Already 4-space or no indentation found — nothing to do
  if (minIndent === Infinity || minIndent === 4) return source;

  const result: string[] = [];
  for (const line of lines) {
    if (!line.trim()) { result.push(line); continue; }
    const indent = line.length - line.trimStart().length;
    const level = Math.round(indent / minIndent);
    result.push(" ".repeat(level * 4) + line.trim());
  }
  return result.join("\n");
}
