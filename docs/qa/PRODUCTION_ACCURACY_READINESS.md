# Production Accuracy Readiness

Generated: 2026-05-07T19:33:34.136Z

Production deployable: **no**
Certified Reference Alpha deployable: **no**
Demo deployable: **yes**

This is the hard gate for certified-reference outcome matching. It evaluates real image-backed proof rows, active predictions, Gold/human-DING coverage, replayable image evidence, and agent tool completeness.

## Summary

- Active placeholder predictions: 0
- Real model rows: 14
- Real outcome rows: 14/100
- Real band match rate: 0.857
- Official bands covered by real rows: 2/4
- Gold/gold-candidate refs: 0/30
- Human DING reviews: 0/30
- Image-backed Silver+ refs: 13/100
- Missing replayable images: 45
- P0 blockers: 5

## Gates

| Gate | Status | Detail |
| --- | --- | --- |
| No active placeholder predictions | PASS | 0 active placeholder rows. |
| Minimum real certified-reference outcome rows | BLOCKED | 14/100 rows. |
| Real band match-rate floor | BLOCKED | 0.857 match rate on 14 rows. |
| Official band coverage | BLOCKED | 2/4 bands. |
| Gold/gold-candidate eval set | BLOCKED | 0/30 records. |
| Human DING review coverage | BLOCKED | 0/30 records. |
| Image-backed Silver+ coverage | BLOCKED | 13/100 records. |
| No missing replayable images for declared Silver+ refs | PASS | 0 declared-image refs missing local artifacts. |
| Agent tool surface complete | PASS | all required tools available. |
| Agentic eval deployable | BLOCKED | 47 rows need review. |

## Release Modes

| Mode | Status | Blocking reasons |
| --- | --- | --- |
| Demo | PASS | none |
| Certified Reference Alpha | BLOCKED | image_backed_silver_plus: 13/20 image-backed Silver+ refs. |
| Trust Beta | BLOCKED | image_backed_silver_plus: 13/20 image-backed Silver+ refs.; real_outcome_rows: 14/30 rows.; real_band_match_rate: 0.857 on 14 rows.; official_band_coverage: 2/4 bands.; gold_records: 0/10 records.; human_ding_reviews: 0/10 reviews. |
| Production Trust Gate | BLOCKED | image_backed_silver_plus: 13/100 image-backed Silver+ refs.; real_outcome_rows: 14/100 rows.; real_band_match_rate: 0.857 on 14 rows.; official_band_coverage: 2/4 bands.; gold_records: 0/30 records.; human_ding_reviews: 0/30 reviews.; production_gate: One or more hard production gates is blocked.; agentic_eval_deployable: 47 rows need review. |

## P0 Blockers

| Issue | Layer | Detail | Next action |
| --- | --- | --- | --- |
| Not enough real image-backed outcome rows | production_accuracy | 14/100 real outcome rows available. | Attach more user-permitted slab/raw images or allowed remote certified-reference images and run the proof/eval runners. |
| Gold eval set is missing | dataset | 0/30 Gold or gold-candidate records available. | Collect raw pre-submission scan + consent + official returned outcome + human DING review. |
| Human DING review coverage is missing | dataset | 0/30 human-reviewed records available. | Create human review tasks for Gold/gold-candidate records and store DING boxes/severity. |
| Official outcome band coverage is too narrow | dataset | 2/4 official bands covered by real rows. | Add real image-backed examples across Gem, Mint, Near Mint, visible issues, and heavy wear bands. |
| Image-backed Silver+ reference coverage is below production floor | dataset | 13/100 Silver+ references have replayable local images. | Attach user-provided or permissioned local slab/front/back images and hash them as replayable reference artifacts. |

## Missing Image Issues (First 20)

| Issue | Reference | Detail | Next action |
| --- | --- | --- | --- |

## Issue Register

- Structured issues: `data/cert-references/production-readiness/issues.jsonl`
- Full report: `data/cert-references/production-readiness/latest.json`

## Honesty Contract

- The current single remote proof row proves the loop can match one listed certified outcome with real image bytes.
- It does not prove production accuracy.
- Production deployability remains blocked until the gates above pass.
