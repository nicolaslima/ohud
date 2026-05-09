// src/render/hyperlink.ts
// OSC 8 hyperlink helper.
// Spec: \x1b]8;;{url}\x07{text}\x1b]8;;\x07
// Gracefully ignored by terminals that don't support OSC 8.

/**
 * Wraps `text` in an OSC 8 hyperlink pointing to `url`.
 *
 * Returns plain `text` when:
 *  - url is null, undefined, or the empty string
 *  - enabled is false (caller can pass config.display.hush?.hyperlinks === false)
 *  - url contains a BEL character (\x07): embedding BEL inside the OSC 8 parameter
 *    would terminate the sequence early, corrupting the escape and producing garbage
 *    output in the terminal. Rather than emit broken escapes, we fall back to plain text.
 */
export function link(
  text: string,
  url: string | null | undefined,
  enabled = true,
): string {
  if (!enabled || !url) return text;
  // BEL sanitization: BEL (\x07) is the OSC sequence terminator.
  // A URL containing BEL would prematurely close the OSC 8 escape, producing
  // corrupted output. Skip the link and return plain text instead.
  if (url.includes("\x07")) return text;
  return `\x1b]8;;${url}\x07${text}\x1b]8;;\x07`;
}
