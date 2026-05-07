# Open Design and Readable Submissions Integration Notes

## Open Design

- Treat the seed queue as the canonical demo data contract for design reviews.
- Use `pnpm demo:gifs` as the shareable media source of truth. Placeholder
  GIFs are legacy reserved slots only.
- Keep status labels aligned with the QA checklist: `ready_for_review`,
  `needs_second_pass`, and `manual_review`.

## Easier-to-Read Submissions

- Preferred interface: `render_submission_markdown(payload: dict) -> str`.
- Optional external import: `easier_to_read_submissions`.
- Local fallback: `vendor/easier_to_read_submissions`.
- Adapter path: `scripts/qa/easier_to_read_submissions_adapter.py`.

The fallback keeps package generation unblocked when the upstream repository is
private, offline, or not installed in the local environment.
