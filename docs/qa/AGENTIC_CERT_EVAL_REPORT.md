# Agentic Certified Reference Eval Report

Generated: 2026-05-08T22:19:29.843Z

Deployable: **no**

This evaluates the whole inspection system: agent policy, image-manipulation tools, ML model outputs, calibration logic, evidence readiness, and grounded report explanation. It does not claim official grade prediction.

## Totals

- References: 130
- Real predictions: 130
- Placeholder predictions: 0
- No predictions: 0
- Replayable image refs: 130
- Gold/gold-candidate refs: 30
- Average overall judge score: 0.984
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
| Certified references are loaded | PASS | 130 references judged. |
| External references are not training data | PASS | 0 training-policy violations. |
| TAG remains link-only/no-bulk-scrape | PASS | 0 TAG policy violations. |
| No placeholder mirror predictions | PASS | 0 placeholder predictions found. |
| At least five real model traces | PASS | 130 real predictions available. |
| Gold/gold-candidate eval set exists | PASS | 30 Gold/gold-candidate references. |
| Every predicted row has replayable image evidence | PASS | 0 predicted rows lack replayable images. |
| Average grounding score is promotion-ready | PASS | grounding=0.997 |
| Average evidence score is promotion-ready | PASS | evidence=0.969 |
| Production agent tool surface covers promotion-required plan | PASS | all required tools implemented. |
| No non-pass judge verdicts remain | BLOCKED | 1 rows need review. |

## Failure Buckets

| Bucket | Rows |
| --- | ---: |
| aligned_real_trace | 129 |
| tag_link_only_no_structured_outcome | 1 |

## Lowest-Scoring Rows

| Reference | Outcome | Predicted | Judge | Bucket | Next action |
| --- | --- | --- | ---: | --- | --- |
| TAG J6994233 | see TAG DIG report | 900-949_mint | 0.874 | tag_link_only_no_structured_outcome | Keep TAG as report-convention reference until user-provided screenshots or partner permission are available. |
| PSA 148901889 | GEM MT 10 | 950-1000_gem_pristine | 0.939 | aligned_real_trace | Keep as calibration witness; no method promotion until Gold data and real traces exist. |
| PSA 148901881 | GEM MT 10 | 950-1000_gem_pristine | 0.947 | aligned_real_trace | Keep as calibration witness; no method promotion until Gold data and real traces exist. |
| PSA 142558455 | GEM MT 10 | 950-1000_gem_pristine | 0.969 | aligned_real_trace | Keep as calibration witness; no method promotion until Gold data and real traces exist. |
| PSA 136693729 | NM-MT 8 | 800-849_near_mint | 0.984 | aligned_real_trace | Keep as calibration witness; no method promotion until Gold data and real traces exist. |
| PSA 137437905 | NM 7 | 700-799_visible_issues | 0.984 | aligned_real_trace | Keep as calibration witness; no method promotion until Gold data and real traces exist. |
| PSA 138901043 | EX-MT 6 | 700-799_visible_issues | 0.984 | aligned_real_trace | Keep as calibration witness; no method promotion until Gold data and real traces exist. |
| PSA 139091041 | NM 7 | 700-799_visible_issues | 0.984 | aligned_real_trace | Keep as calibration witness; no method promotion until Gold data and real traces exist. |
| PSA 139091042 | EX-MT 6 | 700-799_visible_issues | 0.984 | aligned_real_trace | Keep as calibration witness; no method promotion until Gold data and real traces exist. |
| PSA 139091051 | NM 7 | 700-799_visible_issues | 0.984 | aligned_real_trace | Keep as calibration witness; no method promotion until Gold data and real traces exist. |
| PSA 139091052 | NM-MT 8 | 800-849_near_mint | 0.984 | aligned_real_trace | Keep as calibration witness; no method promotion until Gold data and real traces exist. |
| PSA 139091058 | NM-MT 8 | 800-849_near_mint | 0.984 | aligned_real_trace | Keep as calibration witness; no method promotion until Gold data and real traces exist. |

## Judge Replay Artifacts

The deterministic local judge is the default laptop-safe judge. Replayable LLM judge inputs are written to:

- `data/cert-references/agentic-eval/latest.judge-prompts.jsonl`

Use those rows with pi-ai/OpenAI later to compare the local judge against a real model judge without changing the eval schema.
