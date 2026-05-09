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
 */
export function link(
  text: string,
  url: string | null | undefined,
  enabled = true,
): string {
  if (!enabled || !url) return text;
  return `\x1b]8;;${url}\x07${text}\x1b]8;;\x07`;
}
