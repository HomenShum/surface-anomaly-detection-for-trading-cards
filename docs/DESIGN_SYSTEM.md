# Design System

Card Condition Vault follows the Open Design discipline with a Modern minimal + Tech utility base and Editorial report surfaces.

## Product Feel

- Collector-grade, calm, and precise.
- Utility surfaces prioritize scanning, comparison, and repeated inspection.
- Report surfaces read like a premium condition dossier without claiming official grading precision.
- Empty and demo states are honest; no fake accuracy, fake market value, or fake grading claims.

## Interaction Principles

- First-run paths start as a question form: sample card, own upload, guided scanner, or before/after dispute demo.
- Scanner UX should feel like ID capture: outline, stability, glare/blur feedback, still-frame capture, flip prompt.
- DING correction UI must keep original model output auditable while recording user edits as training signals.
- Before/after comparison is the differentiated workflow and should be visually prominent.

## P0 Gates

- Sample analysis works without trained weights.
- DING overlay renders on normalized image.
- Evidence manifest contains hashes and timestamp.
- Reports include the required disclaimer.
- Full video is not stored by default.

## P1 Gates

- Google OAuth config path is documented.
- User corrections persist in demo state.
- Own upload path works.
- Mobile scanner layout stays usable.
- README includes a short demo path.

## P2 Gates

- PatchCore heatmap.
- Premium evidence packet.
- PSA cert link field.
- Batch upload.
