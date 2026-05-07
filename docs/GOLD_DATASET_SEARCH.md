# Gold Dataset Search

Date: 2026-05-06

## Question

Can we find public user-consented raw scans linked to later official outcomes plus human DING review?

## Result

No reusable public Gold dataset was found.

A Gold record for Card Condition Vault requires all of:

- Raw pre-submission front/back scans.
- Later official grade/cert outcome.
- Human DING review with location/materiality labels.
- Explicit consent/license for reuse, preferably for public display and training.

Public materials found online usually satisfy only one or two of those requirements.

## Closest Sources Found

| Source | What it has | Why it is not Gold |
| --- | --- | --- |
| PSA Baseball Grades GitHub | 11,500 PSA-labeled baseball card images | Scraped/processed grade-class images; no pre-submission provenance, no user consent trail, no DING labels |
| TAG DIG / TAG Help | Official grading report concept, subgrades, DINGS, high-definition imagery | Grading-company report, not a reusable training dataset; do not scrape/copy without permission |
| Degree Grading public page | Example public grader notebook with grade, surface/corner/centering notes | Public marketing/cert example only; no raw pre-submission user scan and no reuse license |
| Elite Fourum damage threads | Public posts with before/after scan-style evidence and community discussion | Anecdotal case studies; no explicit dataset license, no structured human DING labels, sensitive dispute context |
| PSA app / cert workflow | PSA supports cert lookup and submission flow after scans/searches | Does not expose a downloadable raw-scan + grade + DING-label dataset |

## Product Decision

Treat these as separate tiers:

- Public certified references: deep-link only, no cached cert images, no training.
- Public anecdotal case studies: link-only unless the poster grants permission.
- Open DING datasets: training/eval only when source license permits.
- Gold records: must be built in-product through explicit user consent and later cert attachment.

## Immediate Next Step

Add an opt-in Gold contribution flow:

1. User scans before submission.
2. App stores hashes, raw/normalized images, and DING corrections.
3. User later attaches PSA/CGC/BGS/TAG result.
4. User opts into public example and/or model training.
5. Human reviewer labels DINGs and materiality.
6. Record becomes Gold only after verification.

## Guardrail

Do not import forum images, TAG DIG reports, PSA/CGC/BGS cert images, or grading-company notes into training data without explicit permission.
