"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { DealerCostBasis } from "../lib/dealer/types";
import { computePnL } from "../lib/dealer/pnl";

/**
 * Cost-basis quick-note popover.
 *
 * Slides in from the right edge. Two stacked panels:
 *   1. AI Notes — single textarea where the dealer pastes their messy
 *      buy log ("won bid 3/14 for $87, paid $35 grading 4/2, shipped $8,
 *      sold @drewz on eBay 5/22 for $260"). Hits /api/dealer/cost-basis/parse
 *      → fills the structured form below.
 *   2. Confirm form — pre-populated structured fields the user can tweak
 *      before saving. Live P&L updates as the user types.
 *
 * Mounted globally inside DealerShell. Triggers:
 *   - Click any [data-cost-basis-summon] element with optional
 *     data-record-id="<id>" + data-record-cert="<cert>"
 *   - Press `c` when on a /dealer/records/[id] route
 *   - Cmd-K palette action "Track economics for {record}"
 *
 * Drawer-mode is intentional: avoids the prior scroll-trapping problem
 * where the cost-basis form lived at the bottom of the record-detail
 * canvas competing with slab image / review / pricing / variant /
 * evidence sections.
 */

type CostBasisTarget = {
  recordId: string;
  cert: string;
  // Existing cost basis from the record so the drawer pre-loads what
  // was already saved (vs. letting a stale empty form overwrite it).
  initial?: DealerCostBasis;
};

type FeeRow = { label: string; amount: string; paidAt?: string };

const ACQUISITION_CHANNELS: Array<{ id: NonNullable<DealerCostBasis["acquisitionChannel"]>; label: string }> = [
  { id: "ebay", label: "eBay" },
  { id: "tcgplayer", label: "TCGplayer" },
  { id: "cardmarket", label: "Cardmarket" },
  { id: "auction", label: "Auction" },
  { id: "private", label: "Private" },
  { id: "other", label: "Other" },
];

const SALE_CHANNELS: Array<{ id: NonNullable<DealerCostBasis["saleChannel"]>; label: string }> = [
  { id: "ebay", label: "eBay" },
  { id: "tcgplayer", label: "TCGplayer" },
  { id: "cardmarket", label: "Cardmarket" },
  { id: "private", label: "Private" },
  { id: "other", label: "Other" },
];

const NOTES_PLACEHOLDER = `Paste your buy log here. Pi will extract the fields below.

Examples that work:
  Won bid 3/14 for $87 on eBay. Paid $35 grading 4/2.
  Shipped $8 to PSA. Sold @drewz on eBay 5/22 for $260.

  TCGplayer 2/1 — bought $145 + $3 shipping. Held since.

  Auction $440, $25 sub fee, $14 ship+ins. Sold private to JC for $720.`;

function fmtUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

function isoDateToInput(iso: string | undefined | null): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  return new Date(t).toISOString().slice(0, 10);
}

