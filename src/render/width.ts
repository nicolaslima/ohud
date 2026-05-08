export function detectTerminalWidth(
  env: Record<string, string | undefined>,
  fallback: number | null
): number {
  const cols = env.COLUMNS;
  if (cols) {
    const n = Number.parseInt(cols, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  if (typeof fallback === "number" && fallback > 0) return fallback;
  return 80;
}
