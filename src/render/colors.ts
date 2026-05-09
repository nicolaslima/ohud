export const RESET = "\x1b[0m";

const NAMED: Record<string, string> = {
  dim: "\x1b[2m", red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m",
  magenta: "\x1b[35m", cyan: "\x1b[36m", brightBlue: "\x1b[94m", brightMagenta: "\x1b[95m",
};

function colorDisabled(): boolean {
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== "") return true;
  if (process.env.TERM === "dumb") return true;
  return false;
}

export function color(spec: string, text: string): string {
  if (colorDisabled()) return text;
  if (NAMED[spec]) return `${NAMED[spec]}${text}${RESET}`;
  if (/^\d+$/.test(spec)) {
    const n = Number.parseInt(spec, 10);
    if (n >= 0 && n <= 255) return `\x1b[38;5;${n}m${text}${RESET}`;
  }
  const m = /^#([0-9a-f]{6})$/i.exec(spec);
  if (m) {
    const hex = m[1];
    const r = Number.parseInt(hex.slice(0, 2), 16);
    const g = Number.parseInt(hex.slice(2, 4), 16);
    const b = Number.parseInt(hex.slice(4, 6), 16);
    return `\x1b[38;2;${r};${g};${b}m${text}${RESET}`;
  }
  return text;
}
