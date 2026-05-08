"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { DealerRecord } from "../lib/dealer/types";
import { DealerCardThumb } from "./DealerCardThumb";

/**
 * Workbench triage queue.
 *
 * - Vertical stack of records that need a dealer decision
 * - Bucket chips at top filter by recommendation (URL-state ?bucket=)
 * - Per-row 1-click accept that POSTs /api/dealer/records/[id]/review
 *   and shows a 5s undo bar; clicking undo re-POSTs the previous
 *   decision (or a "before_after_evidence" placeholder if there was none)
 * - Multi-select checkboxes for batch accept (parallel fetch of all
 *   selected reviews with a shared 5s undo)
 * - Keyboard nav: j/k move focus, a accept current, o open record,
 *   r ask Pi, x toggle select, A select all, Esc clear selection
 * - router.refresh() runs after every mutation so the sidebar badges
 *   and other server components reflect the new lane counts
 */

type BucketKey = "all" | "review" | "submit" | "sell" | "rescan";

const BUCKETS: Array<{ id: BucketKey; label: string; predicate: (r: DealerRecord) => boolean; tone: string }> = [
  { id: "all", label: "All", predicate: () => true, tone: "muted" },
  { id: "review", label: "Human review", predicate: (r) => r.lane === "human_review", tone: "warn" },
  { id: "submit", label: "Submit for grading", predicate: (r) => r.roi?.recommendation === "submit", tone: "good" },
  { id: "sell", label: "Sell raw", predicate: (r) => r.roi?.recommendation === "sell_raw", tone: "info" },
  { id: "rescan", label: "Rescan", predicate: (r) => r.roi?.recommendation === "rescan", tone: "muted" },
];

const RECOMMENDATION_PILL: Record<string, { label: string; tone: string }> = {
  submit: { label: "submit for grading", tone: "good" },
  sell_raw: { label: "sell raw", tone: "warn" },
  hold: { label: "hold", tone: "muted" },
  rescan: { label: "rescan", tone: "info" },
  human_review: { label: "flag review", tone: "bad" },
};

type ReviewDecision = NonNullable<DealerRecord["humanReview"]>["decision"];

function decisionFromRecommendation(reco: string | undefined): ReviewDecision {
  if (reco === "submit") return "submit_for_grading";
  if (reco === "sell_raw") return "sell_raw";
  if (reco === "rescan") return "rescan";
  return "human_review";
}

