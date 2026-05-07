# Card Condition Vault Product Flow

## Product Goal

On web and mobile, let users scan or upload a trading card, show a live responsive checklist while the system evaluates image quality and card condition, then save a timestamped condition record with visible DING annotations, confidence, and catalog history.

## Input Modes

- Live camera scan for mobile-first capture.
- Short guided video scan for reflective or premium foil cards.
- Manual image upload for desktop, camera-roll, and fallback workflows.

The first-run mode selector should be question-form first: quick scan, premium reflective card, or upload existing photos.

## Live Checklist States

Each model run uses these states:

- `waiting`
- `in_progress`
- `passed`
- `warning`
- `failed`
- `skipped`

The checklist stages are:

1. Card detected
2. Edges visible
3. Blur check passed
4. Glare check passed
5. Perspective normalized
6. Front/back recognized
7. Corner regions extracted
8. Edge regions extracted
9. Surface scan running
10. DING detection running
11. Confidence scoring
12. Building condition report
13. Saving evidence manifest
14. Updating catalog

## UX Contract

- First visible progress should appear within 300 ms after the user starts analysis.
- No stage should look frozen for more than about two seconds without live detail text.
- The UI must mark uncertainty as warning, not success.
- A one-image upload can be useful, but front/back recognition must warn when the back is not supplied.
- The LLM explains structured report data only; it does not invent detections or grades.

## P0 Done Gates

- Camera works only in HTTPS or secure local contexts, with upload fallback always available.
- Real trained detector is loaded for real-user mode.
- No silent mock fallback for real users.
- Report includes visible DING overlays, confidence, model version, hashes, timestamp, and disclaimer.
- Every report states: "This is a timestamped condition evidence record and AI-assisted condition estimate. It is not an official grade or legal guarantee."
