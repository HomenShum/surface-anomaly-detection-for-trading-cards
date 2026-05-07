# Verified Outcome Library

The outcome library is the trust layer before a user uploads a card.

## Why It Exists

New users should not have to trust aggregate model metrics. They should be able to inspect examples:

- Original image.
- DING overlays.
- Materiality labels.
- Known outcome.
- Provenance tier.
- Model band and confidence.
- Failure notes.
- Capture-quality warnings.

## Routes

```text
/examples
/examples/[id]
/benchmarks
/certs/import
```

## Provenance Tiers

```text
Gold: user-consented raw scan + official grade + human DING review
Silver: external certified reference or human-reviewed fixture
Bronze: open DING dataset / dataset fixture
```

The current repo examples intentionally separate two trust surfaces:

- PSA certified references are linked outcome metadata. They are public examples, not training data, and cert images are not cached locally.
- Local fixtures and open DING examples can show DING overlays and train/evaluate detectors when source rights allow it.

True gold records still require a user-consented before-submission scan, a later official result, and human DING review.

## Seed Certified References

These are linked examples only:

| Cert | Card | Outcome | Local image cache | Training use |
| --- | --- | --- | --- | --- |
| PSA 101964593 | Pokemon Mew ex | GEM MT 10 | No | No |
| PSA 101283999 | Pokemon Giratina VSTAR | GEM MT 10 | No | No |
| PSA 141562296 | Pokemon Carmine SAR | GEM MT 10 | No | No |
| PSA 130349493 | One Piece Portgas D. Ace | MINT 9 | No | No |
| PSA 146379905 | One Piece Luffy Manga | GEM MT 10 | No | No |
| PSA 141265943 | Riftbound Ahri | GEM MT 10 | No | No |
| PSA 137279140 | Riftbound Jinx | GEM MT 10 | No | No |
| PSA 154378339 | Zekrom ex BW Rare | NM-MT 8 | No | No |
| PSA 148901886 | Tyranitar V Battle Styles #155 | MINT 9 | No | No |
| PSA 142558459 | Tyranitar V Battle Styles #155 | MINT 9 | No | No |
| PSA 142558463 | M Ltrs/Zpds/Artcn.GX HF Elite Trainer Box F.A. | MINT 9 | No | No |
| PSA 148901879 | Iris's Fighting Spirit SAR #247 | MINT 9 | No | No |
| PSA 152528467 | Reshiram ex SIR #166 | MINT 9 | No | No |
| PSA 142558471 | Meowth #07 | NM-MT 8 | No | No |
| PSA 139091062 | Bulbasaur Enhanced BSTR Box Topper #133 | NM-MT 8 | No | No |
| TAG J6994233 | TAG DIG report reference | Linked report | No | No |

The friend-provided PSA/TAG references are also seeded in `data/cert-references/seed.json` for the import/evaluation pipeline. The expanded batch now includes PSA 5, 6, 8, 9, and 10 anchors, including slab-front GEM MT 10 examples and lower-grade label-batch reads. They are Silver/Silver+ references until raw pre-submission scans and human DING review are attached.

## Certified Reference Pipeline

Use `/certs/import` or `pnpm certrefs:worker` to ingest references. Use `pnpm eval:certrefs` to generate the certified-reference readiness report. The eval report is intentionally not deployable until model outputs and Gold/gold-candidate records exist.

## Training Sources

Open DING data and local fixtures can be used for detector bootstrap only when the source license permits it. PSA, CGC, BGS, and TAG cert pages are not training data unless permission is explicit.

## Trust Rules

- Do not claim official grades.
- Do not imply authenticity checks.
- Do not imply market value.
- Do not scrape or cache TAG DIG reports.
- Do not cache PSA/CGC/BGS images unless permission is explicit.
- Do not use public cert references for training.
- Show false positives and missed/uncertain cases.
- Separate visual issue from material DING.
- Show how capture quality affects confidence.

## TAG-Style Trust Mechanics We Borrow

TAG's public DIG page uses image evidence, attribute breakdowns, DING materiality, transparency/zoom inspection, and report sharing. Our implementation uses those trust mechanics without copying TAG branding or claiming TAG-equivalent imaging.

Sources:

- https://taggrading.com/pages/dig
- https://taggrading.com/pages/scale
