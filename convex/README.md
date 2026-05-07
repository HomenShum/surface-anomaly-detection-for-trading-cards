# Convex Backend

This folder contains the production data contract for Card Condition Vault.

Run:

```bash
pnpm install
npx convex dev
```

Set `NEXT_PUBLIC_CONVEX_URL` and `CONVEX_DEPLOYMENT` from the Convex CLI output or dashboard.

Core tables:

- `cards`
- `cardImages`
- `scanSessions`
- `detections`
- `conditionReports`
- `evidenceManifests`
- `userCorrections`
- `chatThreads`
- `chatMessages`
- `agentJobs`

Uploads should use Convex File Storage for original/normalized images, then store storage IDs in `cardImages`.
