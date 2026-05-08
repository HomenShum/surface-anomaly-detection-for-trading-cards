"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { DealerRecord } from "../lib/dealer/types";
import { DealerListingCards } from "./DealerListingCards";

/**
 * Client wrapper that renders a TCGplayer-style filter rail next to the
 * card grid. Filters narrow the records by:
 *  - cert provider (PSA / BGS / CGC / RAW)
 *  - grade band (gem 9.5+ / mint 9 / nm-mt 8 / sub-8 / raw)
 *  - price band ($0-50 / $50-100 / $100-250 / $250-500 / $500+)
 *  - lane (ready / image_attached / human_review / listed)
 *  - sort (recent / price desc / price asc / EV desc)
 *
 * Filters are pure client-side over the records array passed in by the
 * server page — no extra fetch.
 */

type SortKey = "recent" | "priceDesc" | "priceAsc" | "evDesc";

const PROVIDERS: Array<{ id: string; label: string; predicate: (r: DealerRecord) => boolean }> = [
  { id: "all", label: "All providers", predicate: () => true },
  { id: "psa", label: "PSA", predicate: (r) => r.certProvider === "PSA" },
  { id: "bgs", label: "BGS", predicate: (r) => r.certProvider === "BGS" },
  { id: "cgc", label: "CGC", predicate: (r) => r.certProvider === "CGC" },
  { id: "raw", label: "Raw / no cert", predicate: (r) => !r.certProvider },
  { id: "tag", label: "TAG", predicate: (r) => r.certProvider === "TAG" },
];

const GRADE_BANDS: Array<{ id: string; label: string; predicate: (r: DealerRecord) => boolean }> = [
  { id: "all", label: "All grades", predicate: () => true },
  {
    id: "gem",
    label: "GEM MT 10 / 9.5",
    predicate: (r) => /GEM\s*MT\s*10|^10$|9\.5/i.test(r.officialGrade ?? ""),
  },
  { id: "mint", label: "MINT 9", predicate: (r) => /MINT\s*9|^9$/i.test(r.officialGrade ?? "") },
  { id: "nm", label: "NM-MT 8", predicate: (r) => /NM-MT\s*8|^8$/i.test(r.officialGrade ?? "") },
  { id: "sub8", label: "Below 8", predicate: (r) => /^[1-7]/.test(r.officialGrade ?? "") },
  { id: "raw", label: "No grade", predicate: (r) => !r.officialGrade },
];

const PRICE_BANDS: Array<{ id: string; label: string; predicate: (r: DealerRecord) => boolean }> = [
  { id: "all", label: "All prices", predicate: () => true },
  { id: "0-50", label: "$0 — $50", predicate: (r) => (r.pricing?.rawHigh ?? 0) < 50 },
  {
    id: "50-100",
    label: "$50 — $100",
    predicate: (r) => (r.pricing?.rawHigh ?? 0) >= 50 && (r.pricing?.rawHigh ?? 0) < 100,
  },
  {
    id: "100-250",
    label: "$100 — $250",
    predicate: (r) => (r.pricing?.rawHigh ?? 0) >= 100 && (r.pricing?.rawHigh ?? 0) < 250,
  },
  {
    id: "250-500",
    label: "$250 — $500",
    predicate: (r) => (r.pricing?.rawHigh ?? 0) >= 250 && (r.pricing?.rawHigh ?? 0) < 500,
  },
  { id: "500+", label: "$500+", predicate: (r) => (r.pricing?.rawHigh ?? 0) >= 500 },
];

const LANE_OPTIONS: Array<{ id: string; label: string }> = [
  { id: "all", label: "All lanes" },
  { id: "ready", label: "Ready" },
  { id: "image_attached", label: "Image attached" },
  { id: "human_review", label: "Human review" },
  { id: "listed", label: "Listed" },
];

const SORTS: Array<{ id: SortKey; label: string }> = [
  { id: "recent", label: "Most recent" },
  { id: "priceDesc", label: "Price ↓" },
  { id: "priceAsc", label: "Price ↑" },
  { id: "evDesc", label: "Expected EV ↓" },
];

