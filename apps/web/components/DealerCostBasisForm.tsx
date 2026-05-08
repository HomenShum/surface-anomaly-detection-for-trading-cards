"use client";

import { useCallback, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { DealerCostBasis, DealerRecord } from "../lib/dealer/types";
import { computePnL } from "../lib/dealer/pnl";

/**
 * Cost-basis editor for one record. Surfaces:
 *  - Acquisition cost + date + channel + note
 *  - Inline fees ledger (grading, shipping, supplies) — add/remove rows
 *  - Sale price + date + channel + buyer (marks the record sold)
 *  - Live computed P&L: cost / revenue / net / margin% with status pill
 *  - Save POSTs /api/dealer/records/[id]/cost-basis and runs router.refresh
 */

function fmtUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

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

type FeeRow = { label: string; amount: string; paidAt?: string };

export function DealerCostBasisForm({ record }: { record: DealerRecord }) {
  const router = useRouter();
  const initial = record.costBasis ?? null;

  const [acquisitionCost, setAcquisitionCost] = useState(initial?.acquisitionCost?.toString() ?? "");
  const [acquisitionDate, setAcquisitionDate] = useState((initial?.acquisitionDate ?? "").slice(0, 10));
  const [acquisitionChannel, setAcquisitionChannel] = useState<DealerCostBasis["acquisitionChannel"]>(
    initial?.acquisitionChannel,
  );
  const [acquisitionNote, setAcquisitionNote] = useState(initial?.acquisitionNote ?? "");
  const [fees, setFees] = useState<FeeRow[]>(
    (initial?.fees ?? []).map((f) => ({
      label: f.label,
      amount: String(f.amount),
      paidAt: f.paidAt?.slice(0, 10),
    })),
  );
  const [salePrice, setSalePrice] = useState(initial?.salePrice?.toString() ?? "");
  const [saleDate, setSaleDate] = useState((initial?.saleDate ?? "").slice(0, 10));
  const [saleChannel, setSaleChannel] = useState<DealerCostBasis["saleChannel"]>(initial?.saleChannel);
  const [saleBuyer, setSaleBuyer] = useState(initial?.saleBuyer ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  // Live P&L from current form values (not from saved record state).
  const livePnL = useMemo(() => {
    const draft: DealerCostBasis = {
      acquisitionCost: acquisitionCost ? Number(acquisitionCost) : undefined,
      acquisitionDate: acquisitionDate || undefined,
      acquisitionChannel,
      fees: fees
        .map((f) => {
          const amount = Number(f.amount);
          return Number.isFinite(amount) && f.label.trim()
            ? { label: f.label.trim(), amount, paidAt: f.paidAt }
            : null;
        })
        .filter((f): f is NonNullable<typeof f> => f !== null),
      salePrice: salePrice ? Number(salePrice) : undefined,
    };
    return computePnL(draft);
  }, [acquisitionCost, acquisitionDate, acquisitionChannel, fees, salePrice]);

  const addFee = useCallback(() => {
    setFees((prev) => [...prev, { label: "", amount: "" }]);
  }, []);

  const removeFee = useCallback((idx: number) => {
    setFees((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const updateFee = useCallback((idx: number, patch: Partial<FeeRow>) => {
    setFees((prev) => prev.map((f, i) => (i === idx ? { ...f, ...patch } : f)));
  }, []);

  const onSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setBusy(true);
      setError(null);
      try {
        const payload: Record<string, unknown> = {};
        if (acquisitionCost) payload.acquisitionCost = Number(acquisitionCost);
        if (acquisitionDate) payload.acquisitionDate = new Date(acquisitionDate).toISOString();
        if (acquisitionChannel) payload.acquisitionChannel = acquisitionChannel;
        if (acquisitionNote.trim()) payload.acquisitionNote = acquisitionNote.trim();
        const cleanedFees = fees
          .map((f) => {
            const amount = Number(f.amount);
            return Number.isFinite(amount) && f.label.trim()
              ? {
                  label: f.label.trim(),
                  amount,
                  paidAt: f.paidAt ? new Date(f.paidAt).toISOString() : undefined,
                }
              : null;
          })
          .filter((f): f is NonNullable<typeof f> => f !== null);
        if (cleanedFees.length > 0) payload.fees = cleanedFees;
        if (salePrice) payload.salePrice = Number(salePrice);
        if (saleDate) payload.saleDate = new Date(saleDate).toISOString();
        if (saleChannel) payload.saleChannel = saleChannel;
        if (saleBuyer.trim()) payload.saleBuyer = saleBuyer.trim();

        const res = await fetch(`/api/dealer/records/${record.id}/cost-basis`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          throw new Error(`cost-basis API ${res.status}`);
        }
        setSavedAt(new Date().toISOString());
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "save failed");
      } finally {
        setBusy(false);
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
      record.id,
      router,
    ],
  );

  const statusPill =
    livePnL?.status === "realized"
      ? { label: "REALIZED", tone: "good" }
      : livePnL?.status === "open"
        ? { label: "OPEN POSITION", tone: "info" }
        : { label: "NO COST TRACKED", tone: "muted" };

  return (
    <form className="dealer-costbasis" onSubmit={onSubmit}>
      <header className="dealer-costbasis-head">
        <div>
          <span className="dealer-costbasis-kicker">Cost basis &amp; P&amp;L</span>
          <h2>Track this card's economics</h2>
          <p>
            Acquisition cost minus realized sale = real margin. Logged separately from{" "}
            <code>pricing.rawHigh</code> (which is comp-derived market estimate, not your basis).
          </p>
        </div>
        <span className={`dealer-pill dealer-pill--${statusPill.tone}`}>{statusPill.label}</span>
      </header>

      <div className="dealer-costbasis-pnl" aria-label="Live P&amp;L">
        <div>
          <span>Cost</span>
          <strong>{fmtUsd(livePnL?.cost ?? null)}</strong>
          <small>
            acq {fmtUsd(livePnL?.acquisitionCost ?? null)} + fees {fmtUsd(livePnL?.feesTotal ?? null)}
          </small>
        </div>
        <div>
          <span>Revenue</span>
          <strong>{fmtUsd(livePnL?.revenue ?? null)}</strong>
          <small>{livePnL?.revenue ? "marked sold" : "open position"}</small>
        </div>
        <div>
          <span>Net</span>
          <strong className={livePnL && livePnL.net >= 0 ? "is-up" : "is-down"}>
            {fmtUsd(livePnL?.net ?? null)}
          </strong>
          <small>{fmtPct(livePnL?.marginPct ?? null)} margin</small>
        </div>
      </div>

      <fieldset className="dealer-costbasis-section">
        <legend>Acquisition</legend>
        <label>
          <span>Cost paid</span>
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
          <span>Date</span>
          <input
            onChange={(e) => setAcquisitionDate(e.target.value)}
            type="date"
            value={acquisitionDate}
          />
        </label>
        <label>
          <span>Channel</span>
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
        <label className="dealer-costbasis-fullrow">
          <span>Note (optional)</span>
          <input
            maxLength={480}
            onChange={(e) => setAcquisitionNote(e.target.value)}
            placeholder="Bid sniped at 14:32, seller had 99.4%"
            type="text"
            value={acquisitionNote}
          />
        </label>
      </fieldset>

      <fieldset className="dealer-costbasis-section">
        <legend>
          Fees ({fees.length})
          <button className="dealer-costbasis-addfee" onClick={addFee} type="button">
            + add fee
          </button>
        </legend>
        {fees.length === 0 ? (
          <p className="dealer-costbasis-empty">
            No fees yet. Add grading ($25-$45), shipping ($8-$15), slabbing supplies, etc.
          </p>
        ) : (
          <div className="dealer-costbasis-fees">
            {fees.map((fee, idx) => (
              <div className="dealer-costbasis-fee-row" key={idx}>
                <input
                  aria-label="Fee label"
                  maxLength={64}
                  onChange={(e) => updateFee(idx, { label: e.target.value })}
                  placeholder="grading / shipping / supplies"
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
                  className="dealer-costbasis-removefee"
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

      <fieldset className="dealer-costbasis-section">
        <legend>Sale</legend>
        <label>
          <span>Price realized</span>
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
          <span>Date</span>
          <input onChange={(e) => setSaleDate(e.target.value)} type="date" value={saleDate} />
        </label>
        <label>
          <span>Channel</span>
          <select
            onChange={(e) =>
              setSaleChannel((e.target.value || undefined) as DealerCostBasis["saleChannel"])
            }
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
          <span>Buyer</span>
          <input
            maxLength={120}
            onChange={(e) => setSaleBuyer(e.target.value)}
            placeholder="username / handle"
            type="text"
            value={saleBuyer}
          />
        </label>
      </fieldset>

      {error ? <div className="dealer-costbasis-error">{error}</div> : null}

      <footer className="dealer-costbasis-foot">
        {savedAt ? (
          <span className="dealer-costbasis-saved">saved · {new Date(savedAt).toLocaleTimeString()}</span>
        ) : (
          <span className="dealer-costbasis-help">Saving will refresh the dashboard P&amp;L aggregates.</span>
        )}
        <button className="dealer-costbasis-save" disabled={busy} type="submit">
          {busy ? "saving…" : salePrice ? "save · mark sold" : "save cost basis"}
        </button>
      </footer>
    </form>
  );
}
