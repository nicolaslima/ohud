// tests/ollama-probe.test.ts
import { test, expect, beforeEach, afterEach, mock } from "bun:test";
import { readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { probeOllama, probeCachePath } from "../src/ollama-probe.js";

const cloudFixture = readFileSync(join(import.meta.dir, "fixtures/api-tags-cloud.json"), "utf8");
const localFixture = readFileSync(join(import.meta.dir, "fixtures/api-tags-local-only.json"), "utf8");

const CACHE = probeCachePath("test-session");

beforeEach(() => { if (existsSync(CACHE)) rmSync(CACHE); });
afterEach(() => { if (existsSync(CACHE)) rmSync(CACHE); });

const okFetch = (tagsBody: string) => mock(async (url: string) => {
  if (url.endsWith("/api/version")) return new Response(JSON.stringify({ version: "0.23.2" }));
  if (url.endsWith("/api/tags")) return new Response(tagsBody);
  return new Response("not found", { status: 404 });
}) as unknown as typeof fetch;

test("probe returns cloud models when /api/tags has remote_host entries", async () => {
  const result = await probeOllama({
    host: "http://localhost:11434", sessionId: "test-session", ttlSeconds: 60, timeoutMs: 500,
    fetchImpl: okFetch(cloudFixture),
  });
  expect(result.daemonOk).toBe(true);
  expect(result.cloudModels).toHaveLength(2);
  expect(result.cloudModels[0].model).toBe("glm-5:cloud");
});

test("probe returns empty cloudModels when no remote_host entries", async () => {
  const result = await probeOllama({
    host: "http://localhost:11434", sessionId: "test-session", ttlSeconds: 60, timeoutMs: 500,
    fetchImpl: okFetch(localFixture),
  });
  expect(result.daemonOk).toBe(true);
  expect(result.cloudModels).toHaveLength(0);
});

test("probe returns daemonOk=false when /api/version times out", async () => {
  const slow = mock(async (_url: string, opts?: RequestInit) => {
    const abortPromise = new Promise<never>((_, reject) => {
      opts?.signal?.addEventListener?.("abort", () => reject(new Error("aborted")));
    });
    const timeoutPromise = new Promise((r) => setTimeout(r, 50));
    await Promise.race([timeoutPromise, abortPromise]);
    return new Response("{}");
  }) as unknown as typeof fetch;
  const result = await probeOllama({
    host: "http://localhost:11434", sessionId: "test-session", ttlSeconds: 60, timeoutMs: 5,
    fetchImpl: slow,
  });
  expect(result.daemonOk).toBe(false);
  expect(result.cloudModels).toHaveLength(0);
});

test("probe writes cache and re-uses it within TTL", async () => {
  let calls = 0;
  const counting = mock(async (url: string) => {
    calls += 1;
    if (url.endsWith("/api/version")) return new Response(JSON.stringify({ version: "0.23.2" }));
    return new Response(cloudFixture);
  }) as unknown as typeof fetch;
  await probeOllama({ host: "http://localhost:11434", sessionId: "test-session", ttlSeconds: 60, timeoutMs: 500, fetchImpl: counting });
  await probeOllama({ host: "http://localhost:11434", sessionId: "test-session", ttlSeconds: 60, timeoutMs: 500, fetchImpl: counting });
  // Second call must hit the cache (no new fetch)
  expect(calls).toBe(2); // 1 version + 1 tags
});
