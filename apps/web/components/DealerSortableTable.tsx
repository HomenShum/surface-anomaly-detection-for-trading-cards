"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import type { DealerRecord } from "../lib/dealer/types";

/**
 * Server components can't pass function properties (value/render) to a
 * client component over the RSC boundary. So instead of accepting raw
 * column definitions from the server, the table accepts a `kind` discriminator
 * and looks up the columns from a registry that lives entirely on the
 * client side. Server pages pass row data + kind; the client component
 * owns all the rendering / sorting closures.
 */

/**
 * Reusable sortable table for the dashboard surfaces.
 *
 * Click a column header to sort asc/desc on that column. Sort state is
 * local-only (per table instance) so the dashboard doesn't need server
 * round-trips. Pass the column definitions as `columns`; each defines a
 * label, a value selector for sort, and a render function for the cell.
 */

export type Column<T> = {
  id: string;
  label: string;
  /** Numeric/string accessor for sort. Return null/undefined for unsortable cells. */
  value: (r: T) => string | number | null | undefined;
  render: (r: T) => ReactNode;
  numeric?: boolean;
  initial?: "asc" | "desc";
};

type Direction = "asc" | "desc" | null;

function compare(a: unknown, b: unknown): number {
  const aNull = a == null || (typeof a === "number" && !Number.isFinite(a));
  const bNull = b == null || (typeof b === "number" && !Number.isFinite(b));
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

export type SortableTableKind = "dealerRecord" | "submission";

export function DealerSortableTable({
  rows,
  kind,
  emptyMessage,
  defaultSortId,
  defaultSortDir = "desc",
  rowHrefPrefix,
}: {
  rows: DealerRecord[];
  kind: SortableTableKind;
  emptyMessage?: string;
  defaultSortId?: string;
  defaultSortDir?: "asc" | "desc";
  rowHrefPrefix?: string;
}) {
  const columns = kind === "submission" ? submissionColumns() : dealerRecordColumns();
  const [sortId, setSortId] = useState<string | null>(defaultSortId ?? null);
  const [sortDir, setSortDir] = useState<Direction>(defaultSortId ? defaultSortDir : null);

  const sortedRows = useMemo(() => {
    if (!sortId || !sortDir) return rows;
    const col = columns.find((c) => c.id === sortId);
    if (!col) return rows;
    const out = [...rows];
    out.sort((a, b) => {
      const result = compare(col.value(a), col.value(b));
      return sortDir === "asc" ? result : -result;
    });
    return out;
  }, [rows, sortId, sortDir, columns]);

  function clickHeader(id: string) {
    if (sortId === id) {
      // toggle asc → desc → null
      setSortDir((prev) => (prev === "asc" ? "desc" : prev === "desc" ? null : "asc"));
      if (sortDir === "desc") {
        setSortId(null);
      }
    } else {
      setSortId(id);
      setSortDir("desc");
    }
  }

  if (rows.length === 0) {
    return (
      <table>
        <tbody>
          <tr>
            <td className="dealer-section-empty" colSpan={columns.length}>
              {emptyMessage ?? "No records."}
            </td>
          </tr>
        </tbody>
      </table>
    );
  }

  return (
    <table>
      <thead>
        <tr>
          {columns.map((c) => {
            const active = sortId === c.id;
            const dirChar = active ? (sortDir === "asc" ? "↑" : sortDir === "desc" ? "↓" : "") : "";
            return (
              <th
                aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                className={`${c.numeric ? "numeric" : ""}${active ? " is-sorted" : ""} dealer-sortable-th`}
                key={c.id}
                onClick={() => clickHeader(c.id)}
              >
                <span>{c.label}</span>
                <em aria-hidden>{dirChar || "↕"}</em>
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {sortedRows.map((r) => (
          <tr key={r.id}>
            {columns.map((c) => (
              <td className={c.numeric ? "numeric" : ""} key={c.id}>
                {rowHrefPrefix && c.id === columns[0]!.id ? (
                  <Link href={`${rowHrefPrefix}${r.id}`}>{c.render(r)}</Link>
                ) : (
                  c.render(r)
                )}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ─── Column definitions (client-only — never serialized over RSC) ────

function dealerRecordColumns(): Column<DealerRecord>[] {
  return [
    {
      id: "cert",
      label: "cert",
      value: (r) => (r.certNumber ? `${r.certProvider ?? "PSA"} ${r.certNumber}` : r.id),
      render: (r) => (r.certNumber ? `${r.certProvider ?? "PSA"} ${r.certNumber}` : r.id.slice(0, 14)),
    },
    {
      id: "card",
      label: "card",
      value: (r) => r.cardIdentity ?? "",
      render: (r) => <span className="muted">{r.cardIdentity ?? "—"}</span>,
    },
    {
      id: "grade",
      label: "grade",
      value: (r) => r.officialGrade ?? "",
      render: (r) => r.officialGrade ?? "—",
    },
    {
      id: "lane",
      label: "lane",
      value: (r) => r.lane,
      render: (r) => <span className="muted">{r.lane}</span>,
    },
    {
      id: "rawHigh",
      label: "raw $",
      value: (r) => r.pricing?.rawHigh ?? null,
      render: (r) => fmtUsd(r.pricing?.rawHigh),
      numeric: true,
    },
    {
      id: "ev",
      label: "EV $",
      value: (r) => r.roi?.expectedGradedEv ?? null,
      render: (r) => fmtUsd(r.roi?.expectedGradedEv),
      numeric: true,
    },
    {
      id: "recommend",
      label: "recommend",
      value: (r) => r.roi?.recommendation ?? "",
      render: (r) =>
        r.roi?.recommendation ? (
          <span
            className={`dealer-pill dealer-pill--${
              r.roi.recommendation === "submit" ? "good" : r.roi.recommendation === "sell_raw" ? "warn" : ""
            }`}
          >
            {r.roi.recommendation}
          </span>
        ) : (
          <span className="muted">—</span>
        ),
    },
  ];
}

function fmtUsd(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

function submissionColumns(): Column<DealerRecord>[] {
  return [
    {
      id: "cert",
      label: "cert",
      value: (r) => (r.certNumber ? `${r.certProvider ?? "PSA"} ${r.certNumber}` : r.id),
      render: (r) => (r.certNumber ? `${r.certProvider ?? "PSA"} ${r.certNumber}` : r.id),
    },
    {
      id: "card",
      label: "card",
      value: (r) => r.cardIdentity ?? "",
      render: (r) => <span className="muted">{r.cardIdentity ?? "—"}</span>,
    },
    {
      id: "stage",
      label: "stage",
      value: (r) => r.submission?.status ?? "",
      render: (r) => <span className="dealer-pill">{r.submission?.status ?? "—"}</span>,
    },
    {
      id: "declared",
      label: "declared",
      value: (r) => r.submission?.declaredValue ?? null,
      render: (r) => fmtUsd(r.submission?.declaredValue),
      numeric: true,
    },
    {
      id: "rawHigh",
      label: "raw $",
      value: (r) => r.pricing?.rawHigh ?? null,
      render: (r) => fmtUsd(r.pricing?.rawHigh),
      numeric: true,
    },
    {
      id: "ev",
      label: "expected EV",
      value: (r) => r.roi?.expectedGradedEv ?? null,
      render: (r) => fmtUsd(r.roi?.expectedGradedEv),
      numeric: true,
    },
    {
      id: "submitted",
      label: "submitted",
      value: (r) => (r.submission?.submittedAt ? Date.parse(r.submission.submittedAt) : null),
      render: (r) => (
        <span className="muted">
          {r.submission?.submittedAt
            ? r.submission.submittedAt.replace("T", " ").replace(/\..*$/, "Z")
            : "—"}
        </span>
      ),
    },
    {
      id: "evidence",
      label: "evidence",
      value: (r) => (r.evidencePacket ? 1 : 0),
      render: (r) => <Link href={`/dealer/records/${r.id}/evidence`}>open ↗</Link>,
    },
  ];
}
