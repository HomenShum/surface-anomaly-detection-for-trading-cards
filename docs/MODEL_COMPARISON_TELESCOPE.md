# Model Comparison: DING-detector-v0 vs Princeton CIL Telescope

Honest analyst-diagnostic comparison of our deployed alpha detector against Princeton Computational Imaging Lab's **Telescope: Learnable Hyperbolic Foveation for Ultra-Long-Range Object Detection**.

This is not a benchmark. Telescope solves ultra-long-range automotive detection; we solve trading-card defect detection. The useful comparison is the scale-imbalance idea: tiny objects are easy to miss unless the model or pipeline deliberately magnifies the regions that matter.

Last reviewed: 2026-05-06.

## TL;DR

- Our model is an MVP detector, not a research detector: YOLOv8n nano, about 3M parameters, 6 MB weights, trained for 8 CPU epochs on 3,349 Roboflow records.
- Served v0 metrics from Ultralytics training: mAP50 `0.46374`, mAP50-95 `0.27864`, precision `0.62639`, recall `0.44897`.
- New object-level eval script now adds the missing sanity baselines plus per-class and per-region breakdowns.
- Telescope is a two-stage research model: learnable hyperbolic foveation transform plus high-resolution detector using a foundation encoder and Deformable DETR head.
- Telescope reports a 76% relative mAP improvement at extreme range on its task. That does not transfer directly to us, but the foveation and two-stage decomposition ideas are relevant.

## Current Model Snapshot

Audited from `services/inference-api/app/models/ding-detector-v0.metrics.json`, `docs/MODEL_CARD.md`, and the current eval report:

| Property | Value |
|---|---|
| Architecture | YOLOv8n, single-stage detector |
| Base weights | `yolov8n.pt` |
| Parameters | about 3M |
| Disk size | 6.2 MB |
| Training data | Roboflow Card Grader v5 + Roboflow Pokemon Surface Damage v2 |
| Records | 3,349 total: 2,958 train / 254 val / 137 test |
| Classes | `card`, `edge_wear`, `corner_wear`, `scratch`, `crease`, `tear_or_hole`, `heavy_wear`, `unknown_damage` |
| Training compute | CPU, 8 epochs, batch 4, image size 512 |
| Served metrics | mAP50 `0.46374`, mAP50-95 `0.27864`, precision `0.62639`, recall `0.44897` |
| Runtime role | Real alpha checkpoint behind `/scan/analyze` |
| Evidence | SHA-256 hashes, report JSON, model version, timestamp, verifier route |
| Mock fallback | Off by default in launch checks |

## New Baseline Eval

Implemented in `ml/scripts/eval_models.py`.

Command:

```powershell
python ml\scripts\eval_models.py `
  --data ml\datasets\yolo\roboflow_alpha\dataset.yaml `
  --weights services\inference-api\app\models\ding-detector-v0.pt `
  --output ml\runs\eval_yolo_test_report.json `
  --conf 0.25 `
  --iou 0.5
