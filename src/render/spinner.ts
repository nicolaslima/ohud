// src/render/spinner.ts
// Pure function — no state, no I/O.
// Frame index = Math.floor(now / 1000) % 4. Cycle period = 4 seconds.

const UNICODE_FRAMES = ["◐", "◓", "◑", "◒"] as const;
const ASCII_FRAMES = ["|", "/", "-", "\\"] as const;

/**
 * Returns one spinner frame character for the given wall-clock timestamp.
 *
 * @param now   Current timestamp in milliseconds (pass `Date.now()` at call site).
 * @param mode  "unicode" → ◐◓◑◒, "ascii" → |/-\
 */
export function spinnerFrame(now: number, mode: "unicode" | "ascii"): string {
  const idx = Math.floor(now / 1000) % 4;
  return mode === "ascii" ? ASCII_FRAMES[idx]! : UNICODE_FRAMES[idx]!;
}
