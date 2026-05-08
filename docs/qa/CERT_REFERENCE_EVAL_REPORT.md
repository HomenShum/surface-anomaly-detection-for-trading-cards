# Certified Reference Evaluation Report

Generated: 2026-05-08T22:47:17.770Z

Deployable: **yes**

This report evaluates certified-reference readiness only. It does not claim PSA/TAG grade prediction and does not train on cert-page images.

## Summary

- Total references: 130
- PSA: 129
- TAG: 1
- Silver+: 100
- Model-analyzed references: 30
- Gold/gold-candidate records: 30

## Gates

| Gate | Status | Detail |
| --- | --- | --- |
| Certified references are seeded or imported | PASS | 130 references loaded. |
| External certified references are not marked training-allowed | PASS | 0 external training violations. |
| TAG references remain no-bulk-scrape/link-only | PASS | 0 TAG policy violations. |
| PSA API-first path exists with documented fallback | PASS | Worker/importer attempt PSA API when credentials are configured; otherwise warnings are recorded. |
| Silver/Silver+ references explicitly require raw scans for Gold | PASS | 100 references still need raw pre-submission scan + human DING review. |
| At least five certified references have current model outputs | PASS | 30 certified references have model-analysis status. |
| Gold eval set exists before deployability | PASS | 30 Gold/gold-candidate records loaded. |

## Reference Rows

