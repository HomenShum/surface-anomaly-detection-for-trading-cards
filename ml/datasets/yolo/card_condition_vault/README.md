# Card Condition Vault YOLO Dataset

This directory is the default YOLO export target for the unified DING ontology.

Expected generated layout:

```text
dataset.yaml
images/train/
images/val/
images/test/
labels/train/
labels/val/
labels/test/
```

Run:

```powershell
python ml/scripts/convert_labels.py --manifest ml/datasets/manifests/sample_manifest.jsonl --out ml/datasets/yolo/card_condition_vault
```

Use `--copy-images` only when the source image paths exist locally and redistribution/storage rights are clear.
