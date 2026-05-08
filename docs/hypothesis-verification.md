# Ollama timing hypothesis — verification result

**Date:** 2026-05-08
**Transcript tested:** `/Users/lima/.claude/projects/-Users-lima-Projects-ollama-cc-setup/06380ece-2ae7-4965-9c8c-a1998b43f330.jsonl` (481 assistant messages)
**Ollama daemon version:** 0.23.2 (confirmed during pre-flight)
**Model used:** `kimi-k2.6` (Ollama Cloud model, extracted from `message.model` field in transcript)

## Corroboration

All 35 transcripts in the `ollama-cc-setup` project directory were also tested. Every file returned zero hits for every Ollama timing field. The result is not specific to one session or model.

## Result

```
Assistant messages scanned: 481
Ollama timing field hit counts:
  total_duration              0   sample: (no sample)
  load_duration               0   sample: (no sample)
  prompt_eval_count           0   sample: (no sample)
  prompt_eval_duration        0   sample: (no sample)
  eval_count                  0   sample: (no sample)
  eval_duration               0   sample: (no sample)

✗ HYPOTHESIS REJECTED — no Ollama timing fields found in any assistant message.
  Task 7 (transcript.ts) must fall back to stdin.cost.total_api_duration_ms.
  Update the spec §10 to reflect the fallback as the primary path.
```

Exit code: 1

## Observed usage keys in the transcript

The fields actually present in `message.usage` for cloud-model assistant messages:

```
cache_creation, cache_creation_input_tokens, cache_read_input_tokens,
inference_geo, input_tokens, iterations, output_tokens,
server_tool_use, service_tier, speed
```

`speed` carries the string value `"standard"` — a service tier descriptor, not a timing value.
No numeric timing fields of any kind were present.

## Interpretation

Ollama's Anthropic-compatible layer (`/v1/messages`) translates cloud model responses into Anthropic message format. It does NOT propagate Ollama-native timing fields (`total_duration`, `eval_count`, `eval_duration`, etc.) into the translated response body. Claude Code's transcript JSONL only records what the Anthropic SDK receives — so those fields never reach the transcript.

## Decision

- [ ] HYPOTHESIS CONFIRMED — proceed with §10 primary path (sum `total_duration` from transcript).
- [x] HYPOTHESIS REJECTED — Task 7 implements the `cost.total_api_duration_ms` fallback. Spec §10 update required.

## Implications for downstream tasks

- **Task 7 (transcript.ts):** implement the fallback path as the primary (and only) path: sum `cost.total_api_duration_ms` from `stdin`; do NOT walk transcript for `total_duration`. The transcript walk for timing fields can be omitted entirely.
- **Task 19 (gpu-time.ts):** label must be `API ⏱` (not `GPU ⏱`), since we are measuring wall-clock API time, not GPU compute time. This is a user-visible change from the original spec.
- **Task 28 (duration.ts) + tok/s:** `eval_count`/`eval_duration` did not survive the translation. `showSpeed` cannot be computed from transcript data in v0.1. The tok/s line renders nothing (hidden) for Ollama Cloud sessions unless a future Ollama API surfaces per-response timing.
