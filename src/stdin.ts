// src/stdin.ts
import type { StdinData } from "./types.js";

type StdinStream = Pick<NodeJS.ReadStream, "setEncoding" | "on" | "off" | "pause"> & {
  isTTY?: boolean;
};

interface ReadStdinOptions {
  firstByteTimeoutMs?: number;
  idleTimeoutMs?: number;
  maxBytes?: number;
}

const DEFAULT_FIRST_BYTE_TIMEOUT_MS = 250;
const DEFAULT_IDLE_TIMEOUT_MS = 30;
const DEFAULT_MAX_BYTES = 256 * 1024;

export async function readStdin(
  stream: StdinStream = process.stdin as unknown as StdinStream,
  options: ReadStdinOptions = {},
): Promise<StdinData | null> {
  if (stream.isTTY) return null;

  const firstByteTimeout = options.firstByteTimeoutMs ?? DEFAULT_FIRST_BYTE_TIMEOUT_MS;
  const idleTimeout = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

  try { stream.setEncoding("utf8"); } catch { return null; }

  return await new Promise<StdinData | null>((resolve) => {
    let raw = "";
    let settled = false;
    let firstByteTimer: ReturnType<typeof setTimeout> | undefined;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = (): void => {
      if (firstByteTimer) clearTimeout(firstByteTimer);
      if (idleTimer) clearTimeout(idleTimer);
      stream.off("data", onData);
      stream.off("end", onEnd);
      stream.off("error", onError);
      try { stream.pause(); } catch { /* noop */ }
    };

    const finish = (value: StdinData | null): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    const tryParse = (): StdinData | null => {
      const trimmed = raw.trim();
      if (!trimmed) return null;
      try { return JSON.parse(trimmed) as StdinData; } catch { return null; }
    };

    const scheduleIdleParse = (): void => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => finish(tryParse()), idleTimeout);
    };

    const onData = (chunk: string | Buffer): void => {
      if (firstByteTimer) { clearTimeout(firstByteTimer); firstByteTimer = undefined; }
      raw += String(chunk);
      if (Buffer.byteLength(raw, "utf8") > maxBytes) { finish(null); return; }
      scheduleIdleParse();
    };
    const onEnd = (): void => finish(tryParse());
    const onError = (): void => finish(null);

    firstByteTimer = setTimeout(() => finish(null), firstByteTimeout);
    stream.on("data", onData);
    stream.on("end", onEnd);
    stream.on("error", onError);
  });
}
