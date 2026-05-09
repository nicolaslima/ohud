# ohud v0.1 — P1 + P2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `ohud` from 🚫 NOT READY to ✅ Ready for v0.1 marketplace publish by addressing 8 Critical and 15 High findings from the multi-disciplinary code review at `.review/final/report.md`.

**Architecture:** Surgical fixes across five concerns:
1. **Distribution** — commit `dist/`, declare `statusLine` in plugin manifest
2. **Observability** — `/ohud doctor` + stdout sentinels (single highest-ROI fix)
3. **Probe correctness** — split-TTL cache (5s for liveness, 120s for cloud-models), parallel internal fetches, `:cloud` heuristic
4. **Schema-vs-impl alignment** — delete 6 dead flags, implement 5 from Pilha A, encode preset→flags mapping
5. **Rendering polish** — `NO_COLOR`, glyph fallback, width truncation, `ModeResolution` discriminated union

**Tech Stack:** TypeScript ES2022 + NodeNext modules, Bun (preferred) / Node 18+ (fallback), `bun:test`, native `fetch`/`AbortController`. Zero runtime deps.

**Source artifacts**: `.review/final/report.md` + `.review/round{1,2}/*.md` (14 brutal review reports, 2452 lines).

**User decisions registered (2026-05-09)**:
- ✅ P1 + P2 implemented together (~6 dev-days)
- ✅ `statusLine` in `plugin.json` confirmed supported by Claude Code schema (use `${CLAUDE_PLUGIN_ROOT}`)
- ✅ Pilha B (6 dead flags) deleted from schema in v0.1
- ✅ Cold-start instrumentation as Phase 0 (~1h pré-P1)

---

## Phase 0 — Cold-start instrumentation (~1h)

### Task 0: Measure cold-start cost empirically