function fmtUsd(n: number | undefined | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

function fmtRelTime(iso: string | undefined, now: number | null): string {
  if (!iso || now === null) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const diff = now - t;
  const sec = Math.max(0, Math.floor(diff / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}

async function postReview(recordId: string, decision: ReviewDecision, notes: string): Promise<void> {
  const res = await fetch(`/api/dealer/records/${recordId}/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decision, notes, reviewerId: "vendor_pilot" }),
  });
  if (!res.ok) {
    throw new Error(`review API ${res.status}`);
  }
}

type UndoEntry = {
  id: string;
  recordIds: string[];
  priorDecisions: Map<string, { decision: ReviewDecision | null; notes: string | null }>;
  expiresAt: number;
  label: string;
};

export function DealerWorkbenchQueue({
  queue,
  buckets,
}: {
  queue: DealerRecord[];
  buckets: Record<BucketKey, number>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [bucket, setBucket] = useState<BucketKey>(
    () => ((searchParams?.get("bucket") as BucketKey) || "all"),
  );
  const [now, setNow] = useState<number | null>(null);
  const [resolvedIds, setResolvedIds] = useState<Set<string>>(new Set());
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [undo, setUndo] = useState<UndoEntry | null>(null);
  const [undoCountdown, setUndoCountdown] = useState<number>(0);
  const [focusIndex, setFocusIndex] = useState<number>(0);
  const rowRefs = useRef<Array<HTMLLIElement | null>>([]);

  useEffect(() => {
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  // Mirror bucket state to URL.
  useEffect(() => {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (bucket === "all") params.delete("bucket");
    else params.set("bucket", bucket);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [bucket, pathname, router, searchParams]);

  // Tick the undo countdown every 100ms while an undo is active.
  useEffect(() => {
    if (!undo) {
      setUndoCountdown(0);
      return;
    }
    const tick = () => {
      const remaining = Math.max(0, undo.expiresAt - Date.now());
      setUndoCountdown(remaining);
      if (remaining <= 0) {
        setUndo(null);
      }
    };
    tick();
    const t = window.setInterval(tick, 100);
    return () => window.clearInterval(t);
  }, [undo]);

  const filtered = useMemo(() => {
    const pred = BUCKETS.find((b) => b.id === bucket)?.predicate ?? (() => true);
    return queue.filter((r) => pred(r) && !resolvedIds.has(r.id));
  }, [queue, bucket, resolvedIds]);

  const filteredIds = useMemo(() => filtered.map((r) => r.id), [filtered]);

  // Clamp focus index when the list shrinks.
  useEffect(() => {
    if (focusIndex >= filtered.length) {
      setFocusIndex(Math.max(0, filtered.length - 1));
    }
  }, [filtered.length, focusIndex]);

  const accept = useCallback(
    async (records: DealerRecord[]) => {
      if (records.length === 0) return;
      const ids = records.map((r) => r.id);
      setBusyIds((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.add(id);
        return next;
      });
      setError(null);

      const priorDecisions = new Map<string, { decision: ReviewDecision | null; notes: string | null }>();
      for (const r of records) {
        priorDecisions.set(r.id, {
          decision: r.humanReview?.decision ?? null,
          notes: r.humanReview?.notes ?? null,
        });
      }

      try {
        await Promise.all(
          records.map((r) => {
            const decision = decisionFromRecommendation(r.roi?.recommendation);
            return postReview(
              r.id,
              decision,
              `Workbench: accepted AI recommendation (${r.roi?.recommendation ?? "n/a"}).`,
            );
          }),
        );
        setResolvedIds((prev) => {
          const next = new Set(prev);
          for (const id of ids) next.add(id);
          return next;
        });
        setSelectedIds(new Set());
        setUndo({
          id: `undo_${Date.now()}`,
          recordIds: ids,
          priorDecisions,
          expiresAt: Date.now() + 5_000,
          label: ids.length === 1 ? "Decision saved" : `${ids.length} decisions saved`,
        });
        // Refresh server components so sidebar badges + ready counts update.
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "review failed");
      } finally {
        setBusyIds((prev) => {
          const next = new Set(prev);
          for (const id of ids) next.delete(id);
          return next;
        });
      }
    },
    [router],
  );

  const undoLast = useCallback(async () => {
    if (!undo) return;
    setBusyIds((prev) => {
      const next = new Set(prev);
      for (const id of undo.recordIds) next.add(id);
      return next;
    });
    setError(null);
    try {
      await Promise.all(
        undo.recordIds.map(async (id) => {
          const prior = undo.priorDecisions.get(id);
          // If there was no prior review, write a placeholder that puts
          // the record back into the human_review lane so it re-appears.
          const decision: ReviewDecision = prior?.decision ?? "before_after_evidence";
          const notes = prior?.notes ?? "Workbench: undo (reverted to pre-accept state).";
          await postReview(id, decision, notes);
        }),
      );
      setResolvedIds((prev) => {
        const next = new Set(prev);
        for (const id of undo.recordIds) next.delete(id);
        return next;
      });
      setUndo(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "undo failed");
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        for (const id of undo.recordIds) next.delete(id);
        return next;
      });
    }
  }, [undo, router]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(filteredIds));
  }, [filteredIds]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const acceptSelected = useCallback(async () => {
    const records = filtered.filter((r) => selectedIds.has(r.id));
    await accept(records);
  }, [filtered, selectedIds, accept]);

  // Keyboard nav: j/k, a, o, r, x, A, Esc
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (filtered.length === 0) return;

      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setFocusIndex((prev) => Math.min(filtered.length - 1, prev + 1));
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setFocusIndex((prev) => Math.max(0, prev - 1));
      } else if (e.key === "a" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        const r = filtered[focusIndex];
        if (r) void accept([r]);
      } else if (e.key === "A" && e.shiftKey) {
        e.preventDefault();
        selectAll();
      } else if (e.key === "x") {
        e.preventDefault();
        const r = filtered[focusIndex];
        if (r) toggleSelect(r.id);
      } else if (e.key === "o") {
        e.preventDefault();
        const r = filtered[focusIndex];
        if (r) router.push(`/dealer/records/${r.id}`);
      } else if (e.key === "r") {
        e.preventDefault();
        const r = filtered[focusIndex];
        if (r) {
          // Click the row's ask-Pi button to summon the dock with record context.
          const askButton = rowRefs.current[focusIndex]?.querySelector('[data-agent-summon]') as HTMLButtonElement | null;
          askButton?.click();
        }
      } else if (e.key === "Escape") {
        if (selectedIds.size > 0) {
          e.preventDefault();
          clearSelection();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [filtered, focusIndex, accept, toggleSelect, selectAll, clearSelection, selectedIds.size, router]);

  // Scroll the focused row into view.
  useEffect(() => {
    const el = rowRefs.current[focusIndex];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [focusIndex]);

  const selectedCount = selectedIds.size;
  const undoSecondsRemaining = Math.ceil(undoCountdown / 1000);

  return (
    <section className="dealer-workbench">
      <div className="dealer-workbench-buckets" role="tablist" aria-label="Workbench buckets">
        {BUCKETS.map((b) => {
          const count = buckets[b.id] ?? 0;
          return (
            <button
              aria-selected={bucket === b.id}
              className={`dealer-workbench-bucket dealer-workbench-bucket--${b.tone}${bucket === b.id ? " is-active" : ""}`}
              key={b.id}
              onClick={() => setBucket(b.id)}
              role="tab"
              type="button"
            >
              <strong>{b.label}</strong>
              <span>{count}</span>
            </button>
          );
        })}
        <span className="dealer-workbench-keyhints">
          <kbd>j</kbd>/<kbd>k</kbd> nav · <kbd>a</kbd> accept · <kbd>x</kbd> select · <kbd>o</kbd> open · <kbd>r</kbd> ask Pi
        </span>
      </div>

      {error ? (
        <div className="dealer-workbench-error" role="status">
          {error}. Open the record to retry manually.
        </div>
      ) : null}

      {selectedCount > 0 ? (
        <div className="dealer-workbench-batchbar" role="toolbar" aria-label="Batch actions">
          <span>
            <strong>{selectedCount}</strong> selected
          </span>
          <button
            className="dealer-workbench-batchbar-accept"
            disabled={selectedCount === 0}
            onClick={() => void acceptSelected()}
            type="button"
          >
            accept all ({selectedCount})
          </button>
          <button
            className="dealer-workbench-batchbar-clear"
            onClick={clearSelection}
            type="button"
          >
            clear
          </button>
        </div>
      ) : null}

      {undo ? (
        <div className="dealer-workbench-undo" role="status" aria-live="polite">
          <span>{undo.label}</span>
          <button
            className="dealer-workbench-undo-action"
            onClick={() => void undoLast()}
            type="button"
          >
            undo ({undoSecondsRemaining}s)
          </button>
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <p className="dealer-workbench-empty">
          Inbox zero. No records waiting on a decision in this bucket.
        </p>
      ) : (
        <ol className="dealer-workbench-list">
          {filtered.map((r, idx) => {
            const recommendation = r.roi?.recommendation;
            const pill = recommendation ? RECOMMENDATION_PILL[recommendation] : undefined;
            const value = r.pricing?.rawHigh ?? r.pricing?.graded9 ?? null;
            const ev = r.roi?.expectedGradedEv ?? null;
            const dings = r.modelFindings?.length ?? 0;
            const cert = r.certNumber ? `${r.certProvider ?? "PSA"} ${r.certNumber}` : null;
            const title = r.cardIdentity ?? cert ?? `Capture ${r.id.slice(-6)}`;
            const isBusy = busyIds.has(r.id);
            const isSelected = selectedIds.has(r.id);
            const isFocused = idx === focusIndex;
            return (
              <li
                aria-selected={isSelected}
                className={`dealer-workbench-row${isFocused ? " is-focused" : ""}${isSelected ? " is-selected" : ""}`}
                key={r.id}
                ref={(el) => {
                  rowRefs.current[idx] = el;
                }}
                onMouseEnter={() => setFocusIndex(idx)}
              >
                <label className="dealer-workbench-row-select">
                  <input
                    aria-label={`Select ${cert ?? r.id}`}
                    checked={isSelected}
                    onChange={() => toggleSelect(r.id)}
                    type="checkbox"
                  />
                </label>
                <div className="dealer-workbench-row-thumb">
                  <DealerCardThumb
                    src={r.imageUrl}
                    fallback={
                      <div className="dealer-workbench-row-thumb-fallback" aria-hidden>
                        <em>{(r.certProvider ?? "RAW").slice(0, 3).toUpperCase()}</em>
                        {r.certNumber ? <b>{r.certNumber.slice(-4)}</b> : <b>{r.id.slice(-4)}</b>}
                      </div>
                    }
                  />
                </div>
                <div className="dealer-workbench-row-body">
                  <header>
                    <span className="dealer-workbench-row-cert">{cert ?? r.id.slice(0, 14)}</span>
                    {pill ? (
                      <span className={`dealer-pill dealer-pill--${pill.tone}`}>{pill.label}</span>
                    ) : (
                      <span className="dealer-pill dealer-pill--muted">{r.lane.replaceAll("_", " ")}</span>
                    )}
                  </header>
                  <p className="dealer-workbench-row-title">{title}</p>
                  <p className="dealer-workbench-row-meta">
                    <span>{r.officialGrade ?? "no grade"}</span>
                    <span aria-hidden>·</span>
                    <span>{dings} DING{dings === 1 ? "" : "s"}</span>
                    <span aria-hidden>·</span>
                    <span>last touched {fmtRelTime(r.updatedAt, now) || "—"} ago</span>
                  </p>
                </div>
                <div className="dealer-workbench-row-prices">
                  <div>
                    <span>raw</span>
                    <strong>{fmtUsd(value)}</strong>
                  </div>
                  <div>
                    <span>graded EV</span>
                    <strong>{fmtUsd(ev)}</strong>
                  </div>
                </div>
                <div className="dealer-workbench-row-actions">
                  <button
                    aria-label={pill ? `Accept ${pill.label}` : "Accept"}
                    className="dealer-workbench-row-accept"
                    disabled={isBusy}
                    onClick={() => void accept([r])}
                    type="button"
                  >
                    {isBusy ? "saving…" : `accept ${pill?.label ?? "decision"}`}
                  </button>
                  <Link className="dealer-workbench-row-open" href={`/dealer/records/${r.id}`}>
                    open record →
                  </Link>
                  <button
                    aria-label="Ask Pi about this record"
                    className="dealer-workbench-row-ask"
                    data-agent-record-id={r.id}
                    data-agent-summon
                    type="button"
                  >
                    ask Pi
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
