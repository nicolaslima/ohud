// src/render/path.ts

// Returns last non-empty path segment, ignoring trailing or repeated slashes.
export function basename(p: string): string {
  const parts = p.split("/").filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1]! : "";
}