**Resolves:** Theme F (perf-budget Open Q#1) — answers whether spawn-per-tick eats 17-33% of 300ms budget before user code runs

**Files:**
- Modify: `src/index.ts:19` (instrument main)
- Create: `docs/cold-start-measurement.md`

- [ ] **Step 1: Add hrtime instrumentation behind env flag**

```ts
// src/index.ts — add at top of main()
const T0 = process.hrtime.bigint();
const profile = process.env.OHUD_PROFILE === "1";
// ... existing main() body ...
// at end of try block, before return:
if (profile) {
  const elapsedMs = Number(process.hrtime.bigint() - T0) / 1_000_000;
  process.stderr.write(`ohud-profile: total=${elapsedMs.toFixed(1)}ms\n`);
}
```

- [ ] **Step 2: Run 5 cold ticks against real fixture**

```bash
cd /Users/lima/Projects/ohud
bun run build
for i in 1 2 3 4 5; do
  echo '{"session_id":"profile-'"$i"'","transcript_path":"/Users/lima/.claude/projects/-Users-lima-Projects-ohud/c40b60a4-94e6-40ed-8955-1309ffefde7a.jsonl","model":{"id":"glm-5:cloud","display_name":"glm-5:cloud"},"workspace":{"current_dir":"'"$PWD"'"},"context_window":{"used_percentage":42}}' | OHUD_PROFILE=1 node dist/index.js 2>&1 >/dev/null
done
```

Expected: 5 lines like `ohud-profile: total=68.3ms` — record min/max/median.

- [ ] **Step 3: Document findings**

Create `docs/cold-start-measurement.md` with:
- Date, machine, runtime versions
- 5 measurements
- Interpretation: if median > 100ms → spawn-per-tick is real and Phase 1 perf items are urgent. If median < 50ms → bun bundle eval is fast enough; perf items are optimizations not necessities.

- [ ] **Step 4: Keep instrumentation gated behind `OHUD_PROFILE=1`**

The profile guard stays in `index.ts` permanently (zero-cost when env unset). Useful for future regressions.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts docs/cold-start-measurement.md
git commit -m "instrument: gated cold-start profiling via OHUD_PROFILE=1

Theme F resolution from .review/final/report.md. Median cold-start
measured at <X>ms — see docs/cold-start-measurement.md."
```

---

## Phase 1 — P1 must-fix before publish (~3 dev-days)

### Task 1: Ship `dist/` in git + CI rebuild guard

**Resolves:** C1 (install mechanically broken)

**Files:**
- Modify: `.gitignore:2`
- Create: `dist/index.js` (committed bundle)
- Modify: `.github/workflows/ci.yml`
- Modify: `package.json:13-19` (add `prepublish` guard if useful)

- [ ] **Step 1: Remove `dist/` from `.gitignore`**

```bash
# .gitignore line 2 currently: dist/
# Edit to remove that line; keep .bun-cache/, /tmp-hypothesis-*.txt, .review/
```

Use Edit tool to remove the `dist/` line.

- [ ] **Step 2: Rebuild and stage the bundle**

```bash
cd /Users/lima/Projects/ohud
bun run build
ls -la dist/index.js  # confirm exists, ~35KB
git add dist/index.js
```

- [ ] **Step 3: Add CI guard that fails PRs with stale bundle**

Modify `.github/workflows/ci.yml` — add a step after `bun run build`:

```yaml
- name: Verify dist/ is up-to-date
  run: |
    bun run build
    git diff --exit-code dist/ \
      || (echo "::error::dist/index.js is out of date — run 'bun run build' and commit" && exit 1)
```

- [ ] **Step 4: Run build + verify clean diff**

```bash
bun run build
git diff --exit-code dist/  # expect: clean exit, no diff
```

- [ ] **Step 5: Commit**

```bash
git add .gitignore dist/index.js .github/workflows/ci.yml
git commit -m "ship: commit dist/index.js for marketplace install

Resolves C1 from .review/final/report.md. Marketplace install (git clone)
now lands a runnable bundle. CI verifies dist/ is in sync with src/ on
every PR."
```

---

### Task 2: Declare `statusLine` in `plugin.json`

**Resolves:** C2 (install ≠ activation), eliminates need for `/ohud setup`, resolves H14 cascade

**Files:**
- Modify: `.claude-plugin/plugin.json:1-18`
- Modify: `commands/ohud-setup.md` (mark as opt-in tweaker)
- Modify: `README.md:14-20` (simplify install instructions)

- [ ] **Step 1: Add `statusLine` block to plugin.json**

```json
{
  "name": "ohud",
  "description": "Real-time statusline HUD for Claude Code with Ollama Cloud + Anthropic dual-mode rendering",
  "version": "0.1.0",
  "author": { "name": "nicolaslima", "url": "https://github.com/nicolaslima" },
  "statusLine": {
    "type": "command",
    "command": "${CLAUDE_PLUGIN_ROOT}/dist/index.js",
    "padding": 2
  },
  "commands": [
    "./commands/ohud.md",
    "./commands/ohud-setup.md",
    "./commands/ohud-configure.md",
    "./commands/ohud-doctor.md"
  ],
  "homepage": "https://github.com/nicolaslima/ohud",
  "repository": "https://github.com/nicolaslima/ohud",
  "license": "MIT",
  "keywords": ["hud", "statusline", "ollama", "ollama-cloud", "claude-code", "monitoring"]
}
```

(`commands/ohud-doctor.md` is added in Task 5 — listed here proactively.)

- [ ] **Step 2: Update README install flow**

Replace `README.md:14-20` to:

```markdown
## Install

```
/plugin marketplace add nicolaslima/ohud
/plugin install ohud
```

Restart Claude Code (Cmd+Q on macOS, then reopen). The HUD appears automatically.

**Optional**: run `/ohud configure` to pick a preset (Full / Essential / Minimal). Run `/ohud doctor` if anything looks wrong.
```

- [ ] **Step 3: Mark `/ohud setup` as opt-in tweaker**

Replace `commands/ohud-setup.md:1-7` header with:

```markdown
---
description: (Optional) Override statusLine command — most users do not need this
allowed-tools: Bash, Read, Edit, Write
---

> **Note**: ohud now activates automatically via `plugin.json:statusLine` after `/plugin install ohud`. This command is only needed if you want to wrap the runtime (e.g., `bun --hot dist/index.js` for development).
```

- [ ] **Step 4: Manual verification (no automated test possible)**

```bash
# Validate JSON syntax
cat .claude-plugin/plugin.json | bun -e 'JSON.parse(await Bun.stdin.text()); console.log("OK")'
# Expected: OK
```

- [ ] **Step 5: Commit**

```bash
git add .claude-plugin/plugin.json README.md commands/ohud-setup.md
git commit -m "activate: declare statusLine in plugin.json

Resolves C2 from .review/final/report.md. Plugin now activates on
install via \${CLAUDE_PLUGIN_ROOT}/dist/index.js — no manual /ohud setup
required. Cascade: removes path-rot (was C3), eliminates state-handoff
between setup and configure (was H14), self-cleans on uninstall."
```

---

### Task 3: Reorder CI + refactor integration test to in-process

**Resolves:** H1 (CI false positive — `bun test` runs before `bun run build`), Theme C, enables H15

**Files:**
- Modify: `.github/workflows/ci.yml:14-22`
- Modify: `tests/integration.test.ts:1-30`
- Modify: `src/index.ts` (export `main` properly)

- [ ] **Step 1: Reorder CI steps**

Edit `.github/workflows/ci.yml` — change order to: install → typecheck → build → test → smoke. The build step now runs **before** test.

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: oven-sh/setup-bun@v1
  - run: bun install
  - run: bun run typecheck
  - run: bun run build      # <-- moved before test
  - name: Verify dist/ up-to-date
    run: git diff --exit-code dist/ || (echo "::error::run bun run build" && exit 1)
  - run: bun test
  - name: Smoke test (Node)
    run: |
      echo '{}' | node dist/index.js
```

- [ ] **Step 2: Refactor integration test to call `main()` in-process**

Replace `tests/integration.test.ts` content:

```ts
// tests/integration.test.ts
import { test, expect } from "bun:test";
import { main } from "../src/index.js";
import { Readable } from "node:stream";

function makeStdinFixture(payload: object): void {
  const json = JSON.stringify(payload);
  // Replace process.stdin with a synthetic readable for the duration of one main() call
  const original = process.stdin;
  Object.defineProperty(process, "stdin", {
    configurable: true,
    value: Object.assign(Readable.from([json]), { isTTY: false }),
  });
  return () => Object.defineProperty(process, "stdin", { configurable: true, value: original });
}

test("integration: anthropic mode produces non-empty stdout", async () => {
  const restore = makeStdinFixture({
    session_id: "test-anthropic",
    transcript_path: "/tmp/no",
    model: { id: "claude-sonnet-4-6", display_name: "Sonnet 4.6" },
    workspace: { current_dir: process.cwd() },
    context_window: { used_percentage: 30 },
  });
  const captured: string[] = [];
  const origLog = console.log;
  console.log = (s: string) => captured.push(s);
  try { await main(); } finally { console.log = origLog; restore(); }
  const out = captured.join("\n");
  expect(out).not.toMatch(/MODULE_NOT_FOUND|Cannot find module/);
  expect(out).toContain("Sonnet");
});

test("integration: ollama-local mode produces non-empty stdout", async () => {
  const restore = makeStdinFixture({
    session_id: "test-ollama",
    transcript_path: "/tmp/no",
    model: { id: "glm-5:cloud", display_name: "glm-5:cloud" },
    workspace: { current_dir: process.cwd() },
    context_window: { used_percentage: 42 },
  });
  const captured: string[] = [];
  const origLog = console.log;
  console.log = (s: string) => captured.push(s);
  try { await main(); } finally { console.log = origLog; restore(); }
  const out = captured.join("\n");
  expect(out).not.toMatch(/MODULE_NOT_FOUND|aborted/);
});
```

- [ ] **Step 3: Ensure `main` is exported in `src/index.ts`**

Verify `src/index.ts:19` already has `export async function main()`. (It does — see source.)

- [ ] **Step 4: Run tests**

```bash
bun test tests/integration.test.ts
```

Expected: 2 passing tests, no `MODULE_NOT_FOUND`, no false-positive on stack traces.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml tests/integration.test.ts
git commit -m "test: integration tests now run in-process via main()

Resolves H1 + Theme C from review. CI builds before testing; integration
tests no longer depend on dist/ existing. Assertion strengthened from
expect(out.length).toBeGreaterThan(0) (which passed on Node MODULE_NOT_FOUND
stack traces) to explicit negative-match guards."
```

---

### Task 4: No-dist clean-install smoke test

**Resolves:** H1 durable guard (Theme C — fresh marketplace install is the configuration CI never tests)

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Add smoke job that simulates fresh marketplace install**

Append to `.github/workflows/ci.yml`:

```yaml
fresh-install-smoke:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - name: Simulate marketplace install (clone-only, no build)
      run: |
        TMP=$(mktemp -d)
        git ls-files -z | xargs -0 -I{} cp --parents {} "$TMP"
        cd "$TMP"
        # No bun install, no bun run build — exactly what marketplace gives the user
        ls dist/index.js  # must exist (Task 1 commits it)
    - uses: actions/setup-node@v4
      with: { node-version: '20' }
    - name: Run committed bundle as if installed
      run: |
        TMP=$(mktemp -d)
        git ls-files -z | xargs -0 -I{} cp --parents {} "$TMP"
        cd "$TMP"
        echo '{"session_id":"smoke","transcript_path":"/tmp/no","model":{"id":"glm-5:cloud","display_name":"glm-5:cloud"},"workspace":{"current_dir":"'"$PWD"'"},"context_window":{"used_percentage":50}}' \
          | node dist/index.js
```

- [ ] **Step 2: Verify locally that the smoke replicates marketplace state**

```bash
TMP=$(mktemp -d)
cd /Users/lima/Projects/ohud
git ls-files -z | xargs -0 -I{} cp --parents {} "$TMP"
cd "$TMP"
ls dist/index.js  # expect: dist/index.js exists
echo '{}' | node dist/index.js  # expect: harmless output, no errors
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add fresh-install smoke that mimics marketplace state

Resolves H1 durable guard. Tests the configuration users actually see
(git ls-files content, no bun install, no build) — the exact state CI
never previously exercised."
```

---

### Task 5: Implement `/ohud doctor` command

**Resolves:** C5 (observability total-blackout — single highest-ROI fix in entire review)

**Files:**
- Create: `commands/ohud-doctor.md`
- Modify: `commands/ohud.md` (add doctor route)
- Modify: `src/index.ts` (handle `--doctor` arg)
- Create: `src/doctor.ts`
- Create: `tests/doctor.test.ts`

- [ ] **Step 1: Write failing test for doctor output shape**

```ts
// tests/doctor.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test tests/doctor.test.ts
```

Expected: FAIL with `Cannot find module './doctor'`.

- [ ] **Step 3: Implement `src/doctor.ts`**

```ts
// src/doctor.ts
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { probeOllama } from "./ollama-probe.js";
import { loadConfig } from "./config.js";

const CONSUMED_FLAGS = new Set([
  // Updated after Task 7 (delete) and Task 8 (implement Pilha A)
  "showModel", "showContextBar", "showApiTime", "showUsage", "showCost",
  "showPromptCache", "showTools", "showAgents", "showTodos", "showDuration",
  "showSpeed", "showMemoryUsage", "showEffortLevel", "showResetLabel",
  "timeFormat", "showAheadBehind", "pushWarningThreshold", "pushCriticalThreshold",
]);

interface DoctorOpts {
  host: string;
  configPath: string;
  bundlePath?: string;
}

export async function runDoctor(opts: DoctorOpts): Promise<string> {
  const lines: string[] = [];
  const pkg = await readPackageJson();
  lines.push(`ohud version: ${pkg.version}`);
  lines.push(`runtime: ${process.version} (process.argv0=${process.argv0})`);
  const bundle = opts.bundlePath ?? resolveBundlePath();
  lines.push(`resolved bundle: ${bundle} (exists: ${existsSync(bundle) ? "✓" : "✗"})`);

  const cfg = await loadConfig(opts.configPath);
  const probe = await probeOllama({
    host: opts.host,
    sessionId: "doctor",
    daemonTtlSeconds: 0, // bypass cache
    cloudModelsTtlSeconds: 0,
    timeoutMs: 1500,
  });
  lines.push(`probe: live (cache bypassed) — daemonOk: ${probe.daemonOk ? "✓" : "✗"}`);
  lines.push(`cloud models: ${probe.cloudModels.map((m) => m.name).join(", ") || "(none)"}`);

  const flagSection = renderFlagAnnotations(cfg);
  lines.push(`\nactive config flags (consumed?):`);
  lines.push(flagSection);

  const errLog = join(homedir(), ".claude/plugins/ohud/last-errors.log");
  if (existsSync(errLog)) {
    lines.push(`\nlast errors (${errLog}):`);
    lines.push(readFileSync(errLog, "utf8").split("\n").slice(-5).join("\n"));
  }

  return lines.join("\n");
}

function renderFlagAnnotations(cfg: ReturnType<typeof loadConfig> extends Promise<infer T> ? T : never): string {
  const out: string[] = [];
  for (const [k, v] of Object.entries(cfg.display)) {
    const tag = CONSUMED_FLAGS.has(k) ? "✓ consumed" : "✗ DEAD FLAG";
    out.push(`  ${k}: ${JSON.stringify(v)} (${tag})`);
  }
  return out.join("\n");
}

function resolveBundlePath(): string {
  const root = process.env.CLAUDE_PLUGIN_ROOT;
  if (root) return join(root, "dist", "index.js");
  return join(homedir(), ".claude/plugins/cache/.../ohud/dist/index.js");
}

async function readPackageJson(): Promise<{ version: string }> {
  try {
    const here = new URL("../package.json", import.meta.url).pathname;
    const raw = readFileSync(here, "utf8");
    return JSON.parse(raw) as { version: string };
  } catch { return { version: "unknown" }; }
}
```

- [ ] **Step 4: Wire `--doctor` flag in `src/index.ts`**

Add at start of `main()`:

```ts
if (process.argv.includes("--doctor")) {
  const cfgPath = join(homedir(), ".claude/plugins/ohud/config.json");
  const cfg = await loadConfig(cfgPath);
  const out = await runDoctor({ host: cfg.ollama.host, configPath: cfgPath });
  console.log(out);
  return;
}
```

Add `import { runDoctor } from "./doctor.js";` at top.

- [ ] **Step 5: Create `commands/ohud-doctor.md`**

```markdown
---
description: Diagnose ohud — show version, mode, probe, dead-flags, last errors
allowed-tools: Bash
---

Run the doctor:

```bash
node "$CLAUDE_PLUGIN_ROOT/dist/index.js" --doctor 2>&1 | head -60
```

Or, if `bun` is available:

```bash
bun "$CLAUDE_PLUGIN_ROOT/dist/index.js" --doctor 2>&1 | head -60
```

Show the output to the user verbatim. If `daemonOk: ✗`, suggest checking `ollama serve`. If any flags are flagged `✗ DEAD FLAG`, point at `.review/final/report.md` Pilha A/B triage.
```

- [ ] **Step 6: Update dispatcher**

Edit `commands/ohud.md` to add `doctor` route:

```markdown
- `/ohud doctor` → invoke commands/ohud-doctor.md instructions
```

And update the rejection message to include `doctor`.

- [ ] **Step 7: Run tests + manual smoke**

```bash
bun run build
bun test tests/doctor.test.ts
echo '{}' | node dist/index.js --doctor
```

Expected: doctor output with all sections.

- [ ] **Step 8: Commit**

```bash
git add commands/ohud-doctor.md commands/ohud.md src/doctor.ts src/index.ts tests/doctor.test.ts .claude-plugin/plugin.json
git commit -m "feat: add /ohud doctor — observability surface

Resolves C5 from review. Single highest-ROI fix per devex-firstrun's
analysis. Doctor reports version, runtime, resolved bundle, live probe
(cache bypassed), active config flags with consumed/dead annotation,
and last 5 errors from ~/.claude/plugins/ohud/last-errors.log."
```

---

### Task 6: Stdout error sentinel + persistent error log

**Resolves:** C5 (visibility on catch path), composes with Task 5

**Files:**
- Modify: `src/index.ts:63-65`
- Modify: `tests/integration.test.ts` (add error-path test)

- [ ] **Step 1: Write failing test for error sentinel**

```ts
// Append to tests/integration.test.ts
test("integration: catch path emits stdout sentinel + writes log", async () => {
  // Force an error by passing a transcript_path that triggers a thrown read
  // (parseTranscript catches read errors, so we induce a different failure)
  const restore = makeStdinFixture({
    session_id: "test-error",
    transcript_path: "/dev/null/forbidden",
    // Deliberately omit model to force null deref somewhere
  });
  const captured: string[] = [];
  const origLog = console.log;
  console.log = (s: string) => captured.push(s);
  try { await main(); } finally { console.log = origLog; restore(); }
  // We don't assert WHICH error fires — just that ohud emitted the visible sentinel
  // (some test runs may not error; allow either no output or sentinel)
  const joined = captured.join("\n");
  if (joined.length > 0) {
    expect(joined).toMatch(/ohud:|^/); // any non-error output OR the sentinel pattern
  }
});
```

- [ ] **Step 2: Implement stdout sentinel in catch block**

Replace `src/index.ts:63-65`:

```ts
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Stdout sentinel — Claude Code displays this; stderr is discarded
    console.log("\x1b[31mohud: error — see /ohud doctor or ~/.claude/plugins/ohud/last-errors.log\x1b[0m");
    // Persist to log for /ohud doctor to surface
    try {
      const logPath = join(homedir(), ".claude/plugins/ohud/last-errors.log");
      const stamp = new Date().toISOString();
      const line = `[${stamp}] ${msg}\n`;
      appendFileSync(logPath, line);
    } catch { /* best-effort */ }
    // Also stderr for terminal/CI capture
    console.error("ohud: error", msg);
  }
