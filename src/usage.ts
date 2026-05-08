// src/usage.ts
import { readFile } from "node:fs/promises";
import type { ExternalUsageSnapshot, StdinData, UsageData } from "./types.js";

function clamp(p: number | null | undefined): number | null {
  if (typeof p !== "number" || !Number.isFinite(p)) return null;
  return Math.round(Math.min(100, Math.max(0, p)));
}

function epochToDate(v: number | null | undefined): Date | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return null;
  return new Date(v * 1000);
}

function isoToDate(v: string | number | null | undefined): Date | null {
  if (v == null) return null;
  if (typeof v === "number") return epochToDate(v);
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function fromStdin(stdin: StdinData): UsageData | null {
  const rl = stdin.rate_limits;
  if (!rl) return null;
  const five = clamp(rl.five_hour?.used_percentage);
  const seven = clamp(rl.seven_day?.used_percentage);
  if (five === null && seven === null) return null;
  return {
    fiveHour: five, sevenDay: seven,
    fiveHourResetAt: epochToDate(rl.five_hour?.resets_at),
    sevenDayResetAt: epochToDate(rl.seven_day?.resets_at),
  };
}

export async function fromExternalSnapshot(
  path: string, freshnessMs: number, now: () => number = Date.now,
): Promise<UsageData | null> {
  if (!path) return null;
  let raw: string;
  try { raw = await readFile(path, "utf8"); } catch { return null; }
  let parsed: ExternalUsageSnapshot;
  try { parsed = JSON.parse(raw) as ExternalUsageSnapshot; } catch { return null; }

  const updatedAt = isoToDate(parsed.updated_at ?? null);
  if (!updatedAt) return null;
  if (now() - updatedAt.getTime() > freshnessMs) return null;

  const five = clamp(parsed.five_hour?.used_percentage);
  const seven = clamp(parsed.seven_day?.used_percentage);
  if (five === null && seven === null) return null;
  return {
    fiveHour: five, sevenDay: seven,
    fiveHourResetAt: isoToDate(parsed.five_hour?.resets_at ?? null),
    sevenDayResetAt: isoToDate(parsed.seven_day?.resets_at ?? null),
  };
}
