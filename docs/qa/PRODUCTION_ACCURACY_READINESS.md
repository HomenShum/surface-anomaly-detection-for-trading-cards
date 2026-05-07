# Production Accuracy Readiness

Generated: 2026-05-07T12:34:27.409Z

Production deployable: **no**
Certified Reference Alpha deployable: **no**
Demo deployable: **yes**

This is the hard gate for certified-reference outcome matching. It evaluates real image-backed proof rows, active predictions, Gold/human-DING coverage, replayable image evidence, and agent tool completeness.

## Summary

- Active placeholder predictions: 0
- Real model rows: 1
- Real outcome rows: 1/100
- Real band match rate: 1.000
- Official bands covered by real rows: 1/4
- Gold/gold-candidate refs: 0/30
- Human DING reviews: 0/30
- Image-backed Silver+ refs: 0/100
- Missing replayable images: 29
- P0 blockers: 5

## Gates

| Gate | Status | Detail |
| --- | --- | --- |
| No active placeholder predictions | PASS | 0 active placeholder rows. |
| Minimum real certified-reference outcome rows | BLOCKED | 1/100 rows. |
| Real band match-rate floor | BLOCKED | 1.000 match rate on 1 rows. |
| Official band coverage | BLOCKED | 1/4 bands. |
| Gold/gold-candidate eval set | BLOCKED | 0/30 records. |
| Human DING review coverage | BLOCKED | 0/30 records. |
| Image-backed Silver+ coverage | BLOCKED | 0/100 records. |
| No missing replayable images for declared Silver+ refs | BLOCKED | 20 declared-image refs missing local artifacts. |
| Agent tool surface complete | PASS | all required tools available. |
| Agentic eval deployable | BLOCKED | 29 rows need review. |

## Release Modes

| Mode | Status | Blocking reasons |
| --- | --- | --- |
| Demo | PASS | none |
| Certified Reference Alpha | BLOCKED | image_backed_silver_plus: 0/20 image-backed Silver+ refs. |
| Trust Beta | BLOCKED | image_backed_silver_plus: 0/20 image-backed Silver+ refs.; real_outcome_rows: 1/30 rows.; real_band_match_rate: 1.000 on 1 rows.; official_band_coverage: 1/4 bands.; gold_records: 0/10 records.; human_ding_reviews: 0/10 reviews. |
| Production Trust Gate | BLOCKED | image_backed_silver_plus: 0/100 image-backed Silver+ refs.; real_outcome_rows: 1/100 rows.; real_band_match_rate: 1.000 on 1 rows.; official_band_coverage: 1/4 bands.; gold_records: 0/30 records.; human_ding_reviews: 0/30 reviews.; production_gate: One or more hard production gates is blocked.; declared_silver_plus_images_closed: 20 declared-image refs missing local artifacts.; agentic_eval_deployable: 29 rows need review. |

## P0 Blockers

| Issue | Layer | Detail | Next action |
| --- | --- | --- | --- |
| Not enough real image-backed outcome rows | production_accuracy | 1/100 real outcome rows available. | Attach more user-permitted slab/raw images or allowed remote certified-reference images and run the proof/eval runners. |
| Gold eval set is missing | dataset | 0/30 Gold or gold-candidate records available. | Collect raw pre-submission scan + consent + official returned outcome + human DING review. |
| Human DING review coverage is missing | dataset | 0/30 human-reviewed records available. | Create human review tasks for Gold/gold-candidate records and store DING boxes/severity. |
| Official outcome band coverage is too narrow | dataset | 1/4 official bands covered by real rows. | Add real image-backed examples across Gem, Mint, Near Mint, visible issues, and heavy wear bands. |
| Image-backed Silver+ reference coverage is below production floor | dataset | 0/100 Silver+ references have replayable local images. | Attach user-provided or permissioned local slab/front/back images and hash them as replayable reference artifacts. |

## Missing Image Issues (First 20)

