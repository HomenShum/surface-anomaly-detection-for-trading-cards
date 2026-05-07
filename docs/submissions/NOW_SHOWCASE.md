# Card Condition Vault real-model agent workspace QA Dogfood Packet

Feature ID: `card-condition-vault-now`
Created: `2026-05-07T12:33:14.306443+00:00`

This packet is the readable proof bundle for a visible feature change. It should be generated from a Parity Studio design mission, browser QA run, or equivalent local preview before production code is considered done.

## Links

- Preview/test link: `https://card-condition-vault.vercel.app/workspace`
- Local fallback: `http://127.0.0.1:3000/workspace`
- Parity Studio run: `D:/VSCode Projects/parity-studio reference audit`
- Side-by-side review: `docs/screenshots/workspace-upload-analysis-chromium.png`
- Primary GIF: `public/demo/gifs/real-card-upload-agent-workspace-desktop.gif`
- Mobile GIF: `public/demo/gifs/real-card-upload-agent-workspace-mobile.gif`
- Upload/checklist GIF: `public/demo/gifs/upload-checklist-zoom-inspection-desktop.gif`
- Trust library GIF: `public/demo/gifs/verified-outcome-library-trust-explorer.gif`
- Cert import GIF: `public/demo/gifs/certified-reference-import-eval-workbench.gif`
- Cert benchmark GIF: `public/demo/gifs/certified-reference-benchmark-grade-spread.gif`
- Methods board GIF: `public/demo/gifs/community-verified-methods-reward-board.gif`
- Before/after GIF: `public/demo/gifs/before-after-evidence-compare-dispute.gif`
- MP4: `public/demo/card-condition-vault-showcase.mp4`
- Remotion render: `public/demo/card-condition-vault-showcase.mp4`
- Gmail resend HTML: `gmail-magic-resend.html`

## User-visible outcome

A collector can open the workspace, upload or use sample card imagery through the agent sidebar, run the trained alpha DING detector, inspect normalized detections, and save a timestamped evidence record with hashes and a clear non-official-grading disclaimer.

## Workflow lanes

- New or empty user state: sample data path available, while launch mode refuses silent mock detections.
- Returning user state: catalog and report surfaces load persisted local records.
- Main happy path: workspace agent upload, analyze, report, evidence manifest.
- Comment/edit correction: correction UI stores user edits as auditable training signals.
- Error or permission state: missing model produces no fake DING boxes unless explicit demo mode is enabled.
- Mobile state: compact stacked workspace and report views.
- Desktop state: three-pane agent workspace inspired by the Parity Studio audit.

## Persona lanes

- First-time non-technical user: can use the sample card or upload path without understanding model internals.
- Product/design reviewer: can inspect the production URL, dogfood screenshots, GIFs, and Remotion MP4.
- Coding agent maintainer: can trace dataset hash, model run ID, Vercel proxy, Convex save path, and known caveats.

## Snapshot snippets

| Component slug | Before | After | Diff | Verdict | Correction prompt |
|---|---|---|---|---|---|
| `workspace.agent-upload.desktop` |  | `docs/screenshots/workspace-upload-analysis-chromium.png` |  | pass |  |
| `workspace.agent-upload.mobile` |  | `docs/screenshots/workspace-upload-analysis-mobile.png` |  | pass |  |
| `workspace.production.final` |  | `docs/screenshots/production-workspace-magic-final.png` |  | pass |  |

## QA checklist

- [x] The preview/test link opens in the Vercel-controlled alpha workspace.
- [x] Full-page dogfood screenshots exist for desktop and mobile.
- [x] Component-level snippets exist for the agent upload workspace.
- [x] GIF paths are present for workspace upload, mobile upload, scan checklist, outcome trust library, cert import, certified-reference benchmarks, methods board, and before/after compare.
- [x] An MP4 or Remotion render explains the end-to-end workflow.
- [ ] The End-user impact readout explains customer impact, not only score meaning.
- [ ] Any failed/weak state has a correction prompt attached to a component slug.
- [x] CHANGELOG lanes were updated for the touched alpha surfaces.

## Correction prompt

Use this when asking a coding agent to repair a failed visual QA finding:

```text
Use the QA packet at QA_DOGFOOD/card-condition-vault-now.
Fix component slug <component-slug>.
Expected: <expected visible result>.
Actual: <actual visible result>.
Use the before/after/diff screenshots as the source of truth.
Rerun browser QA, update manifest.json, regenerate the GIF/MP4 if visible behavior changed, and update the relevant CHANGELOG lane before committing.
```


## Local proof attached now

- Dataset audit: `3349` records, splits `{'test': 137, 'train': 2958, 'val': 254}`, manifest hash `24e62f76baf046c7d3ec83d147bbe4fb0a252b4cd06c77cd7ac13e61add28fa2`.
- Model: `ding-detector-v0`, base `yolov8n.pt`, epochs `8`, imgsz `512`, mAP50 `0.46374`.
- Larger experimental model: `synthetic-ding-cnn-v0.3-xlarge`, `5503629` parameters, validation accuracy `0.9167`, bbox L1 `0.1514`. Not promoted because synthetic validation is not comparable to Roboflow alpha detection metrics.
- UI reference: `D:/VSCode Projects/parity-studio` three-pane agent/canvas/status shell.
- Showcase templates: `D:/VSCode Projects/easier-to-read-submissions/templates`.
- Remotion entrypoint: `showcase/remotion/src/index.ts`.
- Remotion MP4: `public/demo/card-condition-vault-showcase.mp4` (verified).
- Desktop screenshot: `docs/screenshots/workspace-upload-analysis-chromium.png`.
- Mobile screenshot: `docs/screenshots/workspace-upload-analysis-mobile.png`.
- Production screenshot: `docs/screenshots/production-workspace-magic-final.png`.
