const WIDTH_2_GLYPHS = new Set([
  "⚡", "⏱",
  "◐",                           // legacy spinner frame (kept for row layout glyphs.ts)
  "◜", "◝", "◞", "◟",            // arc spinner frames (Hush)
  "✓", "▸", "▹",
]);

export function wcwidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    if (WIDTH_2_GLYPHS.has(ch)) { w += 2; continue; }
    const cp = ch.codePointAt(0) ?? 0;
    if (cp >= 0x1F300 && cp <= 0x1FAFF) { w += 2; continue; } // emoji ranges
    if (cp >= 0xFE30 && cp <= 0xFE4F) { w += 2; continue; }
    if (cp >= 0x2E80 && cp <= 0x303E) { w += 2; continue; }
    if (cp >= 0x3041 && cp <= 0x33FF) { w += 2; continue; }
    if (cp >= 0x3400 && cp <= 0x4DBF) { w += 2; continue; }
    if (cp >= 0x4E00 && cp <= 0x9FFF) { w += 2; continue; }
    if (cp >= 0xAC00 && cp <= 0xD7A3) { w += 2; continue; }
    w += 1;
  }
  return w;
}

// Matches CSI sequences (\x1b[...m for SGR/color) AND OSC 8 hyperlinks
// (\x1b]8;;URL\x07TEXT\x1b]8;;\x07). Both must be excluded from visible-width
// calculations so width-aware truncation does not slice mid-escape.
const ANSI_RE = /\x1b\[[0-9;]*m|\x1b\]8;;[^\x07]*\x07/g;
const ANSI_AT_START_RE = /^(?:\x1b\[[0-9;]*m|\x1b\]8;;[^\x07]*\x07)/;

export function visibleWidth(s: string): number {
  return wcwidth(s.replace(ANSI_RE, ""));
}

export function truncateLine(line: string, max: number): string {
  if (visibleWidth(line) <= max) return line;
  let out = "";
  let visible = 0;
  let i = 0;
  while (i < line.length && visible < max - 1) {
    // Try to match ANSI/OSC escape at current position — emit verbatim, do not count as visible
    const slice = line.slice(i);
    const match = ANSI_AT_START_RE.exec(slice);
    if (match) {
      out += match[0];
      i += match[0].length;
      continue;
    }
    const ch = line.slice(i, i + 1);
    const w = wcwidth(ch);
    if (visible + w > max - 1) break;
    out += ch;
    visible += w;
    i += 1;
  }
  return out + "…\x1b[0m";
}

export function detectTerminalWidth(env: NodeJS.ProcessEnv, fallback: number | null): number {
  const cols = env.COLUMNS ? Number.parseInt(env.COLUMNS, 10) : NaN;
  if (Number.isFinite(cols) && cols > 0) return cols;
  if (process.stdout.columns && process.stdout.columns > 0) return process.stdout.columns;
  return fallback ?? 120;
}
