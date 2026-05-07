# Step-by-Step Demo

## Friend Trial Path

1. Start the inference API with `pnpm dev:api`.
2. Start the web app with `pnpm dev`.
3. Open `http://localhost:3000`.
4. Click **Explore outcomes** to inspect Silver/Bronze examples before trusting the scanner.
5. Open `/benchmarks/certified-references` to inspect the PSA 5/6/8/9/10 grade spread and the not-deployable gate.
6. Open `/certs/import` to test PSA/TAG certified-reference ingestion.
7. Open **Workspace** and click **Upload photo** or **Use verified sample**.
8. Click **Analyze upload** and watch the live checklist, card preview, tool-event stream, and DING output.
9. Click **Save reviewed card**.
10. Open **Compare** to see before/after evidence and diff candidates.
11. Open **Methods** to see the community verified-method reward board.

## Scan Path

1. Open `/scan`.
2. Choose **Quick scan**, **Premium foil / reflective card**, **Upload images**, or **Try sample card**.
3. For camera mode, align the card in the reticle and let auto-capture select the still frame.
4. For upload mode, select a real card image. The real-time checklist should show quality checks, normalization, region extraction, DING detection, report building, and evidence saving.
5. If the API is offline or weights are missing, the UI must not invent DING boxes.
6. Open the finished report and verify the disclaimer is visible.

## Shareable GIF Set

The current source-of-truth GIF manifest is `public/demo/gifs/manifest.json`.

| Flow | GIF |
|---|---|
| Agent workspace upload, desktop | `public/demo/gifs/real-card-upload-agent-workspace-desktop.gif` |
| Agent workspace upload, mobile | `public/demo/gifs/real-card-upload-agent-workspace-mobile.gif` |
| Upload checklist + zoom inspection | `public/demo/gifs/upload-checklist-zoom-inspection-desktop.gif` |
| Mobile sample scan checklist | `public/demo/gifs/sample-scan-checklist-zoom-inspection-mobile.gif` |
| Verified Outcome Library | `public/demo/gifs/verified-outcome-library-trust-explorer.gif` |
| Certified reference import | `public/demo/gifs/certified-reference-import-eval-workbench.gif` |
| Certified reference benchmark grade spread | `public/demo/gifs/certified-reference-benchmark-grade-spread.gif` |
| Verified Methods reward board | `public/demo/gifs/community-verified-methods-reward-board.gif` |
| Before/after evidence compare | `public/demo/gifs/before-after-evidence-compare-dispute.gif` |

Legacy aliases `01-sample-card-analysis.gif` through `04-before-after-dispute.gif` are regenerated from these descriptive files for older submission docs.

## Demo Story

Before you send your card anywhere, scan or upload it, watch the app inspect it step by step, review visible DING annotations, and save a timestamped evidence file.