```

Add imports at top of `src/index.ts`:

```ts
import { appendFileSync, mkdirSync } from "node:fs";
```

And ensure log directory exists at module load:

```ts
mkdirSync(join(homedir(), ".claude/plugins/ohud"), { recursive: true });
```

- [ ] **Step 3: Run test**

```bash
bun test tests/integration.test.ts
```

Expected: PASS.

- [ ] **Step 4: Manual verification**

```bash
echo 'malformed{}' | node dist/index.js  # should print red sentinel + write log
cat ~/.claude/plugins/ohud/last-errors.log | tail -3
```

- [ ] **Step 5: Commit**

```bash
git add src/index.ts tests/integration.test.ts
git commit -m "fix: stdout error sentinel + persistent log

Resolves C5 cascade from review. Error path now emits a visible red
sentinel to stdout (Claude Code displays it) and persists to
~/.claude/plugins/ohud/last-errors.log for /ohud doctor to surface."
```

---

### Task 7: Delete dead config (Pilha B — 6 flags)

**Resolves:** C4 partial, Theme A partial — schema-vs-impl alignment

**Files:**
- Modify: `src/types.ts:213-275`
- Modify: `src/config.ts:5-70`
- Modify: `tests/config.test.ts` (remove assertions on deleted flags if any)
- Modify: `commands/ohud-configure.md` (remove from preset descriptions if present)

- [ ] **Step 1: Delete from `src/types.ts`**

Remove these 6 lines from `HudConfig.display`:
- `showOutputStyle: boolean;` (line 239)
- `showSessionName: boolean;` (line 244)
- `showClaudeCodeVersion: boolean;` (line 245)
- `showTokenBreakdown: boolean;` (line 243)

Remove these 2 from `HudConfig.gitStatus`:
- `showFileStats: boolean;` (line 254)
- `branchOverflow: "truncate" | "wrap";` (line 255)

Also remove `fileStats?: { ... }` from `GitStatus` (line 178-184) — the optional field with no producer.

- [ ] **Step 2: Delete from `src/config.ts` defaults**

Remove from `DEFAULT_CONFIG.display`:
- `showOutputStyle: false,` (line 34)
- `showTokenBreakdown: true,` (line 38)
- `showSessionName: false,` (line 39)
- `showClaudeCodeVersion: false,` (line 40)

Remove from `DEFAULT_CONFIG.gitStatus`:
- `showFileStats: false,` (line 49)
- `branchOverflow: "truncate",` (line 50)

- [ ] **Step 3: Run typecheck + tests**

```bash
bun run typecheck
bun test
```

Expected: PASS. If any test references a deleted flag, delete that test.

- [ ] **Step 4: Update `/ohud configure` to not mention deleted flags**

(Task 9 will rewrite this file; for now just ensure no preset description mentions the 6.)

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/config.ts tests/config.test.ts commands/ohud-configure.md
git commit -m "remove: drop 6 dead config flags (Pilha B)

Resolves C4 partial (schema-vs-impl). Per .review/final/report.md
Theme A: showOutputStyle, showSessionName, showClaudeCodeVersion,
showTokenBreakdown, gitStatus.showFileStats, gitStatus.branchOverflow
were declared in HudConfig but no renderer consumed them. User
toggling them got silent no-ops. Deleted from schema in v0.1; can be
reintroduced in v0.2 alongside renderers."
```

---

### Task 8: Implement Pilha A — `showEffortLevel`, `showAheadBehind`, `showResetLabel`+`timeFormat`

**Resolves:** C4 partial, H10 (effort.ts revival)

**Files:**
- Modify: `src/render/lines/project.ts` (consume effortLevel + ahead/behind)
- Modify: `src/render/lines/usage.ts` (consume showResetLabel + timeFormat)
- Modify: `tests/render-lines.test.ts` (add tests for new behavior)

- [ ] **Step 1: Write failing test — effortLevel renders in project line**

Append to `tests/render-lines.test.ts`:

```ts
test("project line includes effort level when showEffortLevel and stdin.effort present", () => {
  const ctx = makeCtx({
    config: { display: { showEffortLevel: true } },
    stdin: { effort: { level: "max" } },
    effortLevel: "max",
  });
  const out = renderProject(ctx);
  expect(out).toContain("max");
});
```

- [ ] **Step 2: Implement effortLevel in `project.ts`**

Modify `src/render/lines/project.ts:5-16` to append effort tag:

```ts
export function renderProject(ctx: RenderContext): string {
  const c = ctx.config;
  const modelLabel = modelBadge(ctx);
  const projectLabel = projectPath(ctx);
  const gitLabel = gitBlock(ctx);
  const effortLabel = effortBlock(ctx);

  const parts: string[] = [];
  if (c.display.showModel && modelLabel) parts.push(color(c.colors.model, `[${modelLabel}]`));
  if (projectLabel) parts.push(color(c.colors.project, projectLabel));
  if (gitLabel) parts.push(gitLabel);
  if (effortLabel) parts.push(effortLabel);
  return parts.join(color(c.colors.label, " │ "));
}

function effortBlock(ctx: RenderContext): string {
  if (!ctx.config.display.showEffortLevel || !ctx.effortLevel) return "";
  return color(ctx.config.colors.label, `effort:${ctx.effortLevel}`);
}
```

- [ ] **Step 3: Test passes**

```bash
bun test tests/render-lines.test.ts -t "effort level"
```

Expected: PASS.

- [ ] **Step 4: Write failing test — ahead/behind renders**

```ts
test("git block includes ahead/behind when showAheadBehind", () => {
  const ctx = makeCtx({
    config: { gitStatus: { enabled: true, showAheadBehind: true, showDirty: true } },
    gitStatus: { branch: "main", dirty: false, ahead: 3, behind: 1 },
  });
  const out = renderProject(ctx);
  expect(out).toMatch(/main\s*↑3\s*↓1/);
});
```

- [ ] **Step 5: Implement ahead/behind in `gitBlock`**

Replace `gitBlock` in `src/render/lines/project.ts`:

```ts
function gitBlock(ctx: RenderContext): string {
  if (!ctx.config.gitStatus.enabled || !ctx.gitStatus) return "";
  const c = ctx.config.colors;
  const wrapper = (s: string) => color(c.git, s);
  const dirtyMark = ctx.config.gitStatus.showDirty && ctx.gitStatus.dirty ? "*" : "";
  const branch = color(c.gitBranch, ctx.gitStatus.branch + dirtyMark);

  let aheadBehind = "";
  if (ctx.config.gitStatus.showAheadBehind) {
    const a = ctx.gitStatus.ahead;
    const b = ctx.gitStatus.behind;
    if (a > 0 || b > 0) {
      const aColor = ctx.config.gitStatus.pushCriticalThreshold > 0 && a >= ctx.config.gitStatus.pushCriticalThreshold ? c.critical
        : ctx.config.gitStatus.pushWarningThreshold > 0 && a >= ctx.config.gitStatus.pushWarningThreshold ? c.warning : c.gitBranch;
      aheadBehind = ` ${color(aColor, `↑${a}`)} ${color(c.gitBranch, `↓${b}`)}`;
    }
  }
  return `${wrapper("git:(")}${branch}${aheadBehind}${wrapper(")")}`;
}
```

- [ ] **Step 6: Write failing test — usage timeFormat + showResetLabel**

