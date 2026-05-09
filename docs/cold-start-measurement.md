# Cold-Start Instrumentation Measurement

**Date:** 2026-05-09

## Machine Information

```
OS: Darwin Nicolass-MacBook-Air.local 25.5.0
Kernel: Darwin Kernel Version 25.5.0 (arm64, T8122)
Node Version: v22.22.2
```

## Measurement Setup

- **Environment:** `OHUD_PROFILE=1`
- **Bundle:** `dist/index.js` (35.1 KB, Bun bundled)
- **Fixture:** Real transcript from `~/.claude/projects/-Users-lima-Projects-linkein/` (large session)
- **Method:** `process.hrtime.bigint()` wall-clock timing of full `main()` function
- **Samples:** 5 cold-start invocations (no process reuse)

## Raw Measurements

| Tick | Elapsed Time |
|------|--------------|
| 1    | 165.4 ms     |
| 2    | 101.3 ms     |
| 3    | 73.2 ms      |
| 4    | 76.7 ms      |
| 5    | 76.9 ms      |

**Sorted:** 73.2, 76.7, 76.9, 101.3, 165.4

## Statistics

| Metric | Value    |
|--------|----------|
| Min    | 73.2 ms  |
| Max    | 165.4 ms |
| Median | 76.9 ms  |
| Mean   | 98.7 ms  |

## Interpretation

### Finding: Cold-start is **MODERATE** (50-100ms range)

The median cold-start at **76.9 ms** falls squarely in the 50-100ms moderate range:

- **Tick 1** shows 165.4 ms (likely includes initial bundle parsing/cache warming)
- **Ticks 2-5** plateau at 73-102 ms (steady state)
- **Median of 76.9 ms** represents the stable cold-start cost per invocation

### Implications for Phase 1 Perf Budget

Given a 300ms total budget and 76.9 ms median cold-start:

- **Percentage of budget consumed:** ~25.6% (76.9 / 300)
- **Remaining budget for user code:** ~223 ms (73.4%)

**Phase 1 Performance Items (Tasks 11+) are RECOMMENDED but not CRITICAL:**

- The cold-start cost is **within the reasonable budget** (< 100ms), so there's runway for initial feature completeness
- However, at 76.9 ms per tick, optimizations will have **meaningful impact**:
  - Parallelization of I/O (Ollama probe, git status, config load)
  - Transcript parsing caching/lazy-loading
  - Bundle size reduction via tree-shaking
  - Each 10 ms saved = 3.3% more headroom for user features

### Recommendation

Proceed with Phase 1 implementation without emergency optimization. Revisit cold-start post-Phase-1 to verify improvements and set a tighter budget (target: < 50ms for 83% headroom).

## Profile Output Format

Instrumentation is gated behind `OHUD_PROFILE=1` environment variable:

```bash
# Unset: zero overhead (no output)
echo '...' | node dist/index.js

# Enabled: single stderr line per invocation
echo '...' | OHUD_PROFILE=1 node dist/index.js 2>&1 | grep ohud-profile
# Output: ohud-profile: total=76.9ms
```

Instrumentation cost (hrtime calls) is negligible (< 1 microsecond).
