# Certified Reference Evaluation Report

Generated: 2026-05-07T12:34:26.813Z

Deployable: **no**

This report evaluates certified-reference readiness only. It does not claim PSA/TAG grade prediction and does not train on cert-page images.

## Summary

- Total references: 29
- PSA: 28
- TAG: 1
- Silver+: 20
- Model-analyzed references: 0
- Gold/gold-candidate records: 0

## Gates

| Gate | Status | Detail |
| --- | --- | --- |
| Certified references are seeded or imported | PASS | 29 references loaded. |
| External certified references are not marked training-allowed | PASS | 0 external training violations. |
| TAG references remain no-bulk-scrape/link-only | PASS | 0 TAG policy violations. |
| PSA API-first path exists with documented fallback | PASS | Worker/importer attempt PSA API when credentials are configured; otherwise warnings are recorded. |
| Silver/Silver+ references explicitly require raw scans for Gold | PASS | 29 references still need raw pre-submission scan + human DING review. |
| At least five certified references have current model outputs | BLOCKED | 0 certified references have model-analysis status. |
| Gold eval set exists before deployability | BLOCKED | 0 Gold/gold-candidate records loaded. |

## Reference Rows

| Reference | Trust | Official outcome | Band | Model analyzed | Needs review |
| --- | --- | --- | --- | --- | --- |
| PSA 134162375 | silver | EX-MT 6 | 700-799_visible_issues | no | yes |
| PSA 137437906 | silver | EX-MT 6 | 700-799_visible_issues | no | yes |
| PSA 138014353 | silver | EX 5 | below_700_heavy_wear | no | yes |
| PSA 138901043 | silver | EX-MT 6 | 700-799_visible_issues | no | yes |
| PSA 139091042 | silver | EX-MT 6 | 700-799_visible_issues | no | yes |
| PSA 139091059 | silver | EX 5 | below_700_heavy_wear | no | yes |
| PSA 139091062 | silver_plus | NM-MT 8 | 800-849_near_mint | no | yes |
| PSA 139091081 | silver | EX-MT 6 | 700-799_visible_issues | no | yes |
| PSA 142558447 | silver_plus | GEM MT 10 | 950-1000_gem_pristine | no | yes |
| PSA 142558455 | silver_plus | GEM MT 10 | 950-1000_gem_pristine | no | yes |
| PSA 142558459 | silver_plus | MINT 9 | 900-949_mint | no | yes |
| PSA 142558463 | silver_plus | MINT 9 | 900-949_mint | no | yes |
| PSA 142558464 | silver | EX-MT 6 | 700-799_visible_issues | no | yes |
| PSA 142558471 | silver_plus | NM-MT 8 | 800-849_near_mint | no | yes |
| PSA 142558473 | silver_plus | GEM MT 10 | 950-1000_gem_pristine | no | yes |
| PSA 148648467 | silver_plus | GEM MT 10 | 950-1000_gem_pristine | no | yes |
| PSA 148901879 | silver_plus | MINT 9 | 900-949_mint | no | yes |
| PSA 148901880 | silver_plus | GEM MT 10 | 950-1000_gem_pristine | no | yes |
| PSA 148901881 | silver_plus | GEM MT 10 | 950-1000_gem_pristine | no | yes |
| PSA 148901886 | silver_plus | MINT 9 | 900-949_mint | no | yes |
| PSA 148901888 | silver_plus | GEM MT 10 | 950-1000_gem_pristine | no | yes |
| PSA 148901889 | silver_plus | GEM MT 10 | 950-1000_gem_pristine | no | yes |
| PSA 148901890 | silver_plus | GEM MT 10 | 950-1000_gem_pristine | no | yes |
| PSA 148965567 | silver_plus | GEM MT 10 | 950-1000_gem_pristine | no | yes |
| PSA 152528467 | silver_plus | MINT 9 | 900-949_mint | no | yes |
| PSA 154378339 | silver_plus | NM-MT 8 | 800-849_near_mint | no | yes |
| PSA 69196288 | silver_plus | GEM MT 10 | 950-1000_gem_pristine | no | yes |
| PSA 69923530 | silver_plus | GEM MT 10 | 950-1000_gem_pristine | no | yes |
| TAG J6994233 | silver | see TAG DIG report | unknown | no | yes |

## Promotion Rule

A model/pipeline version is not deployable from cert-reference eval alone until at least five certified references have current model outputs and at least one Gold/gold-candidate record exists. Use `pnpm eval:certrefs -- --strict` in release gates when this should fail CI.