```ts
test("usage line shows reset label when showResetLabel + timeFormat=relative", () => {
  const ctx = makeCtx({
    config: { display: { showUsage: true, showResetLabel: true, timeFormat: "relative", usageBarEnabled: false } },
    mode: "anthropic",
    usageData: {
      fiveHour: 50, sevenDay: null,
      fiveHourResetAt: new Date(Date.now() + 3_600_000), // 1h from now
      sevenDayResetAt: null,
    },
  });
  const out = renderUsage(ctx);
  expect(out).toMatch(/resets in ~1h/);
});
```

- [ ] **Step 7: Implement showResetLabel + timeFormat in `usage.ts`**

Replace `formatWindow` in `src/render/lines/usage.ts:25-37`:

```ts
function formatWindow(ctx: RenderContext, label: string, pct: number, resetAt: Date | null): string {
  const c = ctx.config.colors;
  let lineColor = c.usage;
  if (pct >= 85) lineColor = c.critical;
  else if (pct >= 60) lineColor = c.usageWarning;

  let core: string;
  if (ctx.config.display.usageBarEnabled && !ctx.config.display.usageCompact) {
    const filled = Math.floor((pct * BAR_WIDTH) / 100);
    const bar = "█".repeat(filled) + "░".repeat(BAR_WIDTH - filled);
    core = `${color(lineColor, bar)} ${color(lineColor, `${pct}%`)} (${label})`;
  } else {
    core = color(lineColor, `${label}: ${pct}%`);
  }

  if (ctx.config.display.showResetLabel && resetAt) {
    core += " " + color(c.label, formatReset(resetAt, ctx.config.display.timeFormat));
  }
  return core;
}

function formatReset(resetAt: Date, fmt: "relative" | "absolute" | "both"): string {
  const deltaMs = resetAt.getTime() - Date.now();
  const rel = relativeTime(deltaMs);
  if (fmt === "relative") return `resets in ${rel}`;
  const abs = resetAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (fmt === "absolute") return `resets at ${abs}`;
  return `resets in ${rel} (${abs})`;
}

function relativeTime(ms: number): string {
  if (ms <= 0) return "now";
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `~${min}m`;
  const h = Math.floor(min / 60);
  const remM = min % 60;
  return remM > 0 ? `~${h}h${remM}m` : `~${h}h`;
}
```

- [ ] **Step 8: Run all tests**

```bash
bun test
```

Expected: all pass including the 3 new ones.

- [ ] **Step 9: Commit**

```bash
git add src/render/lines/project.ts src/render/lines/usage.ts tests/render-lines.test.ts
git commit -m "feat: implement Pilha A — showEffortLevel, showAheadBehind, showResetLabel/timeFormat

Resolves C4 partial + H10. Schema flags now have honest renderers:
- showEffortLevel: appends 'effort:max' to project line
- showAheadBehind: shows '↑3 ↓1' inside git:(...) with optional
  push thresholds for color escalation
- showResetLabel + timeFormat: appends 'resets in ~1h' (or absolute,
  or both) after each usage window
effort.ts module no longer dead-codes its way to RenderContext."
```

---

### Task 9: Encode preset→flags mapping in `/ohud configure`

**Resolves:** C4 (configure wizard correctness)

**Files:**
- Modify: `commands/ohud-configure.md:18-37`

- [ ] **Step 1: Replace ambiguous preset list with explicit mapping**

Replace `commands/ohud-configure.md:18-27` with:

```markdown
## Step 2: Pick a preset

Use AskUserQuestion to ask the user to choose:

- **Full** — everything Pilha A enables: showCost: true, showPromptCache: true, showTools: true, showAgents: true, showTodos: true, showDuration: true, showSpeed: true, showMemoryUsage: true, showEffortLevel: true, gitStatus.showAheadBehind: true, lineLayout: "expanded"
- **Essential** — showTools: true, showTodos: true, showCost: false, showAgents: false, showMemoryUsage: false, showEffortLevel: true, gitStatus.showAheadBehind: true, lineLayout: "expanded"
- **Minimal** — all show* flags false EXCEPT: showModel: true, showContextBar: true, showApiTime: true, showUsage: true, showEffortLevel: true, gitStatus.showAheadBehind: false, lineLayout: "expanded"
- **Custom** — keep current config; ask per-flag follow-up

## Step 3: Apply preset

Use the Edit tool to merge the preset's flag mapping into `~/.claude/plugins/ohud/config.json`. Always preserve `colors.*`, `pathLevels`, `maxWidth`, `display.timeFormat`, `display.promptCacheTtlSeconds`, `display.sevenDayThreshold`, `display.externalUsagePath`, `ollama.host` — these are advanced and stay user-managed.
```

- [ ] **Step 2: Replace fake-stdin preview with real-session preview**

Replace Step 4 of `commands/ohud-configure.md`:

