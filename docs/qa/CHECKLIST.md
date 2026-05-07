# QA Checklist

## Demo Data

- [ ] `public/demo/seed-data/cards.json` exists.
- [ ] Seed data includes at least one ready, second-pass, and manual-review card.
- [ ] Every card has an id, title, detected condition, confidence, status, and image.
- [ ] Confidence values are between 0 and 1.

## Recorded Media

- [ ] `public/demo/gifs/manifest.json` exists.
- [ ] Every manifest entry points to a GIF file.
- [ ] Descriptive GIFs exist for workspace upload, scan checklist, trust library, methods board, and before/after compare.

## Snapshot Report

- [ ] `docs/qa/snapshot-report.md` is generated after seed data changes.
- [ ] Status counts match the seeded queue.
- [ ] Risk flag counts match the seeded queue.

## Submission Package

- [ ] `docs/submissions/card-condition-vault-submission-package.md` exists.
- [ ] `docs/submissions/card-condition-vault-submission-package.json` exists.
- [ ] `docs/submissions/card-condition-vault-submission-package.zip` exists.
- [ ] Package generation succeeds without the private easier-to-read-submissions repo.
