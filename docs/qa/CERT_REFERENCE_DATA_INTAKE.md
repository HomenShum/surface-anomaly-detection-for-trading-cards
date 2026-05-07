# Certified Reference Data Intake

This repo intentionally blocks production-accuracy claims until the eval set has
real, replayable evidence. Do not bypass these checks with placeholder rows.

## Certified Slab/Reference Images

Use this for PSA/CGC/BGS/TAG images that the user provides with permission.
Do not upload scraped or bulk-cached cert-page images.

Endpoint:

```text
POST /api/cert-references/slab/upload
```

JSON body:

```json
{
  "certId": "psa_154378339",
  "view": "front",
  "filename": "psa-154378339-front.jpg",
  "dataUrl": "data:image/jpeg;base64,...",
  "userProvided": true,
  "consentToStore": true,
  "sourceNote": "Friend-provided slab photo for certified-reference eval."
}
```

Stored output:

```text
data/cert-references/slab-images/<certId>/<front|back|label|other>.<jpg|png|webp>
data/cert-references/slab-images/<certId>/<view>.metadata.json
```

The production gate treats these as replayable eval artifacts, not training
data.

## Human DING Reviews

Use this after a reviewer has inspected the card image and confirmed DING boxes,
severity, and materiality. Clean cards still need an explicit clean-card
attestation.

Endpoint:

```text
POST /api/cert-references/human-ding-reviews
```

Body:

```json
{
  "certId": "psa_154378339",
  "reviewerHandle": "vendor-reviewer",
  "consentToStoreReview": true,
  "reviewedImageSource": "slab_front",
  "cleanCardAttestation": false,
  "dings": [
    {
      "type": "edge_wear",
      "bbox": [2, 32, 6, 42],
      "severity": "minor",
      "materialToGrade": true,
      "note": "Back-left edge whitening visible in the reference image.",
      "source": "human"
    }
  ],
  "notes": "Review based on user-provided slab image."
}
```

Stored output:

```text
data/cert-references/human-ding-reviews.jsonl
```

## Gold Records

Gold requires all of these:

- raw pre-submission scan bytes
- official returned outcome
- human DING review approval, including clean-card attestation when no DINGs
- explicit consent flags

Endpoint:

```text
POST /api/examples/submit-gold
```

Minimum body:

```json
{
  "contributorHandle": "vendor-reviewer",
  "consentPublicAttribution": false,
  "consentPublicExample": false,
  "consentModelTraining": true,
  "humanDingReviewApproved": true,
  "title": "2025 Pokemon Japanese SV11B-Black Bolt #174 Zekrom ex",
  "game": "pokemon",
  "finish": "holo",
  "imageDataUrl": "data:image/jpeg;base64,...",
  "officialOutcome": {
    "grader": "PSA",
    "certNumber": "154378339",
    "certUrl": "https://www.psacard.com/cert/154378339",
    "grade": "NM-MT 8",
    "numericGrade": 8,
    "band": "800-849_near_mint"
  },
  "dings": [],
  "ourPrediction": {
    "benchmarkScore": 0,
    "band": "800-849_near_mint",
    "confidence": 0,
    "matchedKnownOutcome": null,
    "notes": "Awaiting real model replay.",
    "modelVersion": "pending"
  }
}
```

Stored output:

```text
data/examples/gold/<goldId>.json
data/cert-references/gold-records.jsonl
```

## Verification Commands

```text
node scripts/eval/agentic_cert_eval_runner.mjs --check
node scripts/eval/production_accuracy_gate.mjs
node scripts/eval/production_accuracy_gate.mjs --check --mode=demo --strict
node scripts/eval/production_accuracy_gate.mjs --check --mode=certified_reference_alpha --strict
node scripts/eval/production_accuracy_gate.mjs --check --strict
```

## Vendor Batch CLI

For a folder of friend/vendor label or slab photos:

```text
pnpm certs:extract-candidates -- ./vendor-photos --batch vendor_batch_001
pnpm certs:verify-candidates -- --input data/cert-references/vendor-batches/vendor_batch_001.cert_candidates.json
pnpm certs:build-imports -- --input data/cert-references/vendor-batches/vendor_batch_001.verified.json
pnpm certs:materialize-images -- --cert psa_154378339 --front ./vendor-photos/154378339-front.jpg --consent
```

`certs:materialize-images` is the step that turns a metadata-only cert into a
replayable image-backed Silver+ reference. Label-only photos extract cert
candidates, but they do not count as image-backed card outcomes.

Expected current state without real user-provided artifacts:

```text
agent tool surface: pass
demo deployable: yes
certified reference alpha deployable: no, until image-backed Silver+ refs exist
production deployable: no
blocked by: insufficient real rows, image-backed Silver+ refs, Gold records, human reviews, replayable images
```
