# Agentic Certified Reference Eval Loop

The proof target is the whole inspection system, not only the DING detector.

```text
cert reference
-> agent tool plan
-> image manipulation / crop tools
-> ML model tools
-> condition-band calibrator
-> cert comparison
-> evidence trace
-> grounded report explanation
-> judge score
-> self-correction proposal
```

## Local Runner

Run:

```bash
pnpm eval:certrefs:agentic
```

Test-safe check mode:

```bash
pnpm test:agentic-certrefs
```

Outputs:

- `data/cert-references/agentic-eval/latest.json`
- `data/cert-references/agentic-eval/latest.judge-prompts.jsonl`
- `docs/qa/AGENTIC_CERT_EVAL_REPORT.md`

The default judge is deterministic and local so the laptop demo has no paid API dependency. The JSONL prompt file is the replay artifact for a future pi-ai/OpenAI judge.

## Current Meaning

This runner can prove:

- certified references are loaded,
- external certs are not being treated as training data,
- TAG remains link-only/no-bulk-scrape,
- placeholder cert predictions are blocked,
- missing real slab/raw image traces are visible,
- missing agent tool surface is visible,
- mismatches become self-correction tasks.

It cannot prove certified-outcome model agreement until real slab/raw images are attached and `pnpm eval:certrefs:run` writes non-placeholder predictions.

## Promotion Gates

A model, prompt, method, or agent-tool version is blocked until:

- no placeholder mirror predictions remain,
- at least five real model traces exist,
- predicted rows have replayable image artifacts,
- at least one Gold/gold-candidate record exists,
- grounding and evidence judge scores pass floors,
- required agent tools are implemented,
- no rows remain in human-review-needed state.

## Tool Surface Gaps

The runner compares the conceptual inspection plan to the current pi-ai/report-agent tools. As of the initial agentic runner, the app has partial tool coverage through:

- `compare_to_cert_reference`
- `crop_finding`
- `request_zoom_animation`
- `rerun_detector_on_crop`
- `glare_check_on_crop`
- `propose_inspection_method`
- `cite_evidence`

The remaining production-grade gaps are:

- `detect_card_boundary`
- `normalize_card`
- `run_severity_scorer`

Those should become real callable tools before a certified-reference outcome alignment claim is promoted.
