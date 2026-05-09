// src/render/spinner.ts
// Pure function — no state, no I/O.
// Frame index = Math.floor(now / 1000) % 4. Cycle period = 4 seconds.
//
// The Unicode frames cycle through quarter-arc glyphs (UPPER LEFT, UPPER RIGHT,
// LOWER RIGHT, LOWER LEFT QUADRANT CIRCULAR ARC). Compared to the previous
// half-circle phase glyphs (◐◓◑◒), the arcs read as a lighter, smoother
// rotation — better suited to the minimalist Hush aesthetic. They still occupy
// the same single-cell footprint and degrade to ASCII frames when needed.

const UNICODE_FRAMES = ["◜", "◝", "◞", "◟"] as const;
const ASCII_FRAMES = ["|", "/", "-", "\\"] as const;

/**
 * Returns one spinner frame character for the given wall-clock timestamp.
 *
 * @param now   Current timestamp in milliseconds (pass `Date.now()` at call site).
 * @param mode  "unicode" → ◜◝◞◟, "ascii" → |/-\
 */
export function spinnerFrame(now: number, mode: "unicode" | "ascii"): string {
  const idx = Math.floor(now / 1000) % 4;
  return mode === "ascii" ? ASCII_FRAMES[idx]! : UNICODE_FRAMES[idx]!;
}