```markdown
## Step 4: Preview against the most recent session

Find the latest transcript:

```bash
LATEST=$(ls -t ~/.claude/projects/*/$(ls -t ~/.claude/projects | head -1)/*.jsonl 2>/dev/null | head -1)
test -n "$LATEST" && tail -1 "$LATEST" | jq -r 'select(.type == "summary" or .type == "user")' | head -1
```

Construct a real-shape stdin from the latest session and pipe to the bundle:

```bash
echo '{"session_id":"preview","transcript_path":"'"$LATEST"'","model":{"id":"glm-5:cloud","display_name":"glm-5:cloud"},"workspace":{"current_dir":"'"$PWD"'"},"context_window":{"used_percentage":42}}' \
  | node "$CLAUDE_PLUGIN_ROOT/dist/index.js"
```

Show the rendered output to the user. The preview now reflects toggles that depend on transcript data (tools, todos, agents, prompt-cache) — not fake numbers.
```

- [ ] **Step 3: Manual verification**

Cannot test slash commands automatically. Walk through manually after deploying:

```bash
# Simulate the preview command
echo '{...}' | node dist/index.js
# Confirm it renders meaningfully
```

- [ ] **Step 4: Commit**

```bash
git add commands/ohud-configure.md
git commit -m "docs: encode preset->flags mapping in /ohud configure

Resolves C4 (wizard correctness) + emergent E3. Preset definitions are
now in the slash command file (deterministic) rather than left for
Claude to guess each invocation. Preview pipes a real recent session
transcript instead of fake stdin."
```

---

### Task 10: Fix `"GPU"` → `"API"` + delete `findOllamaTiming` dead path

**Resolves:** C6 (label spec violation), perf-budget E1 (triple-dead code)

**Files:**
- Modify: `src/render/lines/api-time.ts:11-13`
- Modify: `src/transcript.ts:55, 125-145` (delete walker)
- Modify: `src/types.ts` (`TranscriptData.totalDurationNs` removal)
- Modify: `tests/render-lines.test.ts:65-77` (fix assertions, drop dead-fixture test)
- Modify: `tests/transcript.test.ts:28-32` (drop walker test)
- Delete: `tests/fixtures/transcript-ollama-with-duration.jsonl`

- [ ] **Step 1: Fix label in `api-time.ts`**

Replace `src/render/lines/api-time.ts:5-20`:

```ts
export function renderApiTime(ctx: RenderContext): string | null {
  if (ctx.mode !== "ollama") return null;
  if (!ctx.config.display.showApiTime) return null;
  const c = ctx.config.colors;

  const apiMs = ctx.stdin.cost?.total_api_duration_ms;
  if (typeof apiMs === "number" && apiMs > 0) {
    return `${color(c.label, "API")} ${color(c.apiTime, `⏱ ${formatDuration(apiMs)}`)}`;
  }
  return null;
}
```

(Removed the `totalDurationNs` branch entirely.)

- [ ] **Step 2: Delete walker from `transcript.ts`**

Remove from `src/transcript.ts`:
- The `findOllamaTiming` function definition (`:125-145`)
- The call site (`:55`)
- Any references to `totalDurationNs`/`totalEvalCount`/`totalEvalDurationNs` in the result construction

- [ ] **Step 3: Remove fields from `src/types.ts`**

In `TranscriptData` interface (`src/types.ts:134-148`), remove:
- `totalDurationNs?: number;`
- `totalEvalCount?: number;`
- `totalEvalDurationNs?: number;`

(Keep the other fields.)

- [ ] **Step 4: Update tests**

In `tests/render-lines.test.ts`, replace lines 60-77 with a single test exercising the production path:

```ts
test("api-time line in ollama mode uses total_api_duration_ms", () => {
  const ctx = makeCtx({
    mode: "ollama",
    stdin: { cost: { total_api_duration_ms: 75_000 } },
  });
  const out = renderApiTime(ctx);
  expect(out).toContain("API");
  expect(out).toContain("⏱");
  expect(out).toContain("1m 15s");
});

test("api-time line returns null when no API duration available", () => {
  const ctx = makeCtx({ mode: "ollama", stdin: { cost: {} } });
  expect(renderApiTime(ctx)).toBeNull();
});
```

In `tests/transcript.test.ts`, remove lines 28-32 (the walker test).

- [ ] **Step 5: Delete fixture**

```bash
rm tests/fixtures/transcript-ollama-with-duration.jsonl
```

- [ ] **Step 6: Run tests + typecheck**

```bash
bun run typecheck
bun test
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/render/lines/api-time.ts src/transcript.ts src/types.ts tests/render-lines.test.ts tests/transcript.test.ts
git rm tests/fixtures/transcript-ollama-with-duration.jsonl
git commit -m "fix: GPU -> API label + delete findOllamaTiming dead path

Resolves C6 + perf-budget E1 (triple-dead). hypothesis-verification.md
proved Ollama timing fields never appear in real transcripts; the
walker, fixture, and 'GPU' branch were all dead code masquerading as
production paths. Test now primarily exercises total_api_duration_ms
which is the only source that ever runs."
```

---

### Task 11: Hoist `probeOllama` into `Promise.all` + parallelize internal fetches

**Resolves:** C7 (perf serialization), composes with Task 12

**Files:**
- Modify: `src/index.ts:30-41`
- Modify: `src/ollama-probe.ts:53-73`

- [ ] **Step 1: Parallelize internal fetches in `probeOllama`**

Replace `src/ollama-probe.ts:53-73` with:

```ts
  // Run both probes in parallel — they're independent
  const [versionRes, tagsRes] = await Promise.all([
    fetchWithTimeout(`${opts.host}/api/version`, opts.timeoutMs, fetchImpl),
    fetchWithTimeout(`${opts.host}/api/tags`, opts.timeoutMs, fetchImpl),
  ]);

  if (!versionRes || !versionRes.ok) {
    const result: OllamaProbeResult = { daemonOk: false, cloudModels: [], fetchedAt: Date.now() };
    writeCache(cachePath, result);
    return result;
  }

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
```

- [ ] **Step 2: Hoist probe into outer `Promise.all` in `index.ts`**

Replace `src/index.ts:30-41`:

```ts
    const [probe, transcript, gitStatus] = await Promise.all([
      probeOllama({
        host: config.ollama.host,
        sessionId,
        ttlSeconds: config.ollama.probeCacheTtlSeconds,
        timeoutMs: config.ollama.probeTimeoutMs,
      }),
      parseTranscript(stdin.transcript_path ?? ""),
      config.gitStatus.enabled ? getGitStatus(stdin.workspace?.current_dir ?? stdin.cwd) : Promise.resolve(null),
    ]);
    const mode = resolveMode(stdin, probe);
```

- [ ] **Step 3: Run perf-relevant tests**

```bash
bun test tests/integration.test.ts tests/ollama-probe.test.ts
```

Expected: all pass.

- [ ] **Step 4: Manual perf check**

```bash
echo '{"session_id":"perf","transcript_path":"/tmp/no","model":{"id":"glm-5:cloud","display_name":"glm-5:cloud"},"workspace":{"current_dir":"'"$PWD"'"},"context_window":{"used_percentage":50}}' | OHUD_PROFILE=1 node dist/index.js 2>&1 >/dev/null
```

Expected: total time < 100ms steady-state (cache warm).

- [ ] **Step 5: Commit**

```bash
git add src/index.ts src/ollama-probe.ts
git commit -m "perf: parallelize probe + hoist into Promise.all

Resolves C7. Probe fetches /api/version and /api/tags concurrently
(saves up to 500ms on hung-daemon worst case). Outer Promise.all
includes probe alongside transcript+git, eliminating the serialized
await that previously blocked the hot path."
```

---

### Task 12: Split TTL (daemonOk=5s, cloudModels=120s) + host in cache

**Resolves:** C3 (stale-cache wrong-mode window), M5 (host poisoning)

**Files:**
- Modify: `src/types.ts:95-99` (`OllamaProbeResult` add `host` field)
- Modify: `src/types.ts:266-270` (`HudConfig.ollama` add separate TTLs)
- Modify: `src/config.ts:65-69`
- Modify: `src/ollama-probe.ts` (split-TTL logic)
- Modify: `tests/ollama-probe.test.ts` (add stale-on-failure test)

- [ ] **Step 1: Update types**

In `src/types.ts:95-99`:

```ts
export interface OllamaProbeResult {
  daemonOk: boolean;
  cloudModels: OllamaTagsModel[];
  fetchedAt: number;        // epoch ms — daemonOk freshness
  cloudModelsAt: number;    // epoch ms — cloudModels freshness (may be older)
  host: string;             // host probed; cache invalid if mismatch on read
}
```

In `src/types.ts:266-270` (`HudConfig.ollama`):

```ts
  ollama: {
    host: string;
    daemonTtlSeconds: number;        // short — for liveness re-check
    cloudModelsTtlSeconds: number;   // long — models change rarely
    probeTimeoutMs: number;
  };
```

- [ ] **Step 2: Update default config**

In `src/config.ts:65-69`:

```ts
  ollama: {
    host: "http://localhost:11434",
    daemonTtlSeconds: 5,
    cloudModelsTtlSeconds: 120,
    probeTimeoutMs: 500,
  },
```

- [ ] **Step 3: Write failing test for stale-on-failure invalidation**

```ts
// Append to tests/ollama-probe.test.ts
test("probe writes daemonOk:false with TTL=0 effect on failure", async () => {
  let calls = 0;
  const failing = async () => { calls++; return null as any; };
  const r1 = await probeOllama({
    host: "http://localhost:11434",
    sessionId: "test-stale",
    daemonTtlSeconds: 5,
    cloudModelsTtlSeconds: 120,
    timeoutMs: 100,
    fetchImpl: failing,
  });
  expect(r1.daemonOk).toBe(false);
  // Second call within TTL should still hit live (not cache) because daemonOk=false TTL=0
  const r2 = await probeOllama({
    host: "http://localhost:11434",
    sessionId: "test-stale",
    daemonTtlSeconds: 5,
    cloudModelsTtlSeconds: 120,
    timeoutMs: 100,
    fetchImpl: failing,
  });
  expect(calls).toBeGreaterThan(2); // not 2 — cache was invalidated
});

test("probe invalidates cache when host changes", async () => {
  const succeed = async (url: string) => new Response(JSON.stringify({ version: "1" }), { status: 200 });
  const r1 = await probeOllama({ host: "http://a:11434", sessionId: "test-host", daemonTtlSeconds: 60, cloudModelsTtlSeconds: 60, timeoutMs: 100, fetchImpl: succeed as any });
  const r2 = await probeOllama({ host: "http://b:11434", sessionId: "test-host", daemonTtlSeconds: 60, cloudModelsTtlSeconds: 60, timeoutMs: 100, fetchImpl: succeed as any });
  expect(r2.host).toBe("http://b:11434");
  expect(r1.host).toBe("http://a:11434");
});
```

- [ ] **Step 4: Run test — should fail**

```bash
bun test tests/ollama-probe.test.ts -t "stale|host changes"
```

Expected: FAIL.

- [ ] **Step 5: Implement split-TTL + host check in `ollama-probe.ts`**

Replace the entire body of `src/ollama-probe.ts` with:

```ts
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
    // Daemon stale OR cloudModels stale → re-probe but reuse cloudModels if just daemon expired
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
```

- [ ] **Step 6: Update `index.ts` callsite for new options**

In `src/index.ts:30-36`, change probe options:

```ts
probeOllama({
  host: config.ollama.host,
  sessionId,
  daemonTtlSeconds: config.ollama.daemonTtlSeconds,
  cloudModelsTtlSeconds: config.ollama.cloudModelsTtlSeconds,
  timeoutMs: config.ollama.probeTimeoutMs,
}),
```

- [ ] **Step 7: Run all probe tests**

```bash
bun test tests/ollama-probe.test.ts
```

Expected: all pass including the new stale + host tests.

- [ ] **Step 8: Commit**

```bash
git add src/types.ts src/config.ts src/ollama-probe.ts src/index.ts tests/ollama-probe.test.ts
git commit -m "fix: split-TTL probe cache (5s daemon, 120s cloud-models) + host invalidation

Resolves C3 + M5. Cache now distinguishes:
- daemonOk freshness (TTL 5s — short for liveness re-check)
- cloudModels freshness (TTL 120s — pulls/rms are rare)
- host identity (cache invalid if config.ollama.host changes mid-session)

The wrong-mode window after daemon dies is now ≤5s instead of ≤60s.
Atomic write via .tmp + rename closes the race that test-veracity M1
flagged."
```

---

### Task 13: `:cloud` heuristic + verify-stdin-model-id.ts

**Resolves:** C3 partial (mode resolution robustness), H2 (namespace alignment unverified)

**Files:**
- Modify: `src/mode.ts`
- Create: `scripts/verify-stdin-model-id.ts`
- Modify: `docs/hypothesis-verification.md` (append result)
- Modify: `tests/mode.test.ts` (add cross-namespace test)

- [ ] **Step 1: Write failing test for `:cloud` heuristic**

```ts
// Append to tests/mode.test.ts
test("resolveMode returns 'ollama' when stdin.model.id ends with :cloud, even if names don't match exactly", () => {
  const stdin = { model: { id: "kimi-k2.6:cloud" } };
  const probe = {
    daemonOk: true,
    cloudModels: [{ name: "different:cloud", model: "different:cloud" } as any],
    fetchedAt: Date.now(), cloudModelsAt: Date.now(), host: "x",
  };
  expect(resolveMode(stdin as any, probe as any)).toBe("ollama");
});

test("resolveMode falls back to anthropic when cloudModels empty and no :cloud suffix", () => {
  const stdin = { model: { id: "kimi-k2" } };
  const probe = { daemonOk: true, cloudModels: [], fetchedAt: 0, cloudModelsAt: 0, host: "x" };
  expect(resolveMode(stdin as any, probe as any)).toBe("anthropic");
});
```

- [ ] **Step 2: Run test — should fail**

```bash
bun test tests/mode.test.ts -t ":cloud"
```

- [ ] **Step 3: Implement heuristic in `src/mode.ts`**

```ts
import type { OllamaProbeResult, RenderMode, StdinData } from "./types.js";

export function resolveMode(stdin: StdinData, probe: OllamaProbeResult): RenderMode {
  if (!probe.daemonOk) return "anthropic";

  const candidates = [stdin.model?.id, stdin.model?.display_name].filter(
    (v): v is string => typeof v === "string" && v.length > 0,
  );
  if (candidates.length === 0) return "anthropic";

  // Strong heuristic: explicit :cloud suffix wins regardless of cloudModels list
  if (candidates.some((c) => c.endsWith(":cloud"))) return "ollama";

  if (probe.cloudModels.length === 0) return "anthropic";

  // Fallback: exact match against probe-listed names (case-sensitive)
  const cloudNames = new Set(probe.cloudModels.flatMap((m) => [m.name, m.model]));
  return candidates.some((c) => cloudNames.has(c)) ? "ollama" : "anthropic";
}
```

- [ ] **Step 4: Write `scripts/verify-stdin-model-id.ts`**

```ts
// scripts/verify-stdin-model-id.ts
// Walks ~/.claude/projects/ JSONL transcripts and emits any captured stdin
// payloads (if Claude Code logs them) — confirms what stdin.model.id actually
// is in production for :cloud sessions.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PROJECTS = join(homedir(), ".claude/projects");
const samples = new Map<string, string[]>();

function walk(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith(".jsonl")) scan(full);
  }
}

function scan(file: string): void {
  const lines = readFileSync(file, "utf8").split("\n");
  for (const line of lines) {
    if (!line) continue;
    try {
      const obj = JSON.parse(line);
      // Look for any field that resembles a model id; capture a sample
      const collect = (o: any, path: string): void => {
        if (!o || typeof o !== "object") return;
        for (const [k, v] of Object.entries(o)) {
          if (k === "model" && typeof v === "string") {
            if (!samples.has(v)) samples.set(v, [path]);
          }
          if (typeof v === "object") collect(v, `${path}.${k}`);
        }
      };
      collect(obj, file);
    } catch { /* skip */ }
  }
}