export function DealerCostBasisDrawer() {
  const router = useRouter();
  const pathname = usePathname();

  const [target, setTarget] = useState<CostBasisTarget | null>(null);
  const [notes, setNotes] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [parseProvider, setParseProvider] = useState<string | null>(null);
  const [parseSummary, setParseSummary] = useState<string | null>(null);

  const [acquisitionCost, setAcquisitionCost] = useState("");
  const [acquisitionDate, setAcquisitionDate] = useState("");
  const [acquisitionChannel, setAcquisitionChannel] =
    useState<DealerCostBasis["acquisitionChannel"]>(undefined);
  const [acquisitionNote, setAcquisitionNote] = useState("");
  const [fees, setFees] = useState<FeeRow[]>([]);
  const [salePrice, setSalePrice] = useState("");
  const [saleDate, setSaleDate] = useState("");
  const [saleChannel, setSaleChannel] = useState<DealerCostBasis["saleChannel"]>(undefined);
  const [saleBuyer, setSaleBuyer] = useState("");

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  // Snapshot of the form values that match the last successfully-saved
  // state. We compare current values against this to drive the "no
  // changes" / "save" / "save · mark sold" affordance.
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null);
  // Idempotency key sent with each save — prevents duplicate writes when
  // the user double-clicks or the request retries.
  const idempotencyKeyRef = useRef<string>("");
  const closeTimerRef = useRef<number | null>(null);

  const notesRef = useRef<HTMLTextAreaElement>(null);
  const drawerRef = useRef<HTMLElement>(null);

  // Build a deterministic snapshot string for dirty-state comparison.
  // Sort + JSON-encode form values so {fees:[a,b]} === {fees:[a,b]}.
  const snapshotOf = useCallback(
    (
      fields: {
        acquisitionCost: string;
        acquisitionDate: string;
        acquisitionChannel: DealerCostBasis["acquisitionChannel"];
        acquisitionNote: string;
        fees: FeeRow[];
        salePrice: string;
        saleDate: string;
        saleChannel: DealerCostBasis["saleChannel"];
        saleBuyer: string;
      },
    ): string => {
      const fees = [...fields.fees]
        .map((f) => ({ label: f.label.trim(), amount: f.amount, paidAt: f.paidAt ?? "" }))
        .sort((a, b) => (a.label + a.amount).localeCompare(b.label + b.amount));
      return JSON.stringify({
        ac: fields.acquisitionCost,
        ad: fields.acquisitionDate,
        ach: fields.acquisitionChannel ?? "",
        an: fields.acquisitionNote.trim(),
        fees,
        sp: fields.salePrice,
        sd: fields.saleDate,
        sch: fields.saleChannel ?? "",
        sb: fields.saleBuyer.trim(),
      });
    },
    [],
  );

  // Reset the form to a target's saved state.
  const resetForm = useCallback(
    (next: CostBasisTarget | null) => {
      if (!next) {
        setNotes("");
        setAcquisitionCost("");
        setAcquisitionDate("");
        setAcquisitionChannel(undefined);
        setAcquisitionNote("");
        setFees([]);
        setSalePrice("");
        setSaleDate("");
        setSaleChannel(undefined);
        setSaleBuyer("");
        setSavedSnapshot(null);
        return;
      }
      const cb = next.initial;
      setNotes("");
      setParseError(null);
      setParseProvider(null);
      setParseSummary(null);
      setSaveError(null);
      setSavedAt(null);
      const ac = cb?.acquisitionCost?.toString() ?? "";
      const ad = isoDateToInput(cb?.acquisitionDate);
      const ach = cb?.acquisitionChannel;
      const an = cb?.acquisitionNote ?? "";
      const feeRows: FeeRow[] = (cb?.fees ?? []).map((f) => ({
        label: f.label,
        amount: String(f.amount),
        paidAt: isoDateToInput(f.paidAt),
      }));
      const sp = cb?.salePrice?.toString() ?? "";
      const sd = isoDateToInput(cb?.saleDate);
      const sch = cb?.saleChannel;
      const sb = cb?.saleBuyer ?? "";
      setAcquisitionCost(ac);
      setAcquisitionDate(ad);
      setAcquisitionChannel(ach);
      setAcquisitionNote(an);
      setFees(feeRows);
      setSalePrice(sp);
      setSaleDate(sd);
      setSaleChannel(sch);
      setSaleBuyer(sb);
      // Snapshot starts equal to the loaded state — that's "no changes".
      setSavedSnapshot(
        snapshotOf({
          acquisitionCost: ac,
          acquisitionDate: ad,
          acquisitionChannel: ach,
          acquisitionNote: an,
          fees: feeRows,
          salePrice: sp,
          saleDate: sd,
          saleChannel: sch,
          saleBuyer: sb,
        }),
      );
      // New idempotency key per drawer-open. Subsequent saves within the
      // same drawer session reuse this key so a double-click is dropped.
      idempotencyKeyRef.current =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `cb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    },
    [snapshotOf],
  );

  // Cleanup the auto-close timer when the drawer unmounts or target changes.
  useEffect(() => {
    return () => {
      if (closeTimerRef.current) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    };
  }, []);

  // Open via [data-cost-basis-summon] click. Optionally carries
  // data-record-id + data-record-cert + data-record-cb (JSON-encoded
  // existing cost basis) to preload the form.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onClick = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-cost-basis-summon]");
      if (!el) return;
      e.preventDefault();
      const recordId = el.getAttribute("data-record-id");
      const cert = el.getAttribute("data-record-cert") ?? recordId ?? "this record";
      const cbAttr = el.getAttribute("data-record-cb");
      let initial: DealerCostBasis | undefined;
      if (cbAttr) {
        try {
          initial = JSON.parse(cbAttr) as DealerCostBasis;
        } catch {
          /* skip */
        }
      }
      if (!recordId) {
        // No record context — fall back to inferring from the URL.
        const m = window.location.pathname.match(/\/dealer\/records\/([^/]+)/);
        if (!m) {
          alert("Open a record first, then track economics for it.");
          return;
        }
        const next: CostBasisTarget = { recordId: m[1]!, cert };
        resetForm(next);
        setTarget(next);
        return;
      }
      const next: CostBasisTarget = { recordId, cert, initial };
      resetForm(next);
      setTarget(next);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [resetForm]);

  // Keyboard 'c' on a record page summons the drawer with that record.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.key !== "c" || e.metaKey || e.ctrlKey || e.altKey) return;
      const m = pathname?.match(/\/dealer\/records\/([^/]+)/);
      if (!m) return;
      e.preventDefault();
      const next: CostBasisTarget = { recordId: m[1]!, cert: m[1]! };
      resetForm(next);
      setTarget(next);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [pathname, resetForm]);

  // Esc to dismiss + focus the notes box on open.
  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setTarget(null);
      }
    };
    document.addEventListener("keydown", onKey);
    const t = window.setTimeout(() => notesRef.current?.focus(), 50);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.clearTimeout(t);
    };
  }, [target]);

  const livePnL = useMemo(() => {
    const draft: DealerCostBasis = {
      acquisitionCost: acquisitionCost ? Number(acquisitionCost) : undefined,
      fees: fees
        .map((f) => {
          const amount = Number(f.amount);
          return Number.isFinite(amount) && f.label.trim() ? { label: f.label.trim(), amount } : null;
        })
        .filter((f): f is { label: string; amount: number } => f !== null),
      salePrice: salePrice ? Number(salePrice) : undefined,
    };
    return computePnL(draft);
  }, [acquisitionCost, fees, salePrice]);

  const parseNotes = useCallback(async () => {
    if (!notes.trim()) {
      setParseError("Paste some notes first, then Pi can parse them.");
      return;
    }
    setParsing(true);
    setParseError(null);
    setParseProvider(null);
    setParseSummary(null);
    try {
      const res = await fetch("/api/dealer/cost-basis/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes, recordId: target?.recordId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `parse HTTP ${res.status}`);
      }
      const body = (await res.json()) as {
        parsed?: Partial<DealerCostBasis>;
        provider?: string;
        model?: string;
        error?: string;
      };
      setParseProvider(body.provider ? `${body.provider}${body.model ? ` · ${body.model}` : ""}` : null);
      const parsed = body.parsed ?? {};
      const filled: string[] = [];
      if (parsed.acquisitionCost !== undefined) {
        setAcquisitionCost(String(parsed.acquisitionCost));
        filled.push(`acq $${parsed.acquisitionCost}`);
      }
      if (parsed.acquisitionDate) {
        setAcquisitionDate(isoDateToInput(parsed.acquisitionDate));
        filled.push("acq date");
      }
      if (parsed.acquisitionChannel) {
        setAcquisitionChannel(parsed.acquisitionChannel);
        filled.push(parsed.acquisitionChannel);
      }
      if (parsed.acquisitionNote) {
        setAcquisitionNote(parsed.acquisitionNote);
      }
      if (parsed.fees && parsed.fees.length > 0) {
        setFees(
          parsed.fees.map((f) => ({
            label: f.label,
            amount: String(f.amount),
            paidAt: isoDateToInput(f.paidAt),
          })),
        );
        filled.push(`${parsed.fees.length} fee${parsed.fees.length === 1 ? "" : "s"}`);
      }
      if (parsed.salePrice !== undefined) {
        setSalePrice(String(parsed.salePrice));
        filled.push(`sale $${parsed.salePrice}`);
      }
      if (parsed.saleDate) {
        setSaleDate(isoDateToInput(parsed.saleDate));
      }
      if (parsed.saleChannel) {
        setSaleChannel(parsed.saleChannel);
      }
      if (parsed.saleBuyer) {
        setSaleBuyer(parsed.saleBuyer);
      }
      setParseSummary(filled.length > 0 ? `prefilled: ${filled.join(" · ")}` : "no fields could be extracted — fill manually");
      if (body.error) {
        setParseError(`parsed via fallback: ${body.error}`);
      }
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "parse failed");
    } finally {
      setParsing(false);
    }
  }, [notes, target?.recordId]);

  // Dirty = current form snapshot ≠ last-saved snapshot.
  const currentSnapshot = useMemo(
    () =>
      snapshotOf({
        acquisitionCost,
        acquisitionDate,
        acquisitionChannel,
        acquisitionNote,
        fees,
        salePrice,
        saleDate,
        saleChannel,
        saleBuyer,
      }),
    [
      snapshotOf,
      acquisitionCost,
      acquisitionDate,
      acquisitionChannel,
      acquisitionNote,
      fees,
      salePrice,
      saleDate,
      saleChannel,
      saleBuyer,
    ],
  );
  const isDirty = savedSnapshot !== null && currentSnapshot !== savedSnapshot;

  const onSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!target || saving) return;
      // No-op if nothing changed since last save — avoids double-write
      // and keeps the audit trail clean.
      if (!isDirty && savedAt) {
        // User clicked save twice without editing — close instead.
        setTarget(null);
        return;
      }
      setSaving(true);
      setSaveError(null);
      try {
        const payload: Record<string, unknown> = {};
        if (acquisitionCost) payload.acquisitionCost = Number(acquisitionCost);
        if (acquisitionDate) payload.acquisitionDate = new Date(acquisitionDate).toISOString();
        if (acquisitionChannel) payload.acquisitionChannel = acquisitionChannel;
        if (acquisitionNote.trim()) payload.acquisitionNote = acquisitionNote.trim();
        const cleanedFees: Array<{ label: string; amount: number; paidAt?: string }> = [];
        for (const f of fees) {
          const amount = Number(f.amount);
          if (!Number.isFinite(amount) || !f.label.trim()) continue;
          cleanedFees.push({
            label: f.label.trim(),
            amount,
            paidAt: f.paidAt ? new Date(f.paidAt).toISOString() : undefined,
          });
        }
        // Always send fees array (even when empty) so the server can
        // distinguish "user cleared all fees" from "user didn't touch fees".
        // The server-side merge logic was: `sanitizedFees.length > 0 && {fees}`
        // — that meant clearing fees was impossible. Send `fees: []` and
        // let the server respect it as an explicit clear.
        payload.fees = cleanedFees;
        if (salePrice) payload.salePrice = Number(salePrice);
        if (saleDate) payload.saleDate = new Date(saleDate).toISOString();
        if (saleChannel) payload.saleChannel = saleChannel;
        if (saleBuyer.trim()) payload.saleBuyer = saleBuyer.trim();

        const res = await fetch(`/api/dealer/records/${target.recordId}/cost-basis`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKeyRef.current,
          },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(`save HTTP ${res.status}`);
        setSavedAt(new Date().toISOString());
        // Mark current values as "saved" so dirty=false and the button
        // text reflects "no changes".
        setSavedSnapshot(currentSnapshot);
        router.refresh();
        // Auto-close after a brief success confirmation. Cancellable so
        // user can still tweak something and resave without closing.
        if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = window.setTimeout(() => {
          setTarget(null);
          closeTimerRef.current = null;
        }, 1200);
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : "save failed");
      } finally {
        setSaving(false);
      }
    },
    [
      acquisitionCost,
      acquisitionDate,
      acquisitionChannel,
      acquisitionNote,
      fees,
      salePrice,
      saleDate,
      saleChannel,
      saleBuyer,
      target,
      saving,
      isDirty,
      savedAt,
      currentSnapshot,
      router,
    ],
  );

  // If user starts editing again after save, cancel the auto-close timer
  // and clear the "saved" state so the button reads "save" again.
  useEffect(() => {
    if (isDirty && closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, [isDirty]);

  const addFee = useCallback(() => {
    setFees((prev) => [...prev, { label: "", amount: "" }]);
  }, []);
  const removeFee = useCallback((idx: number) => {
    setFees((prev) => prev.filter((_, i) => i !== idx));
  }, []);
  const updateFee = useCallback((idx: number, patch: Partial<FeeRow>) => {
    setFees((prev) => prev.map((f, i) => (i === idx ? { ...f, ...patch } : f)));
  }, []);

  if (!target) return null;

  const statusPill =
    livePnL?.status === "realized"
      ? { label: "REALIZED", tone: "good" }
      : livePnL?.status === "open"
        ? { label: "OPEN", tone: "info" }
        : { label: "NO COST", tone: "muted" };

  return (
    <div
      aria-modal
      className="dealer-cb-drawer-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) setTarget(null);
      }}
      role="dialog"
    >
      <aside className="dealer-cb-drawer" ref={drawerRef} aria-label="Cost basis quick note">
        <header className="dealer-cb-drawer-head">
          <div>
            <span className="dealer-cb-drawer-kicker">Track economics</span>
            <h2>Cost basis · {target.cert}</h2>
            <p>Paste your messy buy log. Pi extracts the structured fields. Confirm and save.</p>
          </div>
          <div className="dealer-cb-drawer-head-right">
            <span className={`dealer-pill dealer-pill--${statusPill.tone}`}>{statusPill.label}</span>
            <button
              aria-label="Close"
              className="dealer-cb-drawer-close"
              onClick={() => setTarget(null)}
              type="button"
            >
              ×
            </button>
          </div>
        </header>

        <form className="dealer-cb-drawer-body" onSubmit={onSubmit}>
          <section className="dealer-cb-notes">
            <header>
              <span className="dealer-cb-notes-kicker">📝 Notes (Pi will parse)</span>
              {parseProvider ? <small>{parseProvider}</small> : null}
            </header>
            <textarea
              onChange={(e) => setNotes(e.target.value)}
              placeholder={NOTES_PLACEHOLDER}
              ref={notesRef}
              rows={5}
              value={notes}
            />
            <div className="dealer-cb-notes-actions">
              <button
                className="dealer-cb-notes-parse"
                disabled={parsing || !notes.trim()}
                onClick={(e) => {
                  e.preventDefault();
                  void parseNotes();
                }}
                type="button"
              >
                {parsing ? "parsing…" : "✦ parse with Pi"}
              </button>
              {parseSummary ? <span className="dealer-cb-notes-summary">{parseSummary}</span> : null}
              {parseError ? <span className="dealer-cb-notes-error">{parseError}</span> : null}
            </div>
          </section>

          <section className="dealer-cb-pnl" aria-label="Live P&amp;L">
            <div>
              <span>cost</span>
              <strong>{fmtUsd(livePnL?.cost ?? null)}</strong>
              <small>
                acq {fmtUsd(livePnL?.acquisitionCost ?? null)} + fees {fmtUsd(livePnL?.feesTotal ?? null)}
              </small>
            </div>
            <div>
              <span>revenue</span>
              <strong>{fmtUsd(livePnL?.revenue ?? null)}</strong>
              <small>{livePnL?.revenue ? "marked sold" : "open"}</small>
            </div>
            <div>
              <span>net</span>
              <strong className={livePnL && livePnL.net >= 0 ? "is-up" : "is-down"}>
                {fmtUsd(livePnL?.net ?? null)}
              </strong>
              <small>{fmtPct(livePnL?.marginPct ?? null)} margin</small>
            </div>
          </section>

          <fieldset className="dealer-cb-section">
            <legend>Acquisition</legend>
            <label>
              <span>cost</span>
              <input
                inputMode="decimal"
                min={0}
                onChange={(e) => setAcquisitionCost(e.target.value)}
                placeholder="0.00"
                step={0.01}
                type="number"
                value={acquisitionCost}
              />
            </label>
            <label>
              <span>date</span>
              <input onChange={(e) => setAcquisitionDate(e.target.value)} type="date" value={acquisitionDate} />
            </label>
            <label>
              <span>channel</span>
              <select
                onChange={(e) =>
                  setAcquisitionChannel((e.target.value || undefined) as DealerCostBasis["acquisitionChannel"])
                }
                value={acquisitionChannel ?? ""}
              >
                <option value="">—</option>
                {ACQUISITION_CHANNELS.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="dealer-cb-fullrow">
              <span>note (optional)</span>
              <input
                maxLength={480}
                onChange={(e) => setAcquisitionNote(e.target.value)}
                placeholder="auto-summarized from your notes"
                type="text"
                value={acquisitionNote}
              />
            </label>
          </fieldset>

          <fieldset className="dealer-cb-section">
            <legend>
              <span>Fees ({fees.length})</span>
              <button className="dealer-cb-addfee" onClick={addFee} type="button">
                + add
              </button>
            </legend>
            {fees.length === 0 ? (
              <p className="dealer-cb-empty">No fees yet. Pi will fill these from your notes.</p>
            ) : (
              <div className="dealer-cb-fees">
                {fees.map((fee, idx) => (
                  <div className="dealer-cb-fee-row" key={idx}>
                    <input
                      aria-label="Fee label"
                      maxLength={64}
                      onChange={(e) => updateFee(idx, { label: e.target.value })}
                      placeholder="grading / shipping"
                      type="text"
                      value={fee.label}
                    />
                    <input
                      aria-label="Fee amount"
                      inputMode="decimal"
                      min={0}
                      onChange={(e) => updateFee(idx, { amount: e.target.value })}
                      placeholder="0.00"
                      step={0.01}
                      type="number"
                      value={fee.amount}
                    />
                    <input
                      aria-label="Fee paid date"
                      onChange={(e) => updateFee(idx, { paidAt: e.target.value })}
                      type="date"
                      value={fee.paidAt ?? ""}
                    />
                    <button
                      aria-label="Remove fee"
                      className="dealer-cb-removefee"
                      onClick={() => removeFee(idx)}
                      type="button"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </fieldset>

          <fieldset className="dealer-cb-section">
            <legend>Sale</legend>
            <label>
              <span>price</span>
              <input
                inputMode="decimal"
                min={0}
                onChange={(e) => setSalePrice(e.target.value)}
                placeholder="0.00"
                step={0.01}
                type="number"
                value={salePrice}
              />
            </label>
            <label>
              <span>date</span>
              <input onChange={(e) => setSaleDate(e.target.value)} type="date" value={saleDate} />
            </label>
            <label>
              <span>channel</span>
              <select
                onChange={(e) => setSaleChannel((e.target.value || undefined) as DealerCostBasis["saleChannel"])}
                value={saleChannel ?? ""}
              >
                <option value="">—</option>
                {SALE_CHANNELS.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>buyer</span>
              <input
                maxLength={120}
                onChange={(e) => setSaleBuyer(e.target.value)}
                placeholder="@username"
                type="text"
                value={saleBuyer}
              />
            </label>
          </fieldset>

          {saveError ? <div className="dealer-cb-error">{saveError}</div> : null}

          <footer className="dealer-cb-foot">
            {savedAt && !isDirty ? (
              <span className="dealer-cb-saved">
                ✓ saved · {new Date(savedAt).toLocaleTimeString()} · closing…
              </span>
            ) : savedAt && isDirty ? (
              <span className="dealer-cb-help">edits since last save · save again or esc to close</span>
            ) : (
              <span className="dealer-cb-help">
                <kbd>esc</kbd> dismiss · <kbd>↵</kbd> save
              </span>
            )}
            <button
              className="dealer-cb-save"
              disabled={saving || (savedAt !== null && !isDirty)}
              type="submit"
            >
              {saving
                ? "saving…"
                : savedAt && !isDirty
                  ? "saved ✓"
                  : salePrice
                    ? "save · mark sold"
                    : isDirty
                      ? "save changes"
                      : "save"}
            </button>
          </footer>
        </form>
      </aside>
    </div>
  );
}
