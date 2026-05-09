import { test, expect } from "bun:test";
import { runDoctor } from "../src/doctor.js";

test("doctor produces version, runtime, mode, probe, config-flags sections", async () => {
  const out = await runDoctor({ host: "http://localhost:11434", configPath: "/tmp/no-config.json" });
  expect(out).toMatch(/ohud version:/);
  expect(out).toMatch(/runtime:/);
  expect(out).toMatch(/resolved bundle:/);
  expect(out).toMatch(/mode:/);
  expect(out).toMatch(/probe:/);
  expect(out).toMatch(/active config flags/);
});
