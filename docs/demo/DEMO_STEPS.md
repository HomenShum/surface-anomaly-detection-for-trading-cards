# Step-by-Step Demo

1. Seed the demo queue with `python scripts/demo/seed_card_condition_vault.py`.
2. Generate the shareable UI GIF package with `pnpm demo:gifs`.
3. Open `public/demo/seed-data/cards.json` and confirm three cards exist.
4. Start with `ccv-001` and explain the declared grade versus detected condition.
5. Move to `ccv-002` and call out centering variance as a second-pass review case.
6. Move to `ccv-003` and explain why lower confidence triggers manual review.
7. Run `python scripts/qa/snapshot_report.py` and review `docs/qa/snapshot-report.md`.
8. Run `python scripts/qa/build_submission_package.py` and review the generated package.
