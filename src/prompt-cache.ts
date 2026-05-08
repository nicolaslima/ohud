// src/prompt-cache.ts
export function promptCacheRemainingMs(
  lastResponseAt: Date | undefined, ttlSeconds: number, now: () => number = Date.now,
): number | null {
  if (!lastResponseAt) return null;
  const elapsedMs = now() - lastResponseAt.getTime();
  const ttlMs = ttlSeconds * 1000;
  return Math.max(0, ttlMs - elapsedMs);
}

export function formatPromptCache(remainingMs: number): string {
  if (remainingMs === 0) return "expired";
  const seconds = Math.floor(remainingMs / 1000);
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m === 0 ? `${s}s` : `${m}m ${s}s`;
}
