// src/ollama-probe.ts
import { readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OllamaProbeResult, OllamaTagsModel } from "./types.js";

interface ProbeOptions {
  host: string;
  sessionId: string;
  daemonTtlSeconds: number;
  cloudModelsTtlSeconds: number;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

export function probeCachePath(sessionId: string): string {
  return join(tmpdir(), `ohud-probe-${sessionId}.json`);
}

async function fetchWithTimeout(url: string, timeoutMs: number, fetchImpl: typeof fetch): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetchImpl(url, { signal: controller.signal }); }
  catch { return null; }
  finally { clearTimeout(timer); }
}

function readCache(path: string): OllamaProbeResult | null {
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf8");
    return JSON.parse(raw) as OllamaProbeResult;
  } catch { return null; }
}

function writeCache(path: string, data: OllamaProbeResult): void {
  try {
    const tmp = path + ".tmp";
    writeFileSync(tmp, JSON.stringify(data));
    renameSync(tmp, path); // atomic on POSIX
  } catch { /* best-effort */ }
}

export async function probeOllama(opts: ProbeOptions): Promise<OllamaProbeResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const cachePath = probeCachePath(opts.sessionId);

  const cached = readCache(cachePath);
  const now = Date.now();
  if (cached && cached.host === opts.host) {
    const daemonAge = now - cached.fetchedAt;
    const cloudAge = now - (cached.cloudModelsAt ?? cached.fetchedAt);
    const daemonFresh = daemonAge < opts.daemonTtlSeconds * 1000 && cached.daemonOk;
    const cloudFresh = cloudAge < opts.cloudModelsTtlSeconds * 1000;
    if (daemonFresh && cloudFresh) return cached;
    // else fall through to re-probe; we'll reuse cached.cloudModels if just daemon expired
  }

  const [versionRes, tagsRes] = await Promise.all([
    fetchWithTimeout(`${opts.host}/api/version`, opts.timeoutMs, fetchImpl),
    fetchWithTimeout(`${opts.host}/api/tags`, opts.timeoutMs, fetchImpl),
  ]);

  if (!versionRes || !versionRes.ok) {
    const result: OllamaProbeResult = {
      daemonOk: false,
      cloudModels: cached?.host === opts.host ? cached.cloudModels : [],
      fetchedAt: now,
      cloudModelsAt: cached?.cloudModelsAt ?? now,
      host: opts.host,
    };
    writeCache(cachePath, result);
    return result;
  }

  if (!tagsRes || !tagsRes.ok) {
    const result: OllamaProbeResult = {
      daemonOk: true,
      cloudModels: cached?.host === opts.host ? cached.cloudModels : [],
      fetchedAt: now,
      cloudModelsAt: cached?.cloudModelsAt ?? now,
      host: opts.host,
    };
    writeCache(cachePath, result);
    return result;
  }

  let parsed: { models?: OllamaTagsModel[] } = {};
  try { parsed = (await tagsRes.json()) as { models?: OllamaTagsModel[] }; } catch { /* fall through */ }
  const cloudModels = (parsed.models ?? []).filter((m) => typeof m.remote_host === "string" && m.remote_host.length > 0);

  const result: OllamaProbeResult = {
    daemonOk: true,
    cloudModels,
    fetchedAt: now,
    cloudModelsAt: now,
    host: opts.host,
  };
  writeCache(cachePath, result);
  return result;
}
