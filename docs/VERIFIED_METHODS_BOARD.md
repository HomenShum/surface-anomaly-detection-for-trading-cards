# Verified Methods Board

The `/methods` page is the public community layer for Card Condition Vault.

## Purpose

Reward contributors who make the inspection agent scan, reason, and explain better through reproducible methods and benchmark fixtures.

The message is:

```text
We open-source the inspection methodology, reward contributors, and make every improvement benchmarked, reproducible, and visible.
```

## What Gets Rewarded

- New inspection methods.
- New benchmark cases.
- New correction patterns.
- New tool sequences.
- New consented fixture packs.
- New UI/dogfood improvements.

## What Does Not Get Rewarded

- Unbenchmarked suggestions.
- Self-reported improvement with no fixtures.
- Methods that publish raw user images without consent.
- Methods that claim official grading or legal proof.
- Methods without rollback and safety notes.

## Implemented Surfaces

- `/methods`: public board with Featured, Newly Verified, In Review, Bounties, Top Contributors, and Open Source Registry tabs.
- `/methods/[id]`: method detail with benchmark proof, limitation, contributor reward, and source folder.
- `/methods/submit`: manual draft submission path for contributor ideas that did not originate in report chat.
- `/contributors/[handle]`: public contributor profile with badges and impact.
- Reward toast: shown on landing and methods pages when a verified method milestone is featured.
- Candidate toast: shown in report chat when a user's follow-up produces a draft method candidate.
- Report chat draft flow: `/api/agent/inspect` can call `propose_inspection_method` after a user-contributed workflow idea or a useful tool-backed reinspection pattern.
- `inspection-methods/`: open-source method registry.

## Chat-Discovered Method Flow

The public board is not a suggestion box. A method moves through this path:

```text
User contributes method in report chat
-> agent inspects with tools
-> draft candidate is logged
-> candidate toast confirms it entered the benchmark queue
-> benchmark + human review decide promotion
-> verified methods appear publicly and can be open-sourced
```

The candidate toast is intentionally different from the verified reward toast. It says "draft" and "not public or active" because the method has not earned community-wide trust yet.

## Reward Events

Supported reward event types:

```text
method_submitted
method_reproduced
method_verified
method_merged_open_source
method_used_1000_times
```

Public attribution uses an approved `publicRemark`, not raw chat text. Raw remarks and raw images stay private unless the contributor explicitly opts in.

## Required Registry Files

Verified, canary, and production methods must include:

```text
method.yaml
benchmark.json
limitations.md
contributor.md
README.md
safety_notes.md
```

## QA

Run:

```powershell
pnpm qa:methods
npx playwright test tests/e2e/methods-board.spec.ts --project=chromium
```

The validator requires benchmark proof and safety checks for any method marked:

```text
verified
canary
production
```

Generated report:

```text
docs/qa/VERIFIED_METHODS_REPORT.md
```
