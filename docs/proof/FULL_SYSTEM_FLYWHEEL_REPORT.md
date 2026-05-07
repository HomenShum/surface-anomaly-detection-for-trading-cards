# Full System Flywheel Report

Generated: 2026-05-07T19:33:36.329Z

Overall local loop: **pass**

## Dataset State

- Configured Roboflow sources: 8
- Downloaded/trainable sources: 5
- Missing configured exports: 3
- Local records: 25313
- Manifest SHA-256: 50ba9be93ca008d3775b876ce5d61835322197a0d68d58040f0c01ad74cf0268

## Model + Agent Eval

- Model: ding-detector-v0
- YOLO precision: 0.626
- YOLO recall: 0.449
- Agentic annotation precision: 1.000
- Agentic annotation recall: 1.000
- Agentic claim grounding: 1.000
- Official-grade claim violations: 0

## Live API Probe

- Dataset-card API findings: 2
- Dataset-card evidence manifest: 62c007fc50b596332c14562d36a9218ab4e62a8a51d22150cd05b4c18569f485
- Tauros API findings: 0
- Tauros evidence manifest: a4c6fda85482f6dd5c30ce778382853eb99e37c0e1a9b620484f2cb4436d6f02

## Shareable GIF

- Real DING annotation GIF: public/demo/gifs/real-dataset-card-corner-wear-model-annotations.gif
- GIF bytes: 4786257
- Verification frame: docs/screenshots/real-dataset-card-corner-wear-model-annotations-frame.png

## Command Results

| Step | Status | Required |
| --- | --- | --- |
| dataset_audit | PASS | yes |
| model_eval | PASS | yes |
| agentic_annotations | PASS | yes |
| certrefs_band_eval | PASS | yes |
| agentic_cert_eval | PASS | yes |
| method_flywheel | PASS | yes |
| visible_condition_proof | PASS | yes |
| demo_gate | PASS | yes |
| real_ding_gif | PASS | yes |
| vendor_alpha_gate_expected_blockers | EXPECTED BLOCK | no |

## Remaining Blockers

- dataset:roboflow_pokemon_card_detection_7aaz7_v1: parse_failed: No data.yaml or dataset.yaml found under D:\VSCode Projects\surface_anomaly_detection_model\ml\datasets\raw\roboflow\roboflow_pokemon_card_detection_7aaz7_v1; https://universe.roboflow.com/roboflow-ayy4i/pokemon-card-detection-7aaz7/dataset/1
- dataset:roboflow_pokemon_cards_segmentation_v2: parse_failed: No data.yaml or dataset.yaml found under D:\VSCode Projects\surface_anomaly_detection_model\ml\datasets\raw\roboflow\roboflow_pokemon_cards_segmentation_v2; https://universe.roboflow.com/maestromaxo/pokemon-cards-segmentation/dataset/2
- dataset:roboflow_pokemon_card_detection_3_v1: parse_failed: No data.yaml or dataset.yaml found under D:\VSCode Projects\surface_anomaly_detection_model\ml\datasets\raw\roboflow\roboflow_pokemon_card_detection_3_v1; https://universe.roboflow.com/ferrari-yolo/pokemon-card-detection-3/dataset/1
- vendor-alpha:image_backed_silver_plus_20: 13/20 image-backed Silver+ refs.
- vendor-alpha:human_ding_reviews_10: 0/10 reviews.
- vendor-alpha:agent_grounding_floor: grounding=0.567.
- vendor-alpha:cert_alpha_gate: image_backed_silver_plus: 13/20 image-backed Silver+ refs.
- production:image_backed_silver_plus: 13/100 image-backed Silver+ refs.
- production:real_outcome_rows: 14/100 rows.
- production:real_band_match_rate: 0.857 on 14 rows.
- production:official_band_coverage: 2/4 bands.
- production:gold_records: 0/30 records.
- production:human_ding_reviews: 0/30 reviews.
- production:production_gate: One or more hard production gates is blocked.
- production:agentic_eval_deployable: 47 rows need review.
