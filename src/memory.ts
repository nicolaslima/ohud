// src/memory.ts
import { freemem, totalmem } from "node:os";
import type { MemoryInfo } from "./types.js";

export function getMemoryUsage(): MemoryInfo {
  const total = totalmem();
  const free = freemem();
  const used = Math.max(0, total - free);
  const usedPercent = total > 0 ? Math.round((used / total) * 100) : 0;
  return { totalBytes: total, usedBytes: used, freeBytes: free, usedPercent };
}
