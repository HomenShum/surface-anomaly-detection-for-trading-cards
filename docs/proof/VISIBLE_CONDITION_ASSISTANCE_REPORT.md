# Visible Condition Assistance Proof

Generated: 2026-05-08T22:47:18.317Z

## Claim

**Proved now:** AI-assisted visible condition detection demo: real model metadata, open DING dataset audit, DING annotation UI, agent tool-surface checks, and evidence-hash traces are present.

**Not proved yet:**

- PSA/TAG/CGC/BGS-equivalent grading
- production certified-reference outcome accuracy
- Gold raw pre-submission scan alignment
- human DING review agreement
- authenticity, market value, or legal guarantee

## Release State

| Mode | Status |
| --- | --- |
| Demo visible-condition assistance | PASS |
| Vendor Pilot Alpha | BLOCKED |
| Customer Alpha | BLOCKED |
| Production Trust Beta | BLOCKED |

## Dataset + Model

- Open DING records: 25313
- Dataset manifest hash: 50ba9be93ca008d3775b876ce5d61835322197a0d68d58040f0c01ad74cf0268
- Model: ding-detector-v0
- Training run: yolo-20260506T124111Z
- Weights SHA-256: 7b9e0f62007b6d595d9aa7e9eb9596a19e9a2e51dfe7f9433abe74a9febe1a2d
- mAP@50: 0.464
- mAP@50-95: 0.279
- Precision: 0.626
- Recall: 0.449

## Certified References

- Total references: 130
- Silver+: 100
- Replayable Silver+ images: 100
- Gold/gold-candidate records: 30
- Human DING reviews: 30

## Agent + LLM Judge

- Judge mode: deterministic_llm_judge_fallback
- Tool coverage: 0.960
- Grounding: 0.997
- Evidence: 0.969
- Trust safety: 1.000
- Rows needing review: 1
- Agentic annotation eval: pass
- Multimodel annotation precision: 1.000
- Multimodel annotation recall: 1.000
- Multimodel claim grounding: 1.000
- Multimodel hallucinated DING rate: 0.000

## Evidence Trace

- Real inference rows: 1
- Proof-eligible matches: 1
- Complete image SHA-256 artifacts: 2/2
- Findings with SHA-256: 0/0

## Demo Proof Gates

| Gate | Status | Detail |
| --- | --- | --- |
| Open DING dataset audit is verified | PASS | 25313 records. |
| Real DING model metadata exists | PASS | model=ding-detector-v0. |
| YOLO detector metrics are measured | PASS | mAP50=0.46374 recall=0.44897. |
| Random/class-prior baselines exist | PASS | Baseline sanity checks are present in ml/runs/eval_yolo_test_report.json. |
| Certified references are loaded | PASS | 130/20 references. |
| External certified references are not training data | PASS | 0 training-policy violations. |
| TAG references remain link-only/no-bulk-scrape | PASS | 0 TAG policy violations. |
| Agent tool surface covers inspection workflow | PASS | 0 promotion-required tools missing. |
| Agentic annotation fixture eval passes | PASS | C precision=1 grounding=1. |
| Agent judge did not detect official-grade claim failures | PASS | trustSafety=1. |
| Shareable real-DING GIFs exist and loop | PASS | Manifest includes real-ding-annotations GIF entries with loop=infinite. |
| Evidence proof includes SHA-256 image artifacts | PASS | 2 complete image artifact(s); model hash present=true. |

## Vendor Pilot Blockers

| Gate | Status | Detail |
| --- | --- | --- |
| Certified Reference Alpha release mode passes | BLOCKED | no_synthetic_trust_rows: 102 synthetic/generated reference row(s).; image_backed_silver_plus: 10/20 image-backed Silver+ refs. |

## Top Failure Cases

| Layer | Issue | Next action |
| --- | --- | --- |
| source_policy | Synthetic/generated reference cannot count toward trust gates | Keep this row as a demo fixture only, or replace it with user/vendor-provided replayable images and non-generated review evidence. |
| source_policy | Synthetic/generated reference cannot count toward trust gates | Keep this row as a demo fixture only, or replace it with user/vendor-provided replayable images and non-generated review evidence. |
| source_policy | Synthetic/generated reference cannot count toward trust gates | Keep this row as a demo fixture only, or replace it with user/vendor-provided replayable images and non-generated review evidence. |
| source_policy | Synthetic/generated reference cannot count toward trust gates | Keep this row as a demo fixture only, or replace it with user/vendor-provided replayable images and non-generated review evidence. |
| source_policy | Synthetic/generated reference cannot count toward trust gates | Keep this row as a demo fixture only, or replace it with user/vendor-provided replayable images and non-generated review evidence. |
| source_policy | Synthetic/generated reference cannot count toward trust gates | Keep this row as a demo fixture only, or replace it with user/vendor-provided replayable images and non-generated review evidence. |
| source_policy | Synthetic/generated reference cannot count toward trust gates | Keep this row as a demo fixture only, or replace it with user/vendor-provided replayable images and non-generated review evidence. |
| source_policy | Synthetic/generated reference cannot count toward trust gates | Keep this row as a demo fixture only, or replace it with user/vendor-provided replayable images and non-generated review evidence. |
| source_policy | Synthetic/generated reference cannot count toward trust gates | Keep this row as a demo fixture only, or replace it with user/vendor-provided replayable images and non-generated review evidence. |
| source_policy | Synthetic/generated reference cannot count toward trust gates | Keep this row as a demo fixture only, or replace it with user/vendor-provided replayable images and non-generated review evidence. |
| source_policy | Synthetic/generated reference cannot count toward trust gates | Keep this row as a demo fixture only, or replace it with user/vendor-provided replayable images and non-generated review evidence. |
| source_policy | Synthetic/generated reference cannot count toward trust gates | Keep this row as a demo fixture only, or replace it with user/vendor-provided replayable images and non-generated review evidence. |

## Shareable Proof Examples

- Real DING desktop GIF: `public/demo/gifs/real-ding-annotations-tauros-card-desktop.gif`
- Real DING mobile GIF: `public/demo/gifs/real-ding-annotations-tauros-card-mobile.gif`
- Example route: `/examples/roboflow-tauros-real-ding-annotations`

## Next Actions

- Attach 20 user/vendor-permitted local slab/front/back images to declared Silver+ references.
- Run pnpm eval:certrefs:run after local reference images are attached.
- Collect at least 10 human DING reviews for Vendor Pilot Alpha; 30+ for Production Trust Beta.
- Create Gold records from raw pre-submission scans plus returned official outcomes and human DING review.
- Keep agent claims grounded to tool/model/evidence outputs and continue using the LLM-judge replay prompts.
