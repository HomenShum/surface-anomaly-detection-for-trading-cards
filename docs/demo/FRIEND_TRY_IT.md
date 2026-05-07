# Friend Try-It Guide

This is the no-cost laptop demo path. It assumes the laptop stays on and serves the web app plus inference API locally.

## Start

```bash
pnpm install
pnpm dev:api
pnpm dev
```

Open `http://localhost:3000`.

## What To Try

1. **Explore outcomes**: start at `/examples` to see certified-reference and DING-fixture examples with trust-tier labels.
2. **Inspect cert references**: open `/benchmarks/certified-references` to see the PSA 5/6/8/9/10 spread and the blocked deployability gate.
3. **Try cert import**: open `/certs/import`, paste a PSA cert/link or upload a label photo, and confirm candidates are marked Silver/Silver+.
4. **Upload a real card**: open `/workspace`, click **Upload photo**, choose a front image, then click **Analyze upload**.
5. **Watch the inspection**: confirm the card stays visible while the checklist and tool-event stream update.
6. **Save the record**: click **Save reviewed card** after analysis.
7. **Compare**: open `/compare` and switch through side-by-side, swipe, and diff overlay.
8. **Review methods**: open `/methods` to see the reward board for verified inspection methods.

## What To Tell The Tester

- This is a controlled alpha, not an official grading replacement.
- The strongest test is five real cards: clean, edge wear, corner wear, surface scratch/glare, and one card they are unsure about.
- Ask them to note wrong detections, missed defects, and whether the checklist/report felt credible.
- If camera access fails, use upload; upload is the guaranteed path for this local demo.

## Shareable Artifacts

Use these GIFs when sending a preview before the live demo:

- `public/demo/gifs/real-card-upload-agent-workspace-desktop.gif`
- `public/demo/gifs/real-card-upload-agent-workspace-mobile.gif`
- `public/demo/gifs/upload-checklist-zoom-inspection-desktop.gif`
- `public/demo/gifs/sample-scan-checklist-zoom-inspection-mobile.gif`
- `public/demo/gifs/verified-outcome-library-trust-explorer.gif`
- `public/demo/gifs/certified-reference-import-eval-workbench.gif`
- `public/demo/gifs/certified-reference-benchmark-grade-spread.gif`
- `public/demo/gifs/community-verified-methods-reward-board.gif`
- `public/demo/gifs/before-after-evidence-compare-dispute.gif`