```

Full test split result, 137 images / 890 labeled objects:

| Evaluated system | Precision | Recall | F1 | TP | FP | FN |
|---|---:|---:|---:|---:|---:|---:|
| Random boxes/classes | 0.001 | 0.001 | 0.001 | 1 | 821 | 889 |
| Class-prior fixed regions | 0.004 | 0.003 | 0.004 | 3 | 819 | 887 |
| Trained `ding-detector-v0` | 0.648 | 0.503 | 0.567 | 448 | 243 | 442 |

This does not replace mAP. It is an object-level precision/recall sanity check with greedy IoU matching at 0.5. It is useful because it exposes where the model is failing.

### Per-Class Breakdown

| Class | Precision | Recall | F1 | Support |
|---|---:|---:|---:|---:|
| `card` | 1.000 | 1.000 | 1.000 | 71 |
| `corner_wear` | 0.618 | 0.743 | 0.675 | 381 |
| `crease` | 0.417 | 0.385 | 0.400 | 26 |
| `edge_wear` | 0.320 | 0.045 | 0.079 | 178 |
| `heavy_wear` | 0.429 | 0.375 | 0.400 | 8 |
| `scratch` | 0.722 | 0.323 | 0.446 | 217 |
| `tear_or_hole` | 0.333 | 0.333 | 0.333 | 9 |

Interpretation:

- `card` detection is solved for this dataset slice.
- `corner_wear` is the first usable defect class.
- `edge_wear` recall is the biggest near-term weakness.
- `scratch` precision is decent but recall is low, which matches the glare/surface ambiguity risk.
- Rare classes are too under-supported for confident claims.

### Per-Region Breakdown

| Region | Precision | Recall | F1 | Support |
|---|---:|---:|---:|---:|
| Center | 0.773 | 0.725 | 0.748 | 244 |
| Corner | 0.563 | 0.561 | 0.562 | 360 |
| Edge | 0.670 | 0.241 | 0.355 | 286 |

Interpretation:

- The model is much stronger on center and corner regions than edge regions.
- Telescope-style foveation is relevant because our model is failing on small structured regions, especially edges.
- The next data push should prioritize edge-wear examples and edge-strip crops.

## What Telescope Is

Confirmed from the Princeton CIL project page:

| Property | Telescope |
|---|---|
| Task | Ultra-long-range object detection for autonomous highway driving |
| Architecture | Two-stage detector |
| Stage 1 | Lightweight network predicts a learnable hyperbolic foveation transform |
| Stage 2 | High-resolution detector with pre-trained foundation encoder + Deformable DETR head |
| Box space | Detects in transformed/Riemannian space and maps boxes back |
| Reported gain | 76% relative mAP improvement at extreme ranges |
| Baselines named | DETR, DINO, RFLA, RVSA |
| Product status | Research preprint/project page, not a deployed evidence vault |

Source: https://princeton-computational-imaging.github.io/Telescope/

## Side-By-Side

| Dimension | DING-detector-v0 | Telescope |
|---|---|---|
| Problem | Flat card defect detection | Highway long-range object detection |
| Main challenge | Tiny DINGs, glare, edge/corner scale imbalance | Distant objects occupying very few pixels |
| Stages | One detector after OpenCV normalization | Foveation stage + detector stage |
| Encoder | YOLOv8n CSP backbone | Foundation encoder |
| Detection head | YOLO head | Deformable DETR |
| Resampling | Fixed perspective normalization | Learnable hyperbolic foveation |
| Eval rigor | mAP + new baselines/per-class/per-region object eval | Baselines plus distance-stratified mAP |
| Deployment | Local FastAPI + web evidence workflow | Research artifact |

## Portable Ideas For Us

1. **Region foveation before detection**

   Our equivalent of a far-away object is a tiny edge or corner DING. A practical v0.2 experiment is not full hyperbolic foveation; it is edge/corner magnification:

   ```text
   normalized card -> edge/corner warp or crop grid -> detector/classifier -> map boxes back
   ```

2. **Two-stage decomposition**

   Split localization and classification:

   ```text
   OpenCV/card geometry proposer -> edge/corner/surface crops -> fine defect classifier
   ```

   This is much cheaper than a full Telescope-style model and directly targets the current edge-recall weakness.

3. **Foundation encoder transfer**

   With only 3.3K records, a frozen DINOv2/SAM-style encoder with a lightweight defect head may outperform training YOLOv8n deeper on noisy labels.

## What We Are Already Better At

These are product/engineering advantages, not model-quality advantages:

- We have a working end-to-end loop with `/health`, `/models/current`, `/scan/analyze`, `/evidence/verify`, SHA-256 evidence, and web UI.
- The detector is CPU-feasible and small enough for a laptop demo.
- The app fails honestly when inference is unavailable; it does not silently invent detections in launch checks.

## Next ML Moves

1. **Use the new eval report as the baseline gate** before every new checkpoint.
2. **Add more edge-wear data** and edge-strip crops first, because edge recall is only `0.045`.
3. **Train a longer GPU v0.1** on the same data, then compare with the same object-level report and Ultralytics mAP.
4. **Prototype a two-stage region classifier** using corner/edge crops before attempting full learnable foveation.
5. **Try DINOv2 features** as a frozen-backbone candidate once baseline eval is stable.

## Artifacts

- New eval script: `ml/scripts/eval_models.py`
- Full test eval: `ml/runs/eval_yolo_test_report.json`
- Eval tests: `ml/tests/test_eval_models.py`
- Served model metrics: `services/inference-api/app/models/ding-detector-v0.metrics.json`
- Model card: `docs/MODEL_CARD.md`
