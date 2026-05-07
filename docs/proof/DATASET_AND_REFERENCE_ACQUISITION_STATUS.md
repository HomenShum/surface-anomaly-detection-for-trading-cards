# Dataset And Reference Acquisition Status

Generated for the full-system flywheel on 2026-05-07.

## Current Local Dataset State

- Configured Roboflow sources: 8
- Downloaded/trainable Roboflow sources: 2
- Local training/eval records: 3349
- Current manifest SHA-256: `24e62f76baf046c7d3ec83d147bbe4fb0a252b4cd06c77cd7ac13e61add28fa2`

Downloaded locally:

- `roboflow_card_grader_v5`
- `roboflow_pokemon_surface_damage_v2`

Configured but still missing local exports:

- `roboflow_scratch_poke_v2`
- `roboflow_pokefrontbackdamage_v1`
- `roboflow_card_condition_29wwd_v1`
- `roboflow_pokemon_card_detection_7aaz7_v1`
- `roboflow_pokemon_cards_segmentation_v2`
- `roboflow_pokemon_card_detection_3_v1`

## How To Complete Dataset Acquisition

Set `ROBOFLOW_API_KEY`, then run:

```powershell
python ml/scripts/ingest_roboflow.py --force
```

If exports are downloaded manually, place each export under:

```text
ml/datasets/raw/roboflow/<source_id>/
```

Then run:

```powershell
python ml/scripts/ingest_roboflow.py --skip-download --allow-missing
pnpm flywheel:full:train-smoke
```

## Current Certified Reference State

- Certified reference rows loaded: 29
- Replayable local Silver+ slab/card images: 0
- Gold records: 0
- Human DING reviews: 0
- Production deployable: false
- Vendor Pilot Alpha deployable: false
- Demo visible-condition assistance deployable: true

## How To Unblock Vendor Pilot Alpha

Attach permitted local slab/card images under:

```text
data/cert-references/slab-images/<cert_id>/
```

Then run:

```powershell
pnpm eval:certrefs:run
pnpm flywheel:full
```

To create Gold records, each record must include:

- raw pre-submission front/back scan
- later official outcome
- human DING review
- consent and usage-rights metadata

No slab-only certified reference is treated as Gold.

