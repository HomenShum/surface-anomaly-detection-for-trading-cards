# Inspection Skill Registry

File-backed skill store for the pi-ai inspection agent.

## Layout

```
skills/
  promoted/                # production / canary / staging skills (active)
    <skill_id>.json
  drafts/                  # draft candidates awaiting benchmark
    <skill_id>.json
  candidates.jsonl         # append-only method traces from agent runs (anonymized)
  proposals.jsonl          # append-only "this trace looks reusable" hints
```

## Lifecycle

```
draft → staging → canary → production → retired
                                      ↘
                                      rejected
```

Promotion is gated by `evaluateSkillPromotion` in `apps/web/lib/agent/inspection-skill-evolution.ts`.

Production promotion **requires explicit human approval** — never automatic, regardless of benchmark score.

## Privacy contract

- `candidates.jsonl` records: tool sequence shape + duration + ok flag + intent bucket. **No raw user images, no card identifiers, no user identity.**
- `proposals.jsonl` records: agent self-proposed candidate skills + rationale. Anonymized rationale only.
- `promoted/*.json` skills are public per-tenant. They contain no user data.

## How to author a new skill manually

1. Drop a file in `drafts/` matching the `InspectionSkillCandidate` schema.
2. Run the benchmark harness against the fixture set.
3. Move to `promoted/` with status `staging` once benchmarks pass.
4. Promote to `production` only after human sign-off.

## How agents propose skills

Agents call `propose_inspection_method` during a chat turn. The proposal is appended to `proposals.jsonl`. A nightly clusterer (P1, not yet built) scans candidates + proposals and writes draft files to `drafts/`.
