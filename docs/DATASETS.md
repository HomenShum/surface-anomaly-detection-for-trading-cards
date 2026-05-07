# Card Condition Vault Dataset Inventory

This inventory defines the dataset plan for Card Condition Vault: a unified DING ontology, source dataset candidates, manifest schema, verified local seed data, and YOLO export targets. Dataset licenses must be verified before any commercial training or redistribution.

## Verified Local Seed Dataset

The current real local seed dataset is first-party generated and does not use public scans, marketplace images, scraped images, or third-party card assets.

| Artifact | Path | Contract |
| --- | --- | --- |
| Seed images | `ml/datasets/raw/ccv_verified_seed_v1/images/*.png` | 15 deterministic PNG card renders generated locally by `ml/scripts/create_verified_seed_dataset.py`. |
| Seed manifest | `ml/datasets/manifests/ccv_verified_seed_v1.jsonl` | Renderer-authored bounding boxes over the generated images. Covers 10 classes including `card` and all train/val/test splits. |
| Verification metadata | `ml/datasets/manifests/ccv_verified_seed_v1.verification.json` and `ml/datasets/manifests/ccv_verified_seed_v1.audit.json` | Per-dataset class coverage, split coverage, verified license status, and `codex_self_review` judge marker. |
| YOLO export | `ml/datasets/yolo/ccv_verified_seed_v1/` | Detection labels and copied seed images for `train`, `val`, and `test`. |
| Contract tests | `ml/tests/test_verified_seed_dataset.py` | Validates images, labels, classes, splits, bbox bounds, reviewer metadata, and verified license status. |

External public image files are not committed to the repo. Public source metadata is tracked below; future public or marketplace-derived candidates must remain marked `verify before commercial use` until source licensing and export rights are confirmed.

## Verified Public Alpha Sources

These sources are configured for the first licensed real-card YOLO fine-tune. They are not committed into the repo; run the downloader with a Roboflow API key to fetch exports into `ml/datasets/raw/roboflow/`.

| Dataset | Version | Images | Classes | License | Config |
| --- | ---: | ---: | --- | --- | --- |
| Roboflow Card Grader | v5 | 632 | `Scratch`, `Card`, `Corner Wear`, `Edge Wear` | CC BY 4.0 | `roboflow_card_grader_v5` |
| Roboflow Pokemon Surface Damage Detection | v2 | 1,022 | `Scratch`, `Hole`, `Crease`, `Damaged_corner`, `Edge Wear`, `heavy wear`, `perfect corner`, `Tear` | CC BY 4.0 | `roboflow_pokemon_surface_damage_v2` |

## Public Demo Image

The hosted upload demo uses one real photographed card image copied from the verified Roboflow Card Grader v5 export:

```text
apps/web/public/demo/sample-cards/roboflow-tauros-real-card.jpg
public/demo/sample-cards/roboflow-tauros-real-card.jpg
```

Source file:

```text
ml/datasets/raw/roboflow/roboflow_card_grader_v5/test/images/s-l1600---2022-04-26T110438-091_jpg.rf.7180c5cc7e2ecfde7a85126d99b46006.jpg
```

Attribution: Roboflow Card Grader v5, CC BY 4.0, used as an alpha demo fixture to show a real photographed card upload instead of a synthetic render.

Launch ingestion command:

```powershell
$env:ROBOFLOW_API_KEY="replace-with-key"
python ml/scripts/ingest_roboflow.py --force
python ml/scripts/convert_labels.py --manifest ml/datasets/manifests/roboflow_alpha_manifest.jsonl --out ml/datasets/yolo/roboflow_alpha --label-map ml/configs/alpha_label_map.yaml --copy-images
python ml/scripts/train_yolo.py --data ml/datasets/yolo/roboflow_alpha/dataset.yaml --model yolov8n.pt --imgsz 416 --epochs 2 --batch 8 --device cpu --project runs/ding-detector-v0 --name roboflow-alpha-cpu --output services/inference-api/app/models/ding-detector-v0.pt --metrics services/inference-api/app/models/ding-detector-v0.metrics.json
```

If `ROBOFLOW_API_KEY` is not available, the downloader exits without creating fake records. Place manually downloaded YOLOv8 exports under `ml/datasets/raw/roboflow/<source_id>/` and run:

```powershell
python ml/scripts/ingest_roboflow.py --skip-download
```

### Compact Launch Ontology

For the first real-card alpha fine-tune, public labels collapse into:

```text
card
edge_wear
corner_wear
scratch
crease
tear_or_hole
heavy_wear
unknown_damage
```

This keeps the small public datasets from fragmenting into too many weak classes before manual QA expands the ontology again.

## Unified DING Ontology

`DING` is the condition-defect ontology used across manifests and exports. The canonical class IDs live in `ml/configs/label_map.yaml`.

