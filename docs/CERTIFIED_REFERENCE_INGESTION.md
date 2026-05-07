# Certified Reference Ingestion

The user scan/upload flow and the training/evaluation flow are intentionally separate.

User flow:

```text
scan/upload -> quality checks -> DING report -> catalog/evidence
```

Reference pipeline:

```text
cert reference -> API/user-provided artifact ingestion -> model run -> comparison -> eval gates -> promotion decision
```

## MVP Surface

- UI: `/certs/import`
- API: `/api/certs/import`
- Worker: `pnpm certrefs:worker`
- Eval: `pnpm eval:certrefs`
- Agentic system eval: `pnpm eval:certrefs:agentic`
- Certified reference dashboard: `/benchmarks/certified-references`
- Seed data: `data/cert-references/seed.json`
- Reports:
  - `docs/qa/CERT_REFERENCE_INGESTION_REPORT.md`
  - `docs/qa/CERT_REFERENCE_EVAL_REPORT.md`
  - `docs/qa/AGENTIC_CERT_EVAL_REPORT.md`

## Provider Rules

PSA references are API-first when `PSA_PUBLIC_API_KEY` or `PSA_API_KEY` is configured. Without credentials, the app stores the reference as a reviewable Silver+ candidate using seed/manual metadata.

TAG references are link-only unless the user provides screenshots/artifacts or TAG grants permission. The worker intentionally does not bulk scrape TAG DIG reports.

## Local Label OCR

The import route accepts image uploads and uses the local OCR adapter when available:

```text
uploaded label/slab photo
-> temporary local image
-> OpenCV label-like crop detection
-> Tesseract OCR over full image + crops
-> regex cert extraction
-> PSA API-first verification queue
```

Helper script:

```bash
python scripts/certs/psa_label_ocr.py path/to/label-batch.jpg --json
```

Runtime requirements:

```bash
python -m pip install ".[ocr]"
```

The Python package provides `pytesseract`; the machine still needs the Tesseract OCR CLI installed and available on `PATH`.

The helper does not persist raw images, verify certs, or train models. It returns OCR text only.

## Trust Tiers

- `silver`: official/certified reference metadata or report link.
- `silver_plus`: certified outcome plus front/back slab images may exist at the external cert page, but images are not cached or training data.
- `gold_candidate`: raw pre-submission scan, official outcome, consent, and human DING review are present or pending review.

## Promotion Gates

`pnpm eval:certrefs` writes a non-deployable report until:

- external certified references are not marked training-allowed,
- TAG no-bulk-scrape policy is intact,
- PSA API-first fallback is recorded,
- Silver/Silver+ references explicitly require raw scans for Gold,
- at least five certified references have current model outputs,
- at least one Gold/gold-candidate record exists.

Use `pnpm eval:certrefs -- --strict` in a release gate when a non-deployable cert-reference report should fail CI.

## Agentic Eval Loop

The certified-reference band eval is not enough by itself. The promotion target is the whole inspection stack:

```text
agent policy + image tools + ML model tools + calibrator + evidence trace + report explanation
```

Run:

```bash
pnpm eval:certrefs:agentic
```

This writes:

- `data/cert-references/agentic-eval/latest.json`
- `data/cert-references/agentic-eval/latest.judge-prompts.jsonl`
- `docs/qa/AGENTIC_CERT_EVAL_REPORT.md`

The runner uses a deterministic local judge by default and emits replayable judge prompts for pi-ai/OpenAI. It blocks promotion while predictions are placeholder mirrors, slab/raw images are not replayable, Gold records are missing, or required agent tools are missing.
