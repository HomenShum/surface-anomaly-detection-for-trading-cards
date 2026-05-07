# Inspection Skill Evolution QA

Generated: 2026-05-06T22:29:31.931Z

## Candidate

```json
{
  "id": "holo_glare_reinspect_v1",
  "title": "Holo glare reinspection",
  "status": "draft",
  "toolCount": 5,
  "tools": [
    "crop_region",
    "zoom_region",
    "run_glare_check",
    "run_ding_detector",
    "explain_uncertainty"
  ],
  "canShareAcrossUsers": true
}
```

## Benchmark Fixture

```json
{
  "benchmarkId": "holo-glare-fixtures-v1",
  "datasetVersion": "ccv-alpha-fixtures-20260506",
  "precisionDelta": 0.12,
  "recallDelta": 0.03,
  "falsePositiveDelta": -0.18,
  "latencyAddedMs": 420,
  "agentClaimsWithoutToolEvidence": 0,
  "officialGradeClaims": 0,
  "privacyViolations": 0,
  "passed": true
}
```

## Promotion Decisions

```json
{
  "draftToStaging": {
    "allowed": true,
    "targetStatus": "staging",
    "reasons": [
      "All promotion gates passed."
    ]
  },
  "stagingToCanary": {
    "allowed": true,
    "targetStatus": "canary",
    "reasons": [
      "All promotion gates passed."
    ]
  },
  "productionWithoutHuman": {
    "allowed": false,
    "targetStatus": "production",
    "reasons": [
      "Production promotion requires explicit human approval."
    ]
  },
  "productionWithHuman": {
    "allowed": true,
    "targetStatus": "production",
    "reasons": [
      "All promotion gates passed."
    ]
  },
  "unsafeSharedMemory": {
    "allowed": false,
    "targetStatus": "canary",
    "reasons": [
      "Candidate attempts to store raw user images.",
      "Candidate shares across users without an allowed consent scope."
    ]
  }
}
```

## Result

PASS - controlled inspection skill evolution gates are working.