| Issue | Reference | Detail | Next action |
| --- | --- | --- | --- |
| Certified reference declares slab images but no replayable local artifact is attached | psa_139091062 | PSA 139091062: Bulbasaur Enhanced BSTR Box Topper #133 | Attach permitted front/back images under data/cert-references/slab-images/psa_139091062/, then run pnpm eval:certrefs:run. |
| Certified reference declares slab images but no replayable local artifact is attached | psa_142558447 | PSA 142558447: 2021 Pokemon SWSH FA/Espeon VMAX Fusion Strike Secret #270 | Attach permitted front/back images under data/cert-references/slab-images/psa_142558447/, then run pnpm eval:certrefs:run. |
| Certified reference declares slab images but no replayable local artifact is attached | psa_142558455 | PSA 142558455: 2025 Pokemon DRI EN Cynthia's Garchomp ex Special Illustration Rare #232 | Attach permitted front/back images under data/cert-references/slab-images/psa_142558455/, then run pnpm eval:certrefs:run. |
| Certified reference declares slab images but no replayable local artifact is attached | psa_142558459 | PSA 142558459: Tyranitar V Battle Styles #155 | Attach permitted front/back images under data/cert-references/slab-images/psa_142558459/, then run pnpm eval:certrefs:run. |
| Certified reference declares slab images but no replayable local artifact is attached | psa_142558463 | PSA 142558463: M Ltrs/Zpds/Artcn.GX HF Elite Trainer Box F.A. | Attach permitted front/back images under data/cert-references/slab-images/psa_142558463/, then run pnpm eval:certrefs:run. |
| Certified reference declares slab images but no replayable local artifact is attached | psa_142558471 | PSA 142558471: Meowth #07 | Attach permitted front/back images under data/cert-references/slab-images/psa_142558471/, then run pnpm eval:certrefs:run. |
| Certified reference declares slab images but no replayable local artifact is attached | psa_142558473 | PSA 142558473: 2025 Pokemon CBB3 CS Ceruledge #07 | Attach permitted front/back images under data/cert-references/slab-images/psa_142558473/, then run pnpm eval:certrefs:run. |
| Certified reference declares slab images but no replayable local artifact is attached | psa_148648467 | PSA 148648467: 2025 Pokemon PFL EN Piplup Illustration Rare #098 | Attach permitted front/back images under data/cert-references/slab-images/psa_148648467/, then run pnpm eval:certrefs:run. |
| Certified reference declares slab images but no replayable local artifact is attached | psa_148901879 | PSA 148901879: Iris's Fighting Spirit Special Art Rare #247 | Attach permitted front/back images under data/cert-references/slab-images/psa_148901879/, then run pnpm eval:certrefs:run. |
| Certified reference declares slab images but no replayable local artifact is attached | psa_148901880 | PSA 148901880: 2025 Pokemon M1S JP Mega Gardevoir ex Special Art Rare #087 | Attach permitted front/back images under data/cert-references/slab-images/psa_148901880/, then run pnpm eval:certrefs:run. |
| Certified reference declares slab images but no replayable local artifact is attached | psa_148901881 | PSA 148901881: 2021 Pokemon JPN S-P Pikachu Yu Nagaba x PCG Campaign #208 | Attach permitted front/back images under data/cert-references/slab-images/psa_148901881/, then run pnpm eval:certrefs:run. |
| Certified reference declares slab images but no replayable local artifact is attached | psa_148901886 | PSA 148901886: Tyranitar V Battle Styles #155 | Attach permitted front/back images under data/cert-references/slab-images/psa_148901886/, then run pnpm eval:certrefs:run. |
| Certified reference declares slab images but no replayable local artifact is attached | psa_148901888 | PSA 148901888: 2025 Pokemon MEG EN Mega Kangaskhan ex Special Illustration Rare #182 | Attach permitted front/back images under data/cert-references/slab-images/psa_148901888/, then run pnpm eval:certrefs:run. |
| Certified reference declares slab images but no replayable local artifact is attached | psa_148901889 | PSA 148901889: 2025 Pokemon MEP EN Mega Charizard X ex Ultra-Premium Collection #023 | Attach permitted front/back images under data/cert-references/slab-images/psa_148901889/, then run pnpm eval:certrefs:run. |
| Certified reference declares slab images but no replayable local artifact is attached | psa_148901890 | PSA 148901890: 2020 Pokemon SWSH FA/Snorlax VMAX #142 | Attach permitted front/back images under data/cert-references/slab-images/psa_148901890/, then run pnpm eval:certrefs:run. |
| Certified reference declares slab images but no replayable local artifact is attached | psa_148965567 | PSA 148965567: 2019 P.M. SM Black Star FA/Garch. & Girat.GX Promo | Attach permitted front/back images under data/cert-references/slab-images/psa_148965567/, then run pnpm eval:certrefs:run. |
| Certified reference declares slab images but no replayable local artifact is attached | psa_152528467 | PSA 152528467: Reshiram ex Special Illustration Rare #166 | Attach permitted front/back images under data/cert-references/slab-images/psa_152528467/, then run pnpm eval:certrefs:run. |
| Certified reference declares slab images but no replayable local artifact is attached | psa_154378339 | PSA 154378339: 2025 Pokemon Japanese SV11B-Black Bolt #174 Zekrom ex BW Rare | Attach permitted front/back images under data/cert-references/slab-images/psa_154378339/, then run pnpm eval:certrefs:run. |
| Certified reference declares slab images but no replayable local artifact is attached | psa_69196288 | PSA 69196288: 2019 Pokemon Sun & Moon Reshiram & Charizard GX Unbroken Bonds FA #194 | Attach permitted front/back images under data/cert-references/slab-images/psa_69196288/, then run pnpm eval:certrefs:run. |
| Certified reference declares slab images but no replayable local artifact is attached | psa_69923530 | PSA 69923530: 2022 Pokemon SWSH BSP Special Delivery Charizard Pokemon Center UK-Holo #075 | Attach permitted front/back images under data/cert-references/slab-images/psa_69923530/, then run pnpm eval:certrefs:run. |

## Issue Register

- Structured issues: `data/cert-references/production-readiness/issues.jsonl`
- Full report: `data/cert-references/production-readiness/latest.json`

## Honesty Contract

- The current single remote proof row proves the loop can match one listed certified outcome with real image bytes.
- It does not prove production accuracy.
- Production deployability remains blocked until the gates above pass.
