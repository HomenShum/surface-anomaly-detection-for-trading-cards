# Inspection Skill Evolution

This is the controlled self-improvement design for Card Condition Vault.

## Decision

The pi-ai agent may answer follow-up questions, request inspection tools, and propose reusable inspection methods. It may not freely rewrite production prompts, model weights, guardrails, or shared behavior.

The product rule is:

```text
Detector and CV tools produce evidence.
The agent orchestrates inspection and explains outputs.
Reusable methods are promoted only after benchmark gates pass.
```

## Why This Is Possible

OpenAI's "Thinking with images" release describes visual reasoning that can transform uploaded images with tools such as crop, zoom, and rotate. pi-ai gives this app a TypeScript tool-calling runtime with serializable context, provider handoff, image inputs on vision models, and streaming/tool-call support. OpenClaw-style skill systems are a useful reference for local/workspace-scoped skills, but they also reinforce the security rule: treat agent skills as untrusted until reviewed.

## Memory Boundaries

| Layer | Allowed | Not allowed by default |
|---|---|---|
| Session memory | Current card report, current chat, current tool results | Cross-user reuse |
| Private user memory | User capture preferences, preferred explanation tone, repeated retake issues | Sharing raw images globally |
| Candidate method memory | Anonymized trigger/method/metric records | Personal ownership history |
| Shared skill registry | Benchmarked method definitions and aggregate metrics | Raw user images, dispute packets, Google identity |

Shared learning must use anonymized method outcomes unless the user explicitly opts in.

## Skill Lifecycle

```text
draft
  -> staging
  -> canary
  -> production
  -> retired
```

Promotion gates:

- `staging`: safe structure and guardrails present.
- `canary`: at least one benchmark passes, no ungrounded agent claims, no privacy violations.
- `production`: canary gates plus explicit human approval.
- `retired`: regression, latency, model drift, or safety issue.

## Candidate Skill Shape

Implemented in `apps/web/lib/agent/inspection-skill-evolution.ts`.

```json
{
  "skillId": "holo_glare_reinspect_v1",
  "title": "Holo glare reinspection",
  "trigger": {
    "finishType": "holo",
    "maxConfidence": 0.65,
    "minGlareScore": 0.35,
    "userQuestionIntent": "scratch_vs_glare"
  },
  "steps": [
    { "tool": "crop_region", "purpose": "Isolate the suspicious reflective area." },
    { "tool": "zoom_region", "purpose": "Magnify for detector and user review." },
    { "tool": "run_glare_check", "purpose": "Separate glare evidence from material damage." },
    { "tool": "run_ding_detector", "purpose": "Re-run the detector on the zoomed crop." },
    { "tool": "explain_uncertainty", "purpose": "Explain scratch, glare, or retake." }
  ],
  "consentScope": "anonymized_method_stats"
}
```

## Convex Persistence

Implemented in:

- `convex/schema.ts`
- `convex/inspectionSkills.ts`

Tables:

- `inspectionSkillCandidates`
- `inspectionSkillBenchmarks`
- `inspectionSkillPromotions`

The app can now store proposed methods, benchmark results, and promotion decisions without giving the agent direct write access to production behavior.

## Agent Rules

```text
No production self-modification without benchmark pass.
No shared learning from user data without explicit consent.
No new tool access without permission review.
No official grade claims.
No legal proof claims.
No raw user image sharing into global memory by default.
No agent claim without tool output.
Every promoted skill has a version, benchmark, and rollback path.
```

## QA Gate

Run:

```powershell
pnpm qa:evolution
```

This generates:

```text
docs/qa/INSPECTION_SKILL_EVOLUTION_REPORT.md
```

The check verifies:

- Safe draft candidates can enter staging.
- Benchmarked candidates can enter canary.
- Production promotion is blocked without human approval.
- Human-approved production promotion can pass.
- Raw-image cross-user sharing is blocked.

`pnpm test` also runs a non-writing version through `pnpm test:evolution`.

## First Useful Skill

Start with `holo_glare_reinspect_v1`.

Trigger:

```text
finish_type = holo
surface confidence < 0.65
glare score > 0.35
user asks "scratch or glare?"
```

Method:

```text
crop suspicious region
zoom region
run glare check
rerun DING detector on crop
explain uncertainty
recommend retake if needed
```

Benchmark:

```text
clean holo glare false positives
real surface scratch
edge whitening on glossy backs
low-light false negatives
before/after new defect cases
```

Promotion target for MVP:

```text
staging only
```

Do not globally auto-promote until the fixed benchmark fixtures prove lower false positives without worse recall or unacceptable latency.
