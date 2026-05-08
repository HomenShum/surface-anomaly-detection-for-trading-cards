# Agentic Annotation Eval Report

Generated: 2026-05-08T22:47:17.674Z

Deployable for fixed-fixture agentic annotation gate: **yes**

## Pipelines

| Pipeline | Precision | Recall | F1 | Clean FP | Holo-glare FP | Grounded | Grade claims | Hallucinated DING rate | Latency | Cost |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| A. full-card YOLO only | 0.667 | 1 | 0.8 | 0 | 0 | 1 | 0 | 0.333 | 220ms | $0 |
| B. normalized card + crop/foveation YOLO | 0.667 | 1 | 0.8 | 0 | 0 | 1 | 0 | 0.333 | 430ms | $0 |
| C. B + policy-routed visual-agent reinspection | 1 | 1 | 1 | 0 | 0 | 1 | 0 | 0 | 980ms | $0.006 |
| D. C + human review | 1 | 1 | 1 | 0 | 0 | 1 | 0 | 0 | 5000ms | $0.5 |

## Notes

- This is a fixed-fixture benchmark, not production certified-reference accuracy.
- Pipeline C treats LLM/frontier outputs as candidate/reinspection signals only; final Gold labels still require human review.
- Private/user/vendor data must route through local/direct/ZDR policies, never free broad routing.
