# Holo Glare Reinspection v1

Contributor: `@collector-methods`

## Problem

Holo and glossy surfaces can create direct light streaks that look like scratches in a single uploaded frame. The method treats one-angle surface marks as glare candidates first, then asks tools to prove whether damage remains visible after crop/zoom/glare review.

## Method

1. Crop the suspicious surface region.
2. Zoom the crop so the detector and user review the same pixels.
3. Run glare risk check.
4. Re-run DING detector on the zoomed crop.
5. Explain uncertainty and recommend a tilt retake when confidence stays low.

## User-Facing Behavior

When this method runs, reports may show:

```text
Inspection method used: Holo Glare Reinspection v1
Why it ran: surface confidence was low and glare risk was high.
Contributor: @collector-methods
```

## Reproducibility

Run the registry validator:

```powershell
pnpm qa:methods
```

Run the controlled skill-evolution gate:

```powershell
pnpm qa:evolution
```
