# Dealer-OS backlog

Captured during the Vendor Pilot Day-1-7 build so the deferred scope doesn't seduce future builds. The wedge stays:
**condition trust + evidence trail**. Workflow ROI features ship _after_ Wedge A is proven.

## Already shipped in this loop

- `/dealer/intake` — drop-zone bulk PSA-label intake, OCR via FastAPI `/certs/detect-labels`, lane UI (uploaded → certs detected → verified → image attached → ready → human review → listed → submitted → sold). Persists `data/dealer/records.jsonl` + `intake-batches.jsonl`.
- `/dealer/records/[id]` — review workbench. Click-to-accept/reject DING bbox overlays, add human DINGs, attach slab image (auto-runs detector), set reviewer + decision, push the lane forward.
- `/dealer/records/[id]/evidence` + `/api/dealer/records/[id]/evidence?format=json|html` — HMAC-signed evidence packet. Customer-share view is a printable HTML page; the JSON endpoint is verifiable independently.
- `/dealer/dashboard` — daily ops: inventory $, expected graded EV, ready-to-list, worth-grading, needs-review, recent imports, price movers, stale > 30d.
- `/dealer/listings` — listing queue with grading-ROI deal score, draft status, evidence-packet link.
- `/dealer/submissions` — submission tracker with stage counts (raw → submitted → grading → returned → listed → sold).
- `/dealer/alerts` — derived alerts (low-comp confidence, raw-to-graded spread, returned-low, deal-score high).
- 20 Silver+ seed records (10 reviewed, 3 listed, 2 submitted) loaded from `data/cert-references/seed.json` via `scripts/dealer/seed_vendor_pilot.mjs`.

## Deferred (must NOT seduce future sprints until Wedge A is proven)

### Bulk intake variants
- ZIP / folder import UI (drag a folder, server walks)
- Paste cert-list textarea
- Paste eBay listing URL → extract cert
- CSV import (TCGPlayer / Cardmarket export shapes)

### Variant resolution polish
- Pokémon TCG API auto-suggest "Possible matches" UI in record detail
- 1st edition vs unlimited disambiguation prompt
- Promo stamp detection from cert label OCR
- Reverse / holo / non-holo checkbox cluster

### Quantity & duplicates
- Auto-increment quantity on raw-card scan when (cardIdentity, variant) matches existing record
- Dedup confirm modal: "Already have 3 of these — increment or new entry?"
- Bulk-edit lane controls in dashboard

### Inventory type expansion
- Sealed product fixtures (boxes, ETBs, tins)
- Binder page bulk-tag (one DealerRecord per slot)
- Lot record (groups N raw cards, single price)
- Consignment record (ownership flag, payout split)

### Pricing / comps
- Real PokeTrace integration (price endpoints + alerts webhook)
- TCGplayer pricing endpoint integration (market / low / mid / high / buylist)
- PriceCharting graded-grade fields (BGS 10, CGC 10, SGC 10)
- Comps drawer with date / marketplace / grade / sale price / outlier flag
- Rolling avg / median / freshness / approximate-sale flagging

### Grading ROI deeper math
- Real expected-grade-distribution model (currently stubbed by tier)
- Probability calibration vs actual returned outcomes (closes the loop)
- Resubmit / cross-grade scenario calculator
- Bulk-submit batch optimizer (which N cards to submit together this month)

### Listing draft generation
- eBay listing draft via API (title / description / pricing / shipping template)
- TCGplayer listing draft
- Cardmarket draft
- Auto-generate condition copy from accepted DINGs
- Photos-ready check (require front + back + cert close-up before publish)
- Public report URL embedded in description

### Submission tracker depth
- PSA-bulk-submission CSV template generator
- Receipt-tracking from carrier APIs (UPS / FedEx / USPS)
- Return delta vs declared value
- Crack-and-resubmit branch tracking

### Before/after evidence
- Pre-shipping scan capture (existing /scan flow with submission link)
- Post-return scan capture
- Side-by-side viewer reusing existing /compare
- New-DING candidate diff overlay
- Signed before/after pair packet (links the two evidence packets cryptographically)
- Exportable dispute packet for grader / buyer

### Trust pages
- Public shareable customer report URL (currently the `/dealer/records/[id]/evidence` route — needs short-link + access token)
- Branded vendor profile page (logo, terms, contact)
- Per-buyer report access tokens with expiry
- Embed badge for the dealer's own marketplace listings ("verified by CCV")

### Alerts
- Push notifications (web push + email) for high-severity alerts
- User-defined watchlist rules (set buy target, drop %, etc.)
- Webhook integration for external systems
- Daily digest email

### Portfolio / P&L
- Cost basis tracking per record
- Realized vs unrealized gains/losses
- Days-in-inventory
- Sell-through rate
- Submission fee + shipping cost amortization
- Time-series chart per record + portfolio total

### Human review at scale
- Reviewer assignment (multi-reviewer workflow)
- Reviewer agreement metric (when 2+ reviewers see same card)
- Review SLA timer (alert when card has been in human_review > 48h)
- Bulk-accept "no DING" for clean cards
- Keyboard-shortcut review mode (J/K/A/R navigation)

### Multi-TCG expansion
- One Piece, MTG, YGO, Riftbound — each with its own variant grammar
- Per-game pricing source mapping
- Per-game finish vocabulary

### Moat / Gold tier
- Raw pre-submission scan + official-outcome pairing (the actual Gold record)
- Human DING consensus dataset (3+ reviewers per finding)
- Grade-band calibration retraining loop (closes the flywheel against returned grades)
- Verified methods board entries graduating from "experimental" to "verified" with evidence
- Marketplace-integrated trust reports embedded in eBay / TCGplayer descriptions

## Anti-patterns to interrupt

- **Scope gravity**: every "this would be cool" idea above can wait until the friend says: *"This is actually useful for organizing and reviewing my cards."* If the answer is no, no amount of feature will fix it.
- **Overclaim language**: never say "AI grading", "official grade", "guaranteed condition", "authenticated". Use "AI-assisted visible condition report" everywhere.
- **Model embarrassment hiding**: when the detector misses a real DING (Tauros real-card returned 0 findings at threshold), surface that honestly. The trust moat IS the human-correction loop.
- **Premature listing publishing**: dealer drafts only. Never auto-publish to a marketplace.
- **Cert-image caching**: never cache PSA / TAG / CGC / BGS slab images server-side without explicit consent.

## Next checkpoints

| Checkpoint | Bar |
|---|---|
| Wedge A proven | Friend reviews 10+ records, says ≥6 reports change a real decision. |
| Promote to Vendor Pilot Beta | 20+ Silver+ image-backed refs, 10+ human-DING reviewed, 5+ raw-card scans, 1+ before/after evidence pair. |
| Promote to Customer Alpha | 50+ refs, 20+ examples in `/examples`, 20+ human-reviewed DINGs, 10+ raw-card scan reports, exportable evidence works for a real dispute. |
| Production | Gold dataset, calibrated grade-band predictions vs actual returns, trusted public reports, no inference offline overlays in production demo. |
