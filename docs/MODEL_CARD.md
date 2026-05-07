# Model Card

## Intended Use

Card Condition Vault provides AI-assisted condition understanding, visible DING annotations, catalog records, and timestamped evidence manifests.

It is not an official PSA, TAG, CGC, BGS, or legal grading replacement.

## Current MVP Model State

- Default served detector: `ding-detector-v0`.
- Underlying checkpoint architecture: YOLOv8n.
- Served detector path: `services/inference-api/app/models/ding-detector-v0.pt`.
- Normalizer: OpenCV contour/perspective pipeline with center-crop fallback.
- Optional anomaly track: Anomalib PatchCore scripts are scaffolded but not required for the MVP demo.

## Trained Alpha Checkpoint

`ding-detector-v0` is the current served alpha checkpoint. It is a YOLOv8n object detector fine-tuned locally on the downloaded Roboflow alpha dataset:

- `roboflow_card_grader_v5`
- `roboflow_pokemon_surface_damage_v2`

The previous synthetic CNN remains in the repo as `synthetic_ding_cnn.pt` for local fallback experiments only.

Latest local metrics:

```json
{
  "architecture": "yolov8n",
  "parameters": 3007208,
  "training_run_id": "yolo-20260506T095906Z",
  "train_images": 2958,
  "val_images": 254,
  "val_instances": 1795,
  "epochs": 2,
  "imgsz": 416,
  "precision": 0.41881,
  "recall": 0.30464,
  "mAP50": 0.28606,
  "mAP50_95": 0.19063,
  "labels": [
    "card",
    "edge_wear",
    "corner_wear",
    "scratch",
    "crease",
    "tear_or_hole",
    "heavy_wear",
    "unknown_damage"
  ]
}
```

This proves the app can load and run a real public-dataset detector that we trained ourselves. The quick CPU run is intentionally short and should be treated as a first real-model alpha, not a production-quality condition model.

## Real-Card Public Dataset Fine-Tune Path

The first licensed public fine-tune sources are downloaded through `ROBOFLOW_API_KEY` and converted locally:

- Roboflow Card Grader v5: 632 images, `Scratch`, `Card`, `Corner Wear`, `Edge Wear`, CC BY 4.0.
- Roboflow Pokemon Surface Damage Detection v2: 1,022 images, `Scratch`, `Hole`, `Crease`, `Damaged_corner`, `Edge Wear`, `heavy wear`, `perfect corner`, `Tear`, CC BY 4.0.

`ml/scripts/ingest_roboflow.py` downloads those exports with `ROBOFLOW_API_KEY`, maps labels into `card`, `edge_wear`, `corner_wear`, `scratch`, `crease`, `tear_or_hole`, `heavy_wear`, and `unknown_damage`, and writes `ml/datasets/manifests/roboflow_alpha_manifest.jsonl`.

Current manifest:

```json
{
  "records": 3349,
  "train": 2958,
  "val": 254,
  "test": 137,
  "manifest_sha256": "24e62f76baf046c7d3ec83d147bbe4fb0a252b4cd06c77cd7ac13e61add28fa2"
}
```

## Experimental Larger Checkpoint

`synthetic-ding-cnn-v0.3-xlarge` has also been trained as a larger experimental checkpoint at `services/inference-api/app/models/synthetic_ding_cnn_xlarge.pt`.

Latest local xlarge metrics:

```json
{
  "architecture": "synthetic-ding-cnn-v0.3-xlarge",
  "parameters": 5503629,
  "train_samples": 720,
  "annotated_samples_used": 15,
  "val_samples": 180,
  "val_accuracy": 0.9167,
  "val_bbox_l1": 0.1514
}
```

This checkpoint is intentionally not the default served model because the served path is now the Roboflow-trained YOLO detector. The xlarge synthetic run remains useful only as an experiment on generated data.

## Known Limitations

- Small public datasets are not enough for production-grade trading card condition assessment.
- Foil, chrome, holo, sleeve reflections, glare, and low light can look like surface damage.
- Generic card damage datasets do not fully represent every game, finish, stock, era, or print process.
- The 2-epoch CPU YOLO run is alpha-only and must not be presented as validated grading accuracy.
- User corrections are training signals, not ground truth until reviewed.

## Licensing Caveat

Ultralytics YOLO is documented by Ultralytics as AGPL-3.0 with enterprise licensing options. Treat YOLO training code and trained weights as prototype-only until commercial licensing is reviewed.

Dataset records with `license_status: verify before commercial use` must not be used for commercial training, benchmarking, or customer-facing claims until permission is confirmed.

## Required Report Disclaimer

This is a timestamped condition evidence record and AI-assisted condition estimate. It is not an official grade or legal guarantee.
