# MVP Spec

## Product Wedge

Before a collector sends a card anywhere, they can scan it, understand visible condition risk, and keep a timestamped evidence file.

## MVP Scope

- Google sign-in via Auth.js/NextAuth environment variables.
- Guided scanner that uses browser camera APIs and stores selected still frames only.
- Upload fallback for laptops or blocked camera permissions.
- FastAPI analysis endpoint with normalization, DING detections, quality warnings, report JSON, and evidence hashes.
- Card catalog, card detail, condition report, correction tools, and before/after comparison.
- Dataset ingestion and model training scripts, with mock detector fallback available only when explicit demo mode is enabled.

## Non-goals

- Official grading replacement.
- Scraping proprietary grading reports.
- Storing full video by default.
- Hardcoding Pokémon only.
- Blocking MVP use on trained weights or GPU availability.

## Universal DING Ontology

```text
card
corner
edge_wear
corner_wear
scratch
crease
hole
tear
dent
surface_contamination
heavy_wear
unknown_damage
glare_uncertain
```

## Evidence Disclaimer

This is a timestamped condition evidence record and AI-assisted condition estimate. It is not an official grade or legal guarantee.
