// src/ollama-probe.ts
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OllamaProbeResult, OllamaTagsModel } from "./types.js";

interface ProbeOptions {
  host: string;
  sessionId: string;
  ttlSeconds: number;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

export function probeCachePath(sessionId: string): string {
  return join(tmpdir(), `ohud-probe-${sessionId}.json`);
}

async function fetchWithTimeout(
  url: string, timeoutMs: number, fetchImpl: typeof fetch,
): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: controller.signal });
    return res;
  } catch { return null; }
  finally { clearTimeout(timer); }
}

function readCache(path: string, ttlMs: number): OllamaProbeResult | null {
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as OllamaProbeResult;
    if (Date.now() - parsed.fetchedAt > ttlMs) return null;
    return parsed;
  } catch { return null; }
}

function writeCache(path: string, data: OllamaProbeResult): void {
  try { writeFileSync(path, JSON.stringify(data)); } catch { /* best-effort */ }
}

export async function probeOllama(opts: ProbeOptions): Promise<OllamaProbeResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const cachePath = probeCachePath(opts.sessionId);
  const ttlMs = opts.ttlSeconds * 1000;

  const cached = readCache(cachePath, ttlMs);
  if (cached) return cached;

  const versionRes = await fetchWithTimeout(`${opts.host}/api/version`, opts.timeoutMs, fetchImpl);
  if (!versionRes || !versionRes.ok) {
    const result: OllamaProbeResult = { daemonOk: false, cloudModels: [], fetchedAt: Date.now() };
    writeCache(cachePath, result);
    return result;
  }

  const tagsRes = await fetchWithTimeout(`${opts.host}/api/tags`, opts.timeoutMs, fetchImpl);
  if (!tagsRes || !tagsRes.ok) {
    const result: OllamaProbeResult = { daemonOk: true, cloudModels: [], fetchedAt: Date.now() };
    writeCache(cachePath, result);
    return result;
  }

  let parsed: { models?: OllamaTagsModel[] } = {};
  try { parsed = (await tagsRes.json()) as { models?: OllamaTagsModel[] }; } catch { /* fall through */ }
  const cloudModels = (parsed.models ?? []).filter((m) => typeof m.remote_host === "string" && m.remote_host.length > 0);

  const result: OllamaProbeResult = { daemonOk: true, cloudModels, fetchedAt: Date.now() };
  writeCache(cachePath, result);
  return result;
}
