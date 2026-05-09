// src/render/dim.ts
// Applies ANSI dim (SGR 2) to text, respecting NO_COLOR and TERM=dumb.
// Uses isColorDisabled() from colors.ts as the single source of truth.

import { isColorDisabled } from "./colors.js";

/**
 * Wraps `text` in ANSI dim codes: `\x1b[2m{text}\x1b[22m`.
 * Returns plain `text` when NO_COLOR is set or TERM=dumb.
 */
export function dim(text: string, env?: NodeJS.ProcessEnv): string {
  if (isColorDisabled(env)) return text;
  return `\x1b[2m${text}\x1b[22m`;
}