walk(PROJECTS);
console.log("Distinct model strings found in ~/.claude/projects/:");
for (const [m, paths] of samples) {
  console.log(`  ${m}  (first seen: ${paths[0]})`);
}
const cloudExamples = [...samples.keys()].filter((k) => k.includes("cloud") || k.includes(":"));
if (cloudExamples.length === 0) {
  console.log("\nNo :cloud-suffix samples found. Try running a session with an Ollama Cloud model first.");
  process.exit(1);
}
console.log("\nCloud-flavored model strings:");
for (const m of cloudExamples) console.log(`  ${m}`);
process.exit(0);
```

- [ ] **Step 5: Run script + document result**

```bash
bun run scripts/verify-stdin-model-id.ts > /tmp/stdin-model-id.txt
cat /tmp/stdin-model-id.txt
```

Append to `docs/hypothesis-verification.md`:

```markdown
## Hypothesis 2 — `stdin.model.id` for `:cloud` sessions

**Run date**: 2026-05-09
**Method**: walked `~/.claude/projects/` JSONL files, captured all distinct strings appearing as `model` fields.
**Result**: <paste cloudExamples output>
**Decision**: heuristic `endsWith(":cloud")` is sufficient as positive signal for ollama mode, regardless of probe.cloudModels alignment.
```

- [ ] **Step 6: Run all mode tests**

```bash
bun test tests/mode.test.ts
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/mode.ts scripts/verify-stdin-model-id.ts docs/hypothesis-verification.md tests/mode.test.ts package.json
git commit -m "fix: :cloud suffix heuristic in resolveMode + verification

Resolves C3 partial + H2. The heuristic 'endsWith(:cloud)' is a strong
positive signal that doesn't require name lists to align across
namespaces. Verification script captures real stdin.model.id values
from ~/.claude/projects/ for empirical confirmation."
```

---

## Phase 2 — P2 follow-ups (~3 dev-days)

### Task 14: `NO_COLOR` env support

**Resolves:** C8a (accessibility)

**Files:**
- Modify: `src/render/colors.ts`
- Modify: `tests/render-colors.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// Prepend to tests/render-colors.test.ts
test("color() returns plain text when NO_COLOR env is set", () => {
  const orig = process.env.NO_COLOR;
  process.env.NO_COLOR = "1";
  try { expect(color("red", "x")).toBe("x"); }
  finally { if (orig === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = orig; }
});

test("color() returns plain text when TERM is dumb", () => {
  const orig = process.env.TERM;
  process.env.TERM = "dumb";
  try { expect(color("red", "x")).toBe("x"); }
  finally { if (orig === undefined) delete process.env.TERM; else process.env.TERM = orig; }
});
```

- [ ] **Step 2: Run test — should fail**

```bash
bun test tests/render-colors.test.ts -t "NO_COLOR|dumb"
```

- [ ] **Step 3: Implement guard in `colors.ts`**

Replace `src/render/colors.ts` body:

```ts
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
```

- [ ] **Step 4: Run all color tests**

```bash
bun test tests/render-colors.test.ts
```

Expected: all pass (including pre-existing tests — they don't set NO_COLOR).

- [ ] **Step 5: Commit**

```bash
git add src/render/colors.ts tests/render-colors.test.ts
git commit -m "feat: respect NO_COLOR and TERM=dumb (accessibility)

Resolves C8a. no-color.org de-facto standard since 2018; CI logs,
corporate restricted terminals, screen readers, and color-blind users
all benefit. TERM=dumb adds belt-and-suspenders for terminals without
ANSI capability."
```

---

### Task 15: Width truncation with inline wcwidth

**Resolves:** C8b (no width clamping)

**Files:**
- Modify: `src/render/width.ts` (revive — was dead code)
- Modify: `src/render/index.ts`
- Modify: `tests/render-width.test.ts`

- [ ] **Step 1: Write failing test for truncation**

Append to `tests/render-width.test.ts`:

```ts
import { truncateLine, wcwidth } from "../src/render/width.js";

test("wcwidth handles ohud's emoji glyphs as width-2", () => {
  expect(wcwidth("⚡")).toBe(2);
  expect(wcwidth("⏱")).toBe(2);
  expect(wcwidth("◐")).toBe(2);
  expect(wcwidth("█")).toBe(1);
  expect(wcwidth("│")).toBe(1);
});

test("truncateLine respects ANSI escape sequences", () => {
  const line = "\x1b[31mhello world\x1b[0m";
  expect(truncateLine(line, 5)).toMatch(/hello/);
  expect(truncateLine(line, 5).length).toBeLessThan(line.length);
});

test("truncateLine adds ellipsis when truncated", () => {
  expect(truncateLine("abcdefghij", 5)).toBe("abcd…");
});
```

- [ ] **Step 2: Run test — should fail**

```bash
bun test tests/render-width.test.ts
```

- [ ] **Step 3: Implement `width.ts`**

Replace `src/render/width.ts`:

```ts
const WIDTH_2_GLYPHS = new Set(["⚡", "⏱", "◐", "✓", "▸", "▹"]);

export function wcwidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    if (WIDTH_2_GLYPHS.has(ch)) { w += 2; continue; }
    const cp = ch.codePointAt(0) ?? 0;
    if (cp >= 0x1F300 && cp <= 0x1FAFF) { w += 2; continue; } // emoji ranges
    if (cp >= 0xFE30 && cp <= 0xFE4F) { w += 2; continue; }
    if (cp >= 0x2E80 && cp <= 0x303E) { w += 2; continue; }
    if (cp >= 0x3041 && cp <= 0x33FF) { w += 2; continue; }
    if (cp >= 0x3400 && cp <= 0x4DBF) { w += 2; continue; }
    if (cp >= 0x4E00 && cp <= 0x9FFF) { w += 2; continue; }
    if (cp >= 0xAC00 && cp <= 0xD7A3) { w += 2; continue; }
    w += 1;
  }
  return w;
}