export function DealerListingFilters({
  drafted: draftedAll,
  ready: readyAll,
}: {
  drafted: DealerRecord[];
  ready: DealerRecord[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Hydrate from URL on first render so shareable filter URLs work
  // (?provider=psa&grade=mint&price=100-250&lane=ready&sort=priceDesc&q=pikachu).
  // Subsequent state changes write back via router.replace without scroll.
  const [provider, setProvider] = useState(() => searchParams?.get("provider") ?? "all");
  const [grade, setGrade] = useState(() => searchParams?.get("grade") ?? "all");
  const [price, setPrice] = useState(() => searchParams?.get("price") ?? "all");
  const [lane, setLane] = useState(() => searchParams?.get("lane") ?? "all");
  const [sort, setSort] = useState<SortKey>(
    () => (searchParams?.get("sort") as SortKey) || "recent",
  );
  const [search, setSearch] = useState(() => searchParams?.get("q") ?? "");

  const writeUrl = useCallback(
    (next: { provider: string; grade: string; price: string; lane: string; sort: SortKey; search: string }) => {
      const params = new URLSearchParams();
      if (next.provider !== "all") params.set("provider", next.provider);
      if (next.grade !== "all") params.set("grade", next.grade);
      if (next.price !== "all") params.set("price", next.price);
      if (next.lane !== "all") params.set("lane", next.lane);
      if (next.sort !== "recent") params.set("sort", next.sort);
      if (next.search.trim().length > 0) params.set("q", next.search.trim());
      const expert = searchParams?.get("expert");
      if (expert) params.set("expert", expert);
      const qs = params.toString();
      const href = qs.length > 0 ? `${pathname}?${qs}` : pathname;
      router.replace(href, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  useEffect(() => {
    writeUrl({ provider, grade, price, lane, sort, search });
  }, [provider, grade, price, lane, sort, search, writeUrl]);

  const apply = useMemo(() => {
    const providerPred = PROVIDERS.find((p) => p.id === provider)?.predicate ?? (() => true);
    const gradePred = GRADE_BANDS.find((p) => p.id === grade)?.predicate ?? (() => true);
    const pricePred = PRICE_BANDS.find((p) => p.id === price)?.predicate ?? (() => true);
    const lanePred =
      lane === "all" ? () => true : (r: DealerRecord) => r.lane === lane;
    const searchTerm = search.trim().toLowerCase();
    const searchPred =
      searchTerm.length === 0
        ? () => true
        : (r: DealerRecord) =>
            (r.cardIdentity ?? "").toLowerCase().includes(searchTerm) ||
            (r.certNumber ?? "").toLowerCase().includes(searchTerm) ||
            r.id.toLowerCase().includes(searchTerm);

    const filterAndSort = (rows: DealerRecord[]) => {
      const filtered = rows.filter(
        (r) =>
          providerPred(r) && gradePred(r) && pricePred(r) && lanePred(r) && searchPred(r),
      );
      const sorted = [...filtered];
      if (sort === "priceDesc") {
        sorted.sort((a, b) => (b.pricing?.rawHigh ?? 0) - (a.pricing?.rawHigh ?? 0));
      } else if (sort === "priceAsc") {
        sorted.sort((a, b) => (a.pricing?.rawHigh ?? Infinity) - (b.pricing?.rawHigh ?? Infinity));
      } else if (sort === "evDesc") {
        sorted.sort((a, b) => (b.roi?.expectedGradedEv ?? 0) - (a.roi?.expectedGradedEv ?? 0));
      } else {
        sorted.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
      }
      return sorted;
    };

    return {
      drafted: filterAndSort(draftedAll),
      ready: filterAndSort(readyAll),
    };
  }, [draftedAll, readyAll, provider, grade, price, lane, sort, search]);

  const totalRows = apply.drafted.length + apply.ready.length;
  const initialRows = draftedAll.length + readyAll.length;
  const filtersActive =
    provider !== "all" || grade !== "all" || price !== "all" || lane !== "all" || search.length > 0;

  return (
    <div className="dealer-listing-filterboard">
      <aside className="dealer-listing-filterrail" aria-label="Listing filters">
        <header>
          <span className="dealer-listing-filterrail-kicker">Filter</span>
          {filtersActive ? (
            <button
              className="dealer-listing-filterrail-clear"
              onClick={() => {
                setProvider("all");
                setGrade("all");
                setPrice("all");
                setLane("all");
                setSearch("");
              }}
              type="button"
            >
              clear
            </button>
          ) : null}
        </header>

        <label className="dealer-listing-filterrail-search">
          <span aria-hidden>⌕</span>
          <input
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search cert, card, id…"
            type="search"
            value={search}
          />
        </label>

        <FilterGroup label="Provider">
          {PROVIDERS.map((p) => (
            <FilterChip
              active={provider === p.id}
              key={p.id}
              label={p.label}
              onClick={() => setProvider(p.id)}
            />
          ))}
        </FilterGroup>

        <FilterGroup label="Grade">
          {GRADE_BANDS.map((p) => (
            <FilterChip
              active={grade === p.id}
              key={p.id}
              label={p.label}
              onClick={() => setGrade(p.id)}
            />
          ))}
        </FilterGroup>

        <FilterGroup label="Price">
          {PRICE_BANDS.map((p) => (
            <FilterChip
              active={price === p.id}
              key={p.id}
              label={p.label}
              onClick={() => setPrice(p.id)}
            />
          ))}
        </FilterGroup>

        <FilterGroup label="Lane">
          {LANE_OPTIONS.map((p) => (
            <FilterChip
              active={lane === p.id}
              key={p.id}
              label={p.label}
              onClick={() => setLane(p.id)}
            />
          ))}
        </FilterGroup>

        <FilterGroup label="Sort">
          {SORTS.map((s) => (
            <FilterChip
              active={sort === s.id}
              key={s.id}
              label={s.label}
              onClick={() => setSort(s.id)}
            />
          ))}
        </FilterGroup>

        <p className="dealer-listing-filterrail-count">
          {totalRows} of {initialRows} records
        </p>
      </aside>

      <section className="dealer-listing-filterboard-body">
        <div className="dealer-listing-filter-toolbar">
          <span className="dealer-listing-filter-toolbar-counts">
            <strong>{apply.drafted.length}</strong> draft{apply.drafted.length === 1 ? "" : "s"}
            <span aria-hidden>·</span>
            <strong>{apply.ready.length}</strong> ready
          </span>
          <Link className="dealer-listing-filter-toolbar-link" href="/dealer/intake?expert=1">
            new intake →
          </Link>
        </div>
        <DealerListingCards drafted={apply.drafted} ready={apply.ready} />
      </section>
    </div>
  );
}

function FilterGroup({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div className="dealer-listing-filtergroup">
      <span className="dealer-listing-filtergroup-label">{label}</span>
      <div className="dealer-listing-filtergroup-chips">{children}</div>
    </div>
  );
}

function FilterChip({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`dealer-listing-filterchip${active ? " is-active" : ""}`}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}
