# Card Condition Vault Datasets

This directory is the local staging area for Card Condition Vault data.

Tracked files should stay limited to manifests, README files, export metadata, and verified first-party seed data. Raw downloads, third-party archives, and generated exports should remain untracked unless a dataset has explicit redistribution rights.

## Layout

```text
ml/datasets/
  manifests/
    local_seed_manifest.jsonl
    local_seed_verification.json
    sample_manifest.jsonl
  seed/
    first_party_generated_v1/
      images/
  raw/
    <dataset_name>/
  yolo/
    card_condition_vault/
    card_condition_vault_seed/
```

## Verified Local Seed Contract

`ml/scripts/generate_seed_dataset.py` creates the first-party local seed dataset. It writes deterministic PNG images, a JSONL manifest with hand-authored boxes, and verification metadata with SHA-256 hashes. No external public datasets are used by this seed.

Run the contract checks with:

```powershell
python ml/scripts/generate_seed_dataset.py
python ml/scripts/build_manifest.py --input ml/datasets/manifests/local_seed_manifest.jsonl
python ml/scripts/convert_labels.py --manifest ml/datasets/manifests/local_seed_manifest.jsonl --out ml/datasets/yolo/card_condition_vault_seed --copy-images
python -m pytest tests/datasets/test_local_seed_dataset.py
```

## License Handling

Use `verify before commercial use` for any record or source with unknown, ambiguous, scraped, marketplace, non-commercial, or contributor-dependent rights. Those records are placeholders until the rights are confirmed.

## Basic Workflow

1. Add or update manifest JSONL records.
2. Validate and normalize records with `ml/scripts/build_manifest.py`.
3. Export YOLO labels with `ml/scripts/convert_labels.py`.
4. Review `dataset.yaml` and empty-label files before training.
