# Showcase Packet Generator

## 2026-05-06 - Record real desktop and mobile demo GIFs

The demo GIF path now runs Playwright against the hydrated workspace, uploads the sample card through the visible chat upload control, waits for the live checklist/model run, saves the reviewed card, and exports desktop/mobile GIFs plus source WebM recordings. This replaces the earlier text-only Remotion-derived GIF slices.

**Commit**: `uncommitted local workspace`. **Author**: Codex.
**Touches**: `CHANGELOG/web/workspace-agent.md`

## 2026-05-06 - Generate the easier-to-read launch packet

The showcase packet generator now consumes `D:/VSCode Projects/easier-to-read-submissions/templates`, points reviewers at the Vercel workspace, records dataset/model proof, and marks the Remotion MP4 as verified when rendered. The packet is intended as the falsifiable review artifact for the controlled public alpha.

**Commit**: `uncommitted local workspace`. **Author**: Codex.
**Touches**: `CHANGELOG/showcase/remotion.md`, `CHANGELOG/web/workspace-agent.md`
