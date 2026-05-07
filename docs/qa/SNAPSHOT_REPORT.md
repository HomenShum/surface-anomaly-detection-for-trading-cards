# Snapshot Report

Generated dogfood snapshots are written by:

```bash
pnpm qa:snapshots
```

Primary outputs:

- `docs/qa/snapshot-report.md`
- `docs/submissions/card-condition-vault-snapshot.json`

The current fallback snapshot runner validates seeded demo cards, status counts, risk flags, and submission package readiness. The shareable GIF suite is now recorded through `pnpm demo:gifs`; use `public/demo/gifs/manifest.json` as the source of truth.