| ID | Class | Description | Example aliases |
| --- | --- | --- | --- |
| 0 | `card` | Visible card body or normalized card region. | trading card, collectible card |
| 1 | `corner` | Generic card corner region when no defect subtype is confirmed. | corner region, card corner |
| 2 | `edge_wear` | Whitening, chipping, dents, or fraying along an edge. | edge chipping, whitening, edge ding |
| 3 | `corner_wear` | Rounded, frayed, bent, or whitened card corners. | corner ding, soft corner, bent corner |
| 4 | `scratch` | Linear scratches, scuffs, print lines, or abrasions. | surface scratch, scuff, print line |
| 5 | `crease` | Fold line, bend mark, wrinkle, or pressure crease. | bend, fold, wrinkle |
| 6 | `hole` | Puncture, missing material, or through-card hole. | puncture, missing material |
| 7 | `tear` | Torn card stock, rip, or split. | rip, split |
| 8 | `dent` | Pressure dent, dimple, impression, or indentation. | surface indent, dimple |
| 9 | `surface_contamination` | Stain, residue, foreign material, discoloration, or contamination. | stain, residue, color transfer |
| 10 | `heavy_wear` | Multiple severe defects or broad wear pattern. | heavy damage, damaged |
| 11 | `unknown_damage` | Visible condition issue that cannot be confidently typed. | defect, anomaly |
| 12 | `glare_uncertain` | Visual ambiguity likely caused by glare, foil reflection, sleeve reflection, or lighting. | glare, reflection |

## Source Dataset Candidates

| Dataset | Primary use | Expected labels | License status | Notes |
| --- | --- | --- | --- | --- |
| Internal Card Condition Vault captures | Primary fine-tuning and validation | DING boxes, image-level condition grades | proprietary/internal | Use only images with documented ownership or releases. |
| Synthetic card defect renders | Bootstrapping rare defects | DING boxes generated from render metadata | project-owned if generated locally | Keep generator seed and render parameters in manifest metadata. |
| Public trading card or collectible card images | Domain pretraining and weak labels | image-level or unlabeled | verify before commercial use | Most marketplace, auction, grading, and scan repositories have usage restrictions. Do not redistribute without written permission. |
| General surface anomaly datasets | Scratch/dent/stain visual pretraining | non-card anomaly masks/classes | varies; verify before commercial use | Useful for encoder pretraining, but domain gap is large. Map labels only when semantically clear. |
| Industrial defect datasets | Scratch, stain, edge/chip transfer learning | anomaly masks/classes | varies; verify before commercial use | Use as auxiliary data; keep source split separate from card-domain validation. |
| Roboflow/Universe card defect projects | Candidate YOLO bootstraps | YOLO boxes if available | verify before commercial use | Confirm project license, export terms, and contributor rights before commercial use. |

## Manifest Schema

Manifest files are JSONL. Each line is one image record:

```json
{
  "image_id": "ccv_sample_0001",
  "source_dataset": "internal_seed",
  "split": "train",
  "image_path": "ml/datasets/raw/internal_seed/images/ccv_sample_0001.jpg",
  "width": 1024,
  "height": 768,
  "license": "proprietary/internal",
  "license_status": "verified",
  "annotations": [
    {
      "class_id": 0,
      "class_name": "corner_wear",
      "bbox_xywh": [32, 40, 80, 72],
      "confidence": 1.0,
      "source_label": "corner ding"
    }
  ],
  "metadata": {
    "card_side": "front",
    "capture_device": "unknown"
  }
}
```

Required fields: `image_id`, `source_dataset`, `split`, `image_path`, `width`, `height`, `license`, `license_status`, and `annotations`.

Allowed splits: `train`, `val`, `test`, `holdout`.

Allowed license statuses: `verified`, `restricted`, `verify before commercial use`.

## Current Manifests

| Manifest | Purpose |
| --- | --- |
| `ml/datasets/manifests/ccv_verified_seed_v1.jsonl` | Verified first-party generated seed dataset with real local images, renderer-authored annotations, 10 classes, and split coverage. |
| `ml/datasets/manifests/ccv_verified_seed_v1.verification.json` | Self-review summary for the local seed dataset. |
| `ml/datasets/manifests/ccv_verified_seed_v1.audit.json` | Programmatic verification output from `ml/scripts/verify_annotated_dataset.py`. |
| `ml/datasets/manifests/sample_manifest.jsonl` | Minimal sample records that exercise clean cards, single defects, and multi-defect labels. |

## YOLO Export Target

`ml/scripts/convert_labels.py` exports records into:

```text
ml/datasets/yolo/card_condition_vault/
  dataset.yaml
  images/
    train/
    val/
    test/
  labels/
    train/
    val/
    test/
```

The YOLO class list excludes `glare_uncertain` by default because glare is treated as a quality/uncertainty warning rather than a confirmed DING box. Image-level uncertainty records remain in the manifest and can still be used for quality-gate training.

Use the verified local seed export for contract checks:

```powershell
python ml/scripts/create_verified_seed_dataset.py
python ml/scripts/verify_annotated_dataset.py
python ml/scripts/build_manifest.py --input ml/datasets/manifests/ccv_verified_seed_v1.jsonl
python ml/scripts/convert_labels.py --manifest ml/datasets/manifests/ccv_verified_seed_v1.jsonl --out ml/datasets/yolo/ccv_verified_seed_v1
python -m pytest ml/tests/test_verified_seed_dataset.py
```

## Commercial Use Rule

Any dataset with an unknown, ambiguous, non-commercial, marketplace, scraped, or contributor-dependent license must be marked:

```yaml
license_status: verify before commercial use
```

Do not use those records for commercial training, model evaluation claims, demos, redistribution, or customer-facing benchmarking until permission is confirmed.