| Reference | Trust | Official outcome | Band | Model analyzed | Needs review |
| --- | --- | --- | --- | --- | --- |
| PSA 130255216 | gold | MINT 9 | 900-949_mint | yes | yes |
| PSA 130814351 | gold | MINT 9 | 900-949_mint | yes | yes |
| PSA 130814358 | gold | MINT 9 | 900-949_mint | yes | yes |
| PSA 130814362 | gold | MINT 9 | 900-949_mint | yes | yes |
| PSA 134162369 | gold | MINT 9 | 900-949_mint | yes | yes |
| PSA 134162371 | gold | NM 7 | 700-799_visible_issues | yes | yes |
| PSA 134162375 | gold | EX-MT 6 | 700-799_visible_issues | yes | yes |
| PSA 134162379 | gold | MINT 9 | 900-949_mint | yes | yes |
| PSA 134162381 | gold | NM-MT 8 | 800-849_near_mint | yes | yes |
| PSA 134162384 | gold | NM-MT 8 | 800-849_near_mint | yes | yes |
| PSA 134162394 | gold | MINT 9 | 900-949_mint | yes | yes |
| PSA 134162396 | gold | MINT 9 | 900-949_mint | yes | yes |
| PSA 134162397 | gold | MINT 9 | 900-949_mint | yes | yes |
| PSA 134162403 | gold | MINT 9 | 900-949_mint | yes | yes |
| PSA 134162404 | gold | NM-MT 8 | 800-849_near_mint | yes | yes |
| PSA 134162407 | gold | MINT 9 | 900-949_mint | yes | yes |
| PSA 134162409 | gold | NM-MT 8 | 800-849_near_mint | yes | yes |
| PSA 134162412 | gold | NM 7 | 700-799_visible_issues | yes | yes |
| PSA 134162413 | gold | EX-MT 6 | 700-799_visible_issues | yes | yes |
| PSA 134162422 | gold | EX-MT 6 | 700-799_visible_issues | yes | yes |
| PSA 136693729 | silver_plus | NM-MT 8 | 800-849_near_mint | no | yes |
| PSA 137437905 | silver_plus | NM 7 | 700-799_visible_issues | no | yes |
| PSA 137437906 | gold | EX-MT 6 | 700-799_visible_issues | yes | yes |
| PSA 138014353 | gold | EX 5 | below_700_heavy_wear | yes | yes |
| PSA 138901043 | silver_plus | EX-MT 6 | 700-799_visible_issues | no | yes |
| PSA 139091041 | silver_plus | NM 7 | 700-799_visible_issues | no | yes |
| PSA 139091042 | silver_plus | EX-MT 6 | 700-799_visible_issues | no | yes |
| PSA 139091051 | silver_plus | NM 7 | 700-799_visible_issues | no | yes |
| PSA 139091052 | silver_plus | NM-MT 8 | 800-849_near_mint | no | yes |
| PSA 139091058 | silver_plus | NM-MT 8 | 800-849_near_mint | no | yes |
| PSA 139091059 | silver_plus | EX 5 | below_700_heavy_wear | no | yes |
| PSA 139091062 | silver_plus | NM-MT 8 | 800-849_near_mint | no | yes |
| PSA 139091071 | silver_plus | MINT 9 | 900-949_mint | no | yes |
| PSA 139091072 | silver_plus | MINT 9 | 900-949_mint | no | yes |
| PSA 139091080 | silver_plus | NM-MT 8 | 800-849_near_mint | no | yes |
| PSA 139091081 | silver_plus | EX-MT 6 | 700-799_visible_issues | no | yes |
| PSA 140992606 | silver_plus | NM 7 | 700-799_visible_issues | no | yes |
| PSA 142558447 | silver_plus | GEM MT 10 | 950-1000_gem_pristine | no | yes |
| PSA 142558455 | silver_plus | GEM MT 10 | 950-1000_gem_pristine | no | yes |
| PSA 142558459 | gold | MINT 9 | 900-949_mint | yes | yes |
| PSA 142558463 | gold | MINT 9 | 900-949_mint | yes | yes |
| PSA 142558464 | silver_plus | EX-MT 6 | 700-799_visible_issues | no | yes |
| PSA 142558471 | gold | NM-MT 8 | 800-849_near_mint | yes | yes |
| PSA 142558473 | silver_plus | GEM MT 10 | 950-1000_gem_pristine | no | yes |
| PSA 148648467 | silver_plus | GEM MT 10 | 950-1000_gem_pristine | no | yes |
| PSA 148901879 | gold | MINT 9 | 900-949_mint | yes | yes |
| PSA 148901880 | silver_plus | GEM MT 10 | 950-1000_gem_pristine | no | yes |
| PSA 148901881 | gold | GEM MT 10 | 950-1000_gem_pristine | yes | yes |
| PSA 148901886 | gold | MINT 9 | 900-949_mint | yes | yes |
| PSA 148901888 | silver_plus | GEM MT 10 | 950-1000_gem_pristine | no | yes |
| PSA 148901889 | silver_plus | GEM MT 10 | 950-1000_gem_pristine | no | yes |
| PSA 148901890 | gold | GEM MT 10 | 950-1000_gem_pristine | yes | yes |
| PSA 148965567 | silver_plus | GEM MT 10 | 950-1000_gem_pristine | no | yes |
| PSA 152528467 | silver_plus | MINT 9 | 900-949_mint | no | yes |
| PSA 154378339 | gold | NM-MT 8 | 800-849_near_mint | yes | yes |
| PSA 160000000 | silver_plus | GEM MT 10 | 950-1000_gem_pristine | no | yes |
| PSA 160000001 | silver_plus | GEM MT 10 | 950-1000_gem_pristine | no | yes |
| PSA 160000002 | silver_plus | GEM MT 10 | 950-1000_gem_pristine | no | yes |
| PSA 160000003 | silver_plus | GEM MT 10 | 950-1000_gem_pristine | no | yes |
| PSA 160000004 | silver_plus | GEM MT 10 | 950-1000_gem_pristine | no | yes |
| PSA 160000005 | silver_plus | GEM MT 10 | 950-1000_gem_pristine | no | yes |
| PSA 160000006 | silver_plus | GEM MT 10 | 950-1000_gem_pristine | no | yes |
| PSA 160000007 | silver_plus | GEM MT 10 | 950-1000_gem_pristine | no | yes |
| PSA 160000008 | silver_plus | GEM MT 10 | 950-1000_gem_pristine | no | yes |
| PSA 160000009 | silver_plus | GEM MT 10 | 950-1000_gem_pristine | no | yes |
| PSA 160000010 | silver_plus | MINT 9 | 900-949_mint | no | yes |
| PSA 160000011 | silver_plus | MINT 9 | 900-949_mint | no | yes |
| PSA 160000012 | silver_plus | MINT 9 | 900-949_mint | no | yes |
| PSA 160000013 | silver_plus | MINT 9 | 900-949_mint | no | yes |
| PSA 160000100 | silver_plus | GEM MT 10 | 950-1000_gem_pristine | no | yes |
| PSA 160000101 | silver_plus | GEM MT 10 | 950-1000_gem_pristine | no | yes |
| PSA 160000102 | silver_plus | GEM MT 10 | 950-1000_gem_pristine | no | yes |
| PSA 160000103 | silver_plus | GEM MT 10 | 950-1000_gem_pristine | no | yes |
| PSA 160000104 | silver_plus | GEM MT 10 | 950-1000_gem_pristine | no | yes |
| PSA 160000105 | silver_plus | MINT 9 | 900-949_mint | no | yes |
| PSA 160000106 | silver_plus | MINT 9 | 900-949_mint | no | yes |
| PSA 160000107 | silver_plus | MINT 9 | 900-949_mint | no | yes |
| PSA 160000108 | silver_plus | MINT 9 | 900-949_mint | no | yes |
| PSA 160000109 | silver_plus | MINT 9 | 900-949_mint | no | yes |
| PSA 160000110 | silver_plus | MINT 9 | 900-949_mint | no | yes |
| PSA 160000111 | silver_plus | MINT 9 | 900-949_mint | no | yes |
| PSA 160000112 | silver_plus | NM-MT 8 | 800-849_near_mint | no | yes |
| PSA 160000113 | silver_plus | NM-MT 8 | 800-849_near_mint | no | yes |
| PSA 160000114 | silver_plus | NM-MT 8 | 800-849_near_mint | no | yes |
| PSA 160000115 | silver_plus | NM-MT 8 | 800-849_near_mint | no | yes |
| PSA 160000116 | silver_plus | NM-MT 8 | 800-849_near_mint | no | yes |
| PSA 160000117 | silver_plus | NM 7 | 700-799_visible_issues | no | yes |
| PSA 160000118 | silver_plus | NM 7 | 700-799_visible_issues | no | yes |
| PSA 160000119 | silver_plus | NM 7 | 700-799_visible_issues | no | yes |
| PSA 160000120 | silver_plus | EX-MT 6 | 700-799_visible_issues | no | yes |
| PSA 160000121 | silver_plus | EX-MT 6 | 700-799_visible_issues | no | yes |
| PSA 160000122 | silver_plus | EX-MT 6 | 700-799_visible_issues | no | yes |
| PSA 160000123 | silver_plus | EX 5 | below_700_heavy_wear | no | yes |
| PSA 160000124 | silver_plus | EX 5 | below_700_heavy_wear | no | yes |
| PSA 160000125 | silver_plus | GEM MT 10 | 950-1000_gem_pristine | no | yes |
| PSA 160000126 | silver_plus | GEM MT 10 | 950-1000_gem_pristine | no | yes |
| PSA 160000127 | silver_plus | MINT 9 | 900-949_mint | no | yes |
| PSA 160000200 | silver_plus | GEM MT 10 | 950-1000_gem_pristine | no | yes |
| PSA 160000201 | silver_plus | GEM MT 10 | 950-1000_gem_pristine | no | yes |
| PSA 160000202 | silver_plus | GEM MT 10 | 950-1000_gem_pristine | no | yes |
| PSA 160000203 | silver_plus | GEM MT 10 | 950-1000_gem_pristine | no | yes |
| PSA 160000204 | silver_plus | GEM MT 10 | 950-1000_gem_pristine | no | yes |
| PSA 160000205 | silver_plus | MINT 9 | 900-949_mint | no | yes |
| PSA 160000206 | silver_plus | MINT 9 | 900-949_mint | no | yes |
| PSA 160000207 | silver_plus | MINT 9 | 900-949_mint | no | yes |
| PSA 160000208 | silver_plus | MINT 9 | 900-949_mint | no | yes |
| PSA 160000209 | silver_plus | MINT 9 | 900-949_mint | no | yes |
| PSA 160000210 | silver_plus | MINT 9 | 900-949_mint | no | yes |
| PSA 160000211 | silver_plus | MINT 9 | 900-949_mint | no | yes |
| PSA 160000212 | silver_plus | MINT 9 | 900-949_mint | no | yes |
| PSA 160000213 | silver_plus | MINT 9 | 900-949_mint | no | yes |
| PSA 160000214 | silver_plus | MINT 9 | 900-949_mint | no | yes |
| PSA 160000215 | silver_plus | NM-MT 8 | 800-849_near_mint | no | yes |
| PSA 160000216 | silver_plus | NM-MT 8 | 800-849_near_mint | no | yes |
| PSA 160000217 | silver_plus | NM-MT 8 | 800-849_near_mint | no | yes |
| PSA 160000218 | silver_plus | NM-MT 8 | 800-849_near_mint | no | yes |
| PSA 160000219 | silver_plus | NM-MT 8 | 800-849_near_mint | no | yes |
| PSA 160000220 | silver_plus | NM 7 | 700-799_visible_issues | no | yes |
| PSA 160000221 | silver_plus | NM 7 | 700-799_visible_issues | no | yes |
| PSA 160000222 | silver_plus | NM 7 | 700-799_visible_issues | no | yes |
| PSA 160000223 | silver_plus | EX-MT 6 | 700-799_visible_issues | no | yes |
| PSA 160000224 | silver_plus | EX-MT 6 | 700-799_visible_issues | no | yes |
| PSA 160000225 | silver_plus | EX-MT 6 | 700-799_visible_issues | no | yes |
| PSA 160000226 | silver_plus | EX 5 | below_700_heavy_wear | no | yes |
| PSA 160000227 | silver_plus | EX 5 | below_700_heavy_wear | no | yes |
| PSA 160000228 | silver_plus | EX-MT 6 | 700-799_visible_issues | no | yes |
| PSA 160000229 | silver_plus | MINT 9 | 900-949_mint | no | yes |
| PSA 69196288 | silver_plus | GEM MT 10 | 950-1000_gem_pristine | no | yes |
| PSA 69923530 | silver_plus | GEM MT 10 | 950-1000_gem_pristine | no | yes |
| TAG J6994233 | silver_plus | see TAG DIG report | unknown | no | yes |

## Promotion Rule

A model/pipeline version is not deployable from cert-reference eval alone until at least five certified references have current model outputs and at least one Gold/gold-candidate record exists. Use `pnpm eval:certrefs -- --strict` in release gates when this should fail CI.
