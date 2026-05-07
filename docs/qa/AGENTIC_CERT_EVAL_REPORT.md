# Agentic Certified Reference Eval Report

Generated: 2026-05-07T12:34:27.090Z

Deployable: **no**

This evaluates the whole inspection system: agent policy, image-manipulation tools, ML model outputs, calibration logic, evidence readiness, and grounded report explanation. It does not claim official grade prediction.

## Totals

- References: 29
- Real predictions: 0
- Placeholder predictions: 0
- No predictions: 29
- Replayable image refs: 0
- Gold/gold-candidate refs: 0
- Average overall judge score: 0.546
- Missing promotion tools: 0

## Current Agent Tool Surface

Implemented pi-ai/report-agent tools detected: 19

| Conceptual tool | Production status | Implemented by |
| --- | --- | --- |
| get_cert_reference | partial | compare_to_cert_reference |
| load_cert_images | partial | crop_finding |
| detect_card_boundary | implemented | detect_card_boundary |
| normalize_card | implemented | normalize_card |
| crop_corners | partial | crop_finding |
| crop_edges | partial | crop_finding |
| crop_surface | partial | crop_finding |
| run_ding_detector | partial | rerun_detector_on_crop |
| run_glare_check | partial | glare_check_on_crop, evaluate_glare_risk |
| run_severity_scorer | implemented | run_severity_scorer |
| run_condition_band_calibrator | partial | compare_to_cert_reference |
| compare_to_cert_reference | implemented | compare_to_cert_reference |
| cite_evidence | implemented | cite_evidence |
| flag_mismatch | partial | compare_to_cert_reference |
| create_human_review_task | implemented | create_human_review_task |

## Gates

| Gate | Status | Detail |
| --- | --- | --- |
| Certified references are loaded | PASS | 29 references judged. |
| External references are not training data | PASS | 0 training-policy violations. |
| TAG remains link-only/no-bulk-scrape | PASS | 0 TAG policy violations. |
| No placeholder mirror predictions | PASS | 0 placeholder predictions found. |
| At least five real model traces | BLOCKED | 0 real predictions available. |
| Gold/gold-candidate eval set exists | BLOCKED | 0 Gold/gold-candidate references. |
| Every predicted row has replayable image evidence | PASS | 0 predicted rows lack replayable images. |
| Average grounding score is promotion-ready | BLOCKED | grounding=0.45 |
| Average evidence score is promotion-ready | BLOCKED | evidence=0.401 |
| Production agent tool surface covers promotion-required plan | PASS | all required tools implemented. |
| No non-pass judge verdicts remain | BLOCKED | 29 rows need review. |

## Failure Buckets

| Bucket | Rows |
| --- | ---: |
| missing_replayable_image | 28 |
| tag_link_only_no_structured_outcome | 1 |

## Lowest-Scoring Rows

| Reference | Outcome | Predicted | Judge | Bucket | Next action |
| --- | --- | --- | ---: | --- | --- |
| PSA 134162375 | EX-MT 6 | none | 0.498 | missing_replayable_image | Run pnpm eval:certrefs:run after images are attached, then pnpm eval:certrefs:bands. |
| PSA 137437906 | EX-MT 6 | none | 0.498 | missing_replayable_image | Run pnpm eval:certrefs:run after images are attached, then pnpm eval:certrefs:bands. |
| PSA 138014353 | EX 5 | none | 0.498 | missing_replayable_image | Run pnpm eval:certrefs:run after images are attached, then pnpm eval:certrefs:bands. |
| PSA 138901043 | EX-MT 6 | none | 0.498 | missing_replayable_image | Run pnpm eval:certrefs:run after images are attached, then pnpm eval:certrefs:bands. |
| PSA 139091042 | EX-MT 6 | none | 0.498 | missing_replayable_image | Run pnpm eval:certrefs:run after images are attached, then pnpm eval:certrefs:bands. |
| PSA 139091059 | EX 5 | none | 0.498 | missing_replayable_image | Run pnpm eval:certrefs:run after images are attached, then pnpm eval:certrefs:bands. |
| PSA 139091081 | EX-MT 6 | none | 0.498 | missing_replayable_image | Run pnpm eval:certrefs:run after images are attached, then pnpm eval:certrefs:bands. |
| PSA 142558464 | EX-MT 6 | none | 0.498 | missing_replayable_image | Run pnpm eval:certrefs:run after images are attached, then pnpm eval:certrefs:bands. |
| PSA 139091062 | NM-MT 8 | none | 0.563 | missing_replayable_image | Attach user-permitted slab front/back images under data/cert-references/slab-images/<cert_id>/. |
| PSA 142558447 | GEM MT 10 | none | 0.563 | missing_replayable_image | Attach user-permitted slab front/back images under data/cert-references/slab-images/<cert_id>/. |
| PSA 142558455 | GEM MT 10 | none | 0.563 | missing_replayable_image | Attach user-permitted slab front/back images under data/cert-references/slab-images/<cert_id>/. |
| PSA 142558459 | MINT 9 | none | 0.563 | missing_replayable_image | Attach user-permitted slab front/back images under data/cert-references/slab-images/<cert_id>/. |

## Judge Replay Artifacts

The deterministic local judge is the default laptop-safe judge. Replayable LLM judge inputs are written to:

- `data/cert-references/agentic-eval/latest.judge-prompts.jsonl`

Use those rows with pi-ai/OpenAI later to compare the local judge against a real model judge without changing the eval schema.