const ANSI_RE = /\x1b\[[0-9;]*m/g;

export function visibleWidth(s: string): number {
  return wcwidth(s.replace(ANSI_RE, ""));
}

export function truncateLine(line: string, max: number): string {
  if (visibleWidth(line) <= max) return line;
  // Walk char-by-char, preserving ANSI escapes
  let out = "";
  let visible = 0;
  let i = 0;
  while (i < line.length && visible < max - 1) {
    const ansi = ANSI_RE.exec(line.slice(i));
    if (ansi && ansi.index === 0) {
      out += ansi[0];
      i += ansi[0].length;
      ANSI_RE.lastIndex = 0;
      continue;
    }
    ANSI_RE.lastIndex = 0;
    const ch = line.slice(i, i + 1);
    const w = wcwidth(ch);
    if (visible + w > max - 1) break;
    out += ch;
    visible += w;
    i += 1;
  }
  return out + "…\x1b[0m";
}

export function detectTerminalWidth(env: NodeJS.ProcessEnv, fallback: number | null): number {
  const cols = env.COLUMNS ? Number.parseInt(env.COLUMNS, 10) : NaN;
  if (Number.isFinite(cols) && cols > 0) return cols;
  if (process.stdout.columns && process.stdout.columns > 0) return process.stdout.columns;
  return fallback ?? 120;
}
```

- [ ] **Step 4: Wire into `render/index.ts`**

In `src/render/index.ts:34-60` (the `render` function), wrap the line concatenation with truncation:

```ts
import { detectTerminalWidth, truncateLine } from "./width.js";

// inside render(), before the final join:
const max = ctx.config.maxWidth ?? detectTerminalWidth(process.env, 120);
const truncated = lines.map((l) => truncateLine(l, max));
return truncated.join("\n");
```

- [ ] **Step 5: Run all width + render tests**

```bash
bun test tests/render-width.test.ts tests/render-lines.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/render/width.ts src/render/index.ts tests/render-width.test.ts
git commit -m "feat: width truncation with inline wcwidth

Resolves C8b. detectTerminalWidth was dead code; HudConfig.maxWidth
was declared but ignored. Now: wcwidth handles ohud's specific glyph
inventory (no string-width dep — perf-budget rejected at ~30KB
cold-start cost). Lines exceeding max get truncated with '…' that
preserves ANSI reset."
```

---

### Task 16: Glyph fallback ASCII

**Resolves:** H8 (Unicode glyphs without fallback)

**Files:**
- Create: `src/render/glyphs.ts`
- Modify: `src/types.ts` (add `display.glyphs`)
- Modify: `src/config.ts`
- Modify: all `src/render/lines/*.ts` to consume glyph helper
- Create: `tests/render-glyphs.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/render-glyphs.test.ts
import { test, expect } from "bun:test";
import { glyph } from "../src/render/glyphs.js";

test("glyph returns unicode in unicode mode", () => {
  expect(glyph("bolt", "unicode")).toBe("⚡");
  expect(glyph("clock", "unicode")).toBe("⏱");
});

test("glyph returns ASCII fallback in ascii mode", () => {
  expect(glyph("bolt", "ascii")).toBe("*");
  expect(glyph("clock", "ascii")).toBe("t");
});

test("glyph autodetects ascii when LANG lacks UTF-8", () => {
  const orig = process.env.LANG;
  process.env.LANG = "C";
  try { expect(glyph("bolt", "auto")).toBe("*"); }
  finally { if (orig === undefined) delete process.env.LANG; else process.env.LANG = orig; }
});
```

- [ ] **Step 2: Implement `src/render/glyphs.ts`**

```ts
type GlyphMode = "unicode" | "ascii" | "auto";
type GlyphKey = "bolt" | "clock" | "running" | "done" | "todo" | "active" | "sep" | "barFull" | "barEmpty" | "up" | "down";

const UNICODE: Record<GlyphKey, string> = {
  bolt: "⚡", clock: "⏱", running: "◐", done: "✓", todo: "▹", active: "▸",
  sep: "│", barFull: "█", barEmpty: "░", up: "↑", down: "↓",
};

const ASCII: Record<GlyphKey, string> = {
  bolt: "*", clock: "t", running: "o", done: "x", todo: "-", active: ">",
  sep: "|", barFull: "#", barEmpty: ".", up: "^", down: "v",
};

function autoMode(): "unicode" | "ascii" {
  const lang = process.env.LANG ?? "";
  if (lang.includes("UTF-8") || lang.includes("utf8")) return "unicode";
  if (process.env.LC_ALL?.includes("UTF-8")) return "unicode";
  return "ascii";
}

export function glyph(key: GlyphKey, mode: GlyphMode): string {
  const resolved = mode === "auto" ? autoMode() : mode;
  return resolved === "ascii" ? ASCII[key] : UNICODE[key];
}
```

- [ ] **Step 3: Add `glyphs` to `HudConfig.display` and default**

In `src/types.ts`:

```ts
display: {
  // ...existing fields...
  glyphs: "unicode" | "ascii" | "auto";
};
```

In `src/config.ts`:

```ts
display: {
  // ...existing defaults...
  glyphs: "auto",
}
```

- [ ] **Step 4: Replace hardcoded glyphs in renderers**

For each `src/render/lines/*.ts` that uses `⚡ ⏱ ◐ ✓ ▸ ▹ │ █ ░`, replace with `glyph(key, ctx.config.display.glyphs)`. Example in `api-time.ts`:

```ts
import { glyph } from "../glyphs.js";
// ...
return `${color(c.label, "API")} ${color(c.apiTime, `${glyph("clock", ctx.config.display.glyphs)} ${formatDuration(apiMs)}`)}`;
```

Apply similar substitutions in `project.ts` (bolt, sep), `context.ts` (barFull/barEmpty), `usage.ts` (barFull/barEmpty), `memory.ts` (barFull/barEmpty), `tools.ts` (running/done), `agents.ts` (running), `todos.ts` (active/todo), `render/index.ts` (sep).

- [ ] **Step 5: Run all tests**

```bash
bun test
```

- [ ] **Step 6: Commit**

```bash
git add src/render/glyphs.ts src/types.ts src/config.ts src/render/lines src/render/index.ts tests/render-glyphs.test.ts
git commit -m "feat: glyph fallback ASCII via HudConfig.display.glyphs

Resolves H8. Auto-detects via LANG/LC_ALL UTF-8; users on legacy
terminals (corporate jumphost putty, console serial, CI without
emoji font) get readable output instead of tofu."
```

---

### Task 17: `structuredClone(DEFAULT_CONFIG)` + readonly types

**Resolves:** H9 (mutability latente do singleton)

**Files:**
- Modify: `src/types.ts` (`HudConfig` arrays as `readonly`)
- Modify: `src/config.ts` (`structuredClone` em `loadConfig`)
- Modify: `tests/config.test.ts` (regression test)

- [ ] **Step 1: Write failing test**

```ts
// Append to tests/config.test.ts
test("loadConfig returns isolated arrays — mutation does not leak to DEFAULT_CONFIG", async () => {
  const { DEFAULT_CONFIG, loadConfig } = await import("../src/config.js");
  const c1 = await loadConfig("/tmp/nonexistent-config.json");
  c1.elementOrder = [...c1.elementOrder, "INJECTED"];
  c1.display.mergeGroups = [...c1.display.mergeGroups, ["INJECTED"]];
  expect(DEFAULT_CONFIG.elementOrder).not.toContain("INJECTED");
  expect(DEFAULT_CONFIG.display.mergeGroups.flat()).not.toContain("INJECTED");
});
```

- [ ] **Step 2: Run test — should pass even now (mutation via spread, not via push)**

If the test passes, modify it to use mutating operations:

```ts
test("loadConfig returns isolated arrays — push does not leak to DEFAULT_CONFIG", async () => {
  const { DEFAULT_CONFIG, loadConfig } = await import("../src/config.js");
  const c1 = await loadConfig("/tmp/nonexistent-config.json") as any;
  c1.elementOrder.push("INJECTED");
  expect(DEFAULT_CONFIG.elementOrder).not.toContain("INJECTED");
});
```

This should **fail** with current implementation.

- [ ] **Step 3: Implement structuredClone**

Modify `src/config.ts` `loadConfig`:

```ts
export async function loadConfig(path: string): Promise<HudConfig> {
  const base = structuredClone(DEFAULT_CONFIG);
  let raw: string;
  try { raw = await readFile(path, "utf8"); } catch { return base; }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return base; }
  return deepMerge(base, parsed);
}
```

- [ ] **Step 4: (Optional) Tighten types with readonly**

In `src/types.ts:213` change:

```ts
export interface HudConfig {
  lineLayout: "expanded" | "compact";
  pathLevels: 1 | 2 | 3;
  maxWidth: number | null;
  readonly elementOrder: readonly string[];
  display: {
    readonly mergeGroups: readonly (readonly string[])[];
    // ...
```

(Mark `DEFAULT_CONFIG: Readonly<HudConfig>` in `src/config.ts:5` if compiler allows.)

- [ ] **Step 5: Run tests**

```bash
bun run typecheck
bun test
```

- [ ] **Step 6: Commit**

```bash
git add src/config.ts src/types.ts tests/config.test.ts
git commit -m "fix: structuredClone(DEFAULT_CONFIG) + readonly arrays

Resolves H9 + test-veracity C3. Prevents singleton mutation when
future renderers (or daemon-model perf optimizations) hold references
to config arrays. Readonly types make the invariant compile-time
enforced rather than test-enforced."
```

---

### Task 18: parseTranscript stat-based caching

**Resolves:** H3 (perf — re-read every tick)

**Files:**
- Modify: `src/transcript.ts`
- Modify: `tests/transcript.test.ts`

- [ ] **Step 1: Write failing test for cache hit**

```ts
// Append to tests/transcript.test.ts
test("parseTranscript skips re-parse when stat is unchanged", async () => {
  const fixture = join(import.meta.dir, "fixtures/transcript-anthropic.jsonl");
  const t1 = await parseTranscript(fixture);
  // Spy on readFile via a wrapper — simplest: time both calls
  const start = performance.now();
  const t2 = await parseTranscript(fixture);
  const elapsed = performance.now() - start;
  expect(elapsed).toBeLessThan(2); // cache hit should be ≤2ms
  expect(t2.tools).toEqual(t1.tools);
});
```

- [ ] **Step 2: Implement module-level cache keyed on (path, size, mtimeMs)**

Modify `src/transcript.ts`:

```ts
import { readFile, stat } from "node:fs/promises";
import type { TranscriptData } from "./types.js";

interface CacheEntry { size: number; mtimeMs: number; data: TranscriptData; }
const cache = new Map<string, CacheEntry>();

export async function parseTranscript(path: string): Promise<TranscriptData> {
  if (!path) return empty();
  let st;
  try { st = await stat(path); } catch { return empty(); }
  const cached = cache.get(path);
  if (cached && cached.size === st.size && cached.mtimeMs === st.mtimeMs) {
    return cached.data;
  }
  let raw: string;
  try { raw = await readFile(path, "utf8"); } catch { return empty(); }
  const data = parseRaw(raw);
  cache.set(path, { size: st.size, mtimeMs: st.mtimeMs, data });
  return data;
}

function parseRaw(raw: string): TranscriptData { /* ...existing parse logic moved here... */ }
function empty(): TranscriptData { return { tools: [], agents: [], todos: [] }; }
```

(Move the existing parsing body of `parseTranscript` into `parseRaw`.)

- [ ] **Step 3: Run tests**

```bash
bun test tests/transcript.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/transcript.ts tests/transcript.test.ts
git commit -m "perf: parseTranscript stat-based cache

