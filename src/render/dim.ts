// src/render/dim.ts
// Applies ANSI dim (SGR 2) to text, respecting NO_COLOR and TERM=dumb.
// Reuses the same color-disabled detection as colors.ts.

/**
 * Wraps `text` in ANSI dim codes: `\x1b[2m{text}\x1b[22m`.
 * Returns plain `text` when NO_COLOR is set or TERM=dumb.
 */
export function dim(text: string, env?: NodeJS.ProcessEnv): string {
  const e = env ?? process.env;
  if ((e.NO_COLOR !== undefined && e.NO_COLOR !== "") || e.TERM === "dumb") {
    return text;
  }
  return `\x1b[2m${text}\x1b[22m`;
}
