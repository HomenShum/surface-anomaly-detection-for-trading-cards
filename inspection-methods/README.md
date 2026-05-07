# Inspection Methods Registry

This folder is the open-source registry for reusable Card Condition Vault inspection methods.

Each method folder should contain:

- `method.yaml`: trigger, tool sequence, contributor, status, and version hash.
- `benchmark.json`: before/after metrics, fixture pack, pass/fail, and reviewer note.
- `README.md`: reproducibility steps and intended user-facing behavior.
- `safety_notes.md`: privacy, consent, rollout, and limitation notes.

Rules:

- No method is marked `verified`, `canary`, or `production` without benchmark proof.
- No raw user images are published without explicit opt-in consent.
- No method can claim official PSA/TAG/CGC/BGS grade accuracy.
- Every production method needs a rollback path and human approval.
