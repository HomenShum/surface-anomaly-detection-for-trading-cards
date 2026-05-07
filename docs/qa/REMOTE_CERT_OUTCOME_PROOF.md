# Remote Certified-Reference Outcome Proof

generatedAt: 2026-05-07T06:05:03.427Z
outcomeMatchingProved: true
productionDeployable: false

## Summary

| metric | value |
| --- | ---: |
| totalRefs | 1 |
| realInferenceRows | 1 |
| proofEligibleMatches | 1 |
| match | 1 |
| adjacent | 0 |
| mismatch | 0 |
| noOfficial | 0 |
| averageJudgeScore | 0.877 |

## Gates

| gate | status | detail |
| --- | --- | --- |
| Real image inputs | PASS | 1/1 refs used fetched image bytes, not mocks. |
| Real local model | PASS | model=ding-detector-v0, mock=false, allow_mock_detector=false |
| Outcome-band proof row | PASS | 1/1 required proof-eligible match rows. |
| Source tier honesty | PASS | Rows are labelled marketplace_silver_plus; not Gold and not PSA API proof. |
| Production deployability | BLOCKED | Still blocked until larger Silver+/Gold eval coverage and human DING review exist. |

## Traces

| ref | source | official | predicted | agreement | proof | model |
| --- | --- | --- | --- | --- | --- | --- |
| market_cardshq_psa_128228220 | cardshq_public_listing | 950-1000_gem_pristine | 950-1000_gem_pristine | match | yes | ding-detector-v0 |

## Notes

- This report proves only real image-backed outcome-band comparison for listed marketplace certified references.
- It must not be treated as official grade prediction accuracy.
- It does not use cert images as training data.
- General deployability remains blocked until enough Silver+/Gold references pass without regressions.