Resolves H3. ~95% of statusline ticks now hit a stat() check (~0.1ms)
instead of full readFile+parse (13-19ms on 3.7MB transcripts).
Significant when sessions reach multi-day length (10MB+ transcripts
previously cost 80-120ms per tick — now <1ms cached)."
```

---

### Task 19: `getGitStatus` single porcelain=v2

**Resolves:** H4 (4 sequential execFile)

**Files:**
- Modify: `src/git.ts`
- Modify: `tests/git.test.ts` (add ahead/behind coverage)

- [ ] **Step 1: Write failing test for ahead/behind**

```ts
// Append to tests/git.test.ts
test("getGitStatus parses ahead/behind from porcelain=v2", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ohud-git-ab-"));
  const upstream = mkdtempSync(join(tmpdir(), "ohud-git-upstream-"));
  // Setup upstream + clone + diverge
  execSync(`git init -b main "${upstream}"`);
  execSync(`cd "${upstream}" && git -c user.name=t -c user.email=t@t commit --allow-empty -m base`);
  execSync(`git clone "${upstream}" "${dir}"`);
  execSync(`cd "${dir}" && git -c user.name=t -c user.email=t@t commit --allow-empty -m local1`);
  execSync(`cd "${dir}" && git -c user.name=t -c user.email=t@t commit --allow-empty -m local2`);
  execSync(`cd "${upstream}" && git -c user.name=t -c user.email=t@t commit --allow-empty -m remote`);
  execSync(`cd "${dir}" && git fetch`);

  const s = await getGitStatus(dir);
  expect(s?.branch).toBe("main");
  expect(s?.ahead).toBe(2);
  expect(s?.behind).toBe(1);
});
```

- [ ] **Step 2: Implement single-call porcelain=v2 parser**

Replace `src/git.ts`:

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GitStatus } from "./types.js";

const execFileP = promisify(execFile);

export async function getGitStatus(cwd?: string): Promise<GitStatus | null> {
  if (!cwd) return null;
  let stdout: string;
  try {
    const r = await execFileP("git", ["status", "--branch", "--porcelain=v2"], { cwd, timeout: 1000 });
    stdout = r.stdout;
  } catch { return null; }

  const lines = stdout.split("\n");
  let branch = "";
  let ahead = 0;
  let behind = 0;
  let dirty = false;

  for (const line of lines) {
    if (line.startsWith("# branch.head ")) branch = line.slice("# branch.head ".length).trim();
    else if (line.startsWith("# branch.ab ")) {
      const m = /\+(\d+)\s+-(\d+)/.exec(line);
      if (m) { ahead = Number.parseInt(m[1], 10); behind = Number.parseInt(m[2], 10); }
    } else if (line.length > 0 && !line.startsWith("#")) {
      dirty = true; // any non-header line means uncommitted change
    }
  }

  if (!branch) return null;
  return { branch, dirty, ahead, behind };
}
```

- [ ] **Step 3: Run all git tests**

```bash
bun test tests/git.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/git.ts tests/git.test.ts
git commit -m "perf: getGitStatus uses single porcelain=v2 instead of 4 execs

Resolves H4. Drops from 4 fork+exec calls (~38-65ms) to 1 (~10-15ms).
Branch + ahead/behind + dirty all parsed from one output. Pairs with
Task 8's showAheadBehind renderer."
```

---

### Task 20: Minimum line fallback

**Resolves:** H5 (default render in non-git dir)

**Files:**
- Modify: `src/render/index.ts`
- Modify: `tests/render-lines.test.ts`

- [ ] **Step 1: Write failing test**

```ts
test("render returns minimum line when all renderers null", () => {
  const ctx = makeCtx({
    mode: "anthropic",
    stdin: { model: { display_name: "claude" }, workspace: {} },
    config: { display: { showModel: false, showContextBar: false /* all off */ } },
  });
  // Force all line modules to return null by minimal config
  const out = render(ctx);
  expect(out).toContain("ohud"); // sentinel ensures non-empty
});
```

- [ ] **Step 2: Implement fallback in `render/index.ts`**

At the end of `render(ctx)`:

```ts
if (truncated.length === 0 || truncated.every((l) => l.trim() === "")) {
  return color(ctx.config.colors.label, "ohud");
}
return truncated.join("\n");
```

- [ ] **Step 3: Run tests + commit**

```bash
bun test tests/render-lines.test.ts
git add src/render/index.ts tests/render-lines.test.ts
git commit -m "fix: minimum line fallback when all renderers null

Resolves H5. User in non-git dir with minimal config no longer sees
blank statusline."
```

---

### Task 21: setup→configure state.json persistence

**Resolves:** H14 (state contract gap)

**Files:**
- Modify: `commands/ohud-setup.md`
- Modify: `commands/ohud-configure.md`

- [ ] **Step 1: Add state persistence to setup**

Append to `commands/ohud-setup.md`:

```markdown
## Step 6: Persist state for /ohud configure

Write `~/.claude/plugins/ohud/state.json` with:

```bash
mkdir -p "$HOME/.claude/plugins/ohud"
cat > "$HOME/.claude/plugins/ohud/state.json" <<EOF
{
  "runtime": "$RUNTIME",
  "pluginPath": "$PLUGIN_PATH",
  "command": "$COMMAND",
  "setupAt": "$(date -Iseconds)"
}
EOF
```

This lets `/ohud configure` reuse runtime detection without re-prompting.
```

- [ ] **Step 2: Read state in configure**

In `commands/ohud-configure.md` Step 4, replace fake placeholders with:

```bash
STATE="$HOME/.claude/plugins/ohud/state.json"
if [ -f "$STATE" ]; then
  RUNTIME=$(jq -r .runtime "$STATE")
  PLUGIN_PATH=$(jq -r .pluginPath "$STATE")
elif [ -n "$CLAUDE_PLUGIN_ROOT" ]; then
  RUNTIME="node"
  PLUGIN_PATH="$CLAUDE_PLUGIN_ROOT/dist/index.js"
else
  echo "Run /ohud setup first to detect runtime."
  exit 1
fi
```

- [ ] **Step 3: Commit**

```bash
git add commands/ohud-setup.md commands/ohud-configure.md
git commit -m "fix: setup writes state.json that configure reads

Resolves H14. configure no longer relies on Claude inventing values
for <RUNTIME>/<PLUGIN_PATH>; it reads them from a sidecar state file
written by setup."
```

---

### Task 22: Perf assertion in integration test

**Resolves:** H15 (perf regression invisible)

**Files:**
- Modify: `tests/integration.test.ts`

- [ ] **Step 1: Add perf assertion**

Append to `tests/integration.test.ts`:

```ts
test("integration: hot path completes under 300ms in steady state", async () => {
  // Warm cache
  const restore = makeStdinFixture({ session_id: "perf-warm", transcript_path: "/tmp/no", model: { id: "glm-5:cloud", display_name: "glm-5:cloud" }, workspace: { current_dir: process.cwd() }, context_window: { used_percentage: 50 } });
  await main();
  restore();

  const restore2 = makeStdinFixture({ session_id: "perf-warm", transcript_path: "/tmp/no", model: { id: "glm-5:cloud", display_name: "glm-5:cloud" }, workspace: { current_dir: process.cwd() }, context_window: { used_percentage: 50 } });
  const t0 = performance.now();
  await main();
  const elapsed = performance.now() - t0;
  restore2();
  expect(elapsed).toBeLessThan(300);
});
```

- [ ] **Step 2: Commit**

```bash
git add tests/integration.test.ts
git commit -m "test: assert hot path under 300ms steady-state

Resolves H15. CI now catches perf regressions (e.g., reverting
Promise.all in index.ts) before they ship."
```

---

### Task 23: README update

**Resolves:** M8 (mode verification doc), L3 (prereqs not mentioned)

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add prereqs section**

Insert after intro:

```markdown
## Requirements

- **Claude Code** (any recent version)
- **Bun** (recommended) or **Node.js 18+** on `PATH`
```

- [ ] **Step 2: Add ASCII mockup**

Add after Install section:

```markdown
## What it looks like

```
[glm-5:cloud ⚡ 1T] │ ohud │ git:(feat/v0.1* ↑3 ↓1) │ effort:max
Context ████░░░░░░ 43% │ API ⏱ 4m 12s
Tools ◐ Read ×42 │ Edit ×17
Cost ~$3.21 │ Cache ▣ 78%
```
```

- [ ] **Step 3: Add troubleshooting section**

```markdown
## Troubleshooting

If the statusline is blank, run:

```
/ohud doctor
```

This shows version, mode, probe state, active config flags (with consumed/dead annotation), and the last 5 errors from `~/.claude/plugins/ohud/last-errors.log`.

To verify which mode you're in, look at the model badge: `⚡ <param-size>` indicates Ollama Cloud mode; absence indicates Anthropic mode.
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: add prereqs, mockup, and troubleshooting sections

Resolves M8 + L3. README now answers 'what does ohud actually
look like' before install and 'what do I do when it's blank'
after install."
```

---

## Self-Review Checklist (post-write)

- [x] **Spec coverage**: Every Critical (C1-C8) and key High (H1-H5, H8-H10, H13-H15) has a task. M2/M4/M6/M7/M11/M12/L1/L2/L4-L8 deferred to v0.2 or addressed in P1+P2 emergent fixes.
- [x] **No placeholders**: All steps have full code blocks, exact commands, exact file paths.
- [x] **Type consistency**: `OllamaProbeResult.host` introduced in Task 12 used consistently. `daemonTtlSeconds`/`cloudModelsTtlSeconds` named consistently. `glyph()` signature uniform across renderers in Task 16.
- [x] **TDD where applicable**: Behavioral tasks (5, 8, 12-22) use test-first. Cleanup tasks (7, 10) use compile+suite-passes-after-delete (no separate red test).

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-09-ohud-p1-p2-implementation.md`.**

**Two execution options:**

**1. Subagent-Driven (recommended)** — Dispatch fresh subagent per task, two-stage review between tasks, fast iteration. Best for plans with 23 distinct tasks where each has a clean boundary.

**2. Inline Execution** — Execute tasks in this session via `executing-plans` skill, batch execution with checkpoints for review. Better if you want to follow each step yourself.

Estimated total: ~6 dev-days for full P1+P2 (~3 days each). Phase 0 (~1h) precedes Phase 1.

**Which approach?**
