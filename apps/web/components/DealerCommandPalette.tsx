"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

/**
 * Cmd/Ctrl-K command palette.
 *
 * Hot-reload: ⌘K / Ctrl+K opens, Esc dismisses, ↑/↓ navigate, Enter
 * selects. The palette serves three result classes:
 *   1. Records — fuzzy match on cert, card identity, id, lane
 *   2. Surfaces — Drop / Workbench / Vault / Listings / Submissions / Alerts
 *   3. Actions — "ask Pi", "new intake", "open dashboard"
 *
 * Records are loaded from /api/dealer/records (lightweight projection)
 * on first open and cached in-memory until the user closes the palette.
 */

type RecordHit = {
  id: string;
  title: string;
  subtitle: string;
  href: string;
};

type Result =
  | { kind: "record"; record: RecordHit }
  | { kind: "surface"; label: string; href: string; icon: string }
  | { kind: "action"; label: string; onSelect: () => void; icon: string };

const SURFACES: Array<{ label: string; href: string; icon: string }> = [
  { label: "Workbench", href: "/dealer/workbench", icon: "◆" },
  { label: "Drop", href: "/dealer", icon: "↓" },
  { label: "Vault dashboard", href: "/dealer/dashboard", icon: "▦" },
  { label: "Listings queue", href: "/dealer/listings", icon: "≡" },
  { label: "Submissions tracker", href: "/dealer/submissions", icon: "→" },
  { label: "Alerts", href: "/dealer/alerts", icon: "!" },
];

function fuzzy(haystack: string, needle: string): boolean {
  if (!needle) return true;
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  let hi = 0;
  for (let i = 0; i < n.length; i++) {
    const idx = h.indexOf(n[i]!, hi);
    if (idx === -1) return false;
    hi = idx + 1;
  }
  return true;
}

export function DealerCommandPalette() {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [records, setRecords] = useState<RecordHit[] | null>(null);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Global keyboard: ⌘K / Ctrl+K to open, Esc to close.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Click handler on side-nav search field — wire it to open the palette.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const trigger = target?.closest('[data-command-palette]') as HTMLElement | null;
      if (trigger) {
        e.preventDefault();
        setOpen(true);
      }
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  // Load record index once when the palette first opens.
  useEffect(() => {
    if (!open || records !== null) return;
    let cancelled = false;
    setLoading(true);
    fetch("/api/dealer/records?projection=palette")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`records HTTP ${r.status}`))))
      .then((body: { records?: Array<{ id: string; cert?: string; card?: string; lane?: string }> }) => {
        if (cancelled) return;
        const hits: RecordHit[] = (body.records ?? []).map((r) => ({
          id: r.id,
          title: r.card || r.cert || r.id,
          subtitle: [r.cert, r.lane].filter(Boolean).join(" · ") || r.id,
          href: `/dealer/records/${r.id}`,
        }));
        setRecords(hits);
      })
      .catch(() => setRecords([]))
      .finally(() => setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, records]);

  // Focus the input when the palette opens.
  useEffect(() => {
    if (open) {
      // small delay so the dialog mounts before we try to focus.
      const t = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(t);
    }
    setQuery("");
    setSelected(0);
  }, [open]);

  const results = useMemo<Result[]>(() => {
    const q = query.trim();
    const surfaceResults: Result[] = SURFACES.filter((s) => fuzzy(s.label, q)).map((s) => ({
      kind: "surface",
      label: s.label,
      href: s.href,
      icon: s.icon,
    }));
    const recordResults: Result[] = (records ?? [])
      .filter((r) => fuzzy(`${r.title} ${r.subtitle} ${r.id}`, q))
      .slice(0, 12)
      .map((record) => ({ kind: "record", record }));
    // If we're on a record-detail route, surface the per-record actions.
    const recordMatch = pathname?.match(/\/dealer\/records\/([^/]+)/);
    const focusedRecordId = recordMatch?.[1];

    const actionDefs: Array<{ label: string; icon: string; onSelect: () => void }> = [
      {
        label: "Ask Pi (open agent)",
        icon: "✦",
        onSelect: () => {
          setOpen(false);
          const trigger = document.querySelector<HTMLElement>('[data-agent-summon]');
          trigger?.click();
        },
      },
      {
        label: "Open intake (new batch)",
        icon: "+",
        onSelect: () => {
          setOpen(false);
          router.push("/dealer/intake");
        },
      },
      ...(focusedRecordId
        ? [
            {
              label: `Track economics for ${focusedRecordId.slice(-8)}`,
              icon: "📒",
              onSelect: () => {
                setOpen(false);
                // Click the existing per-record summon button so the
                // drawer pre-loads the record's saved cost basis.
                const trigger = document.querySelector<HTMLElement>(
                  `[data-cost-basis-summon][data-record-id="${focusedRecordId}"]`,
                );
                if (trigger) {
                  trigger.click();
                } else {
                  // Synthetic dispatch — the drawer's URL fallback handles it.
                  const fallback = document.createElement("button");
                  fallback.setAttribute("data-cost-basis-summon", "");
                  fallback.setAttribute("data-record-id", focusedRecordId);
                  document.body.appendChild(fallback);
                  fallback.click();
                  document.body.removeChild(fallback);
                }
              },
            },
          ]
        : []),
    ];
    const actions: Result[] = actionDefs
      .filter((a) => fuzzy(a.label, q))
      .map((a) => ({ kind: "action" as const, label: a.label, icon: a.icon, onSelect: a.onSelect }));

    return [...surfaceResults, ...recordResults, ...actions];
  }, [query, records, router]);

  const total = results.length;

  // Clamp selection.
  useEffect(() => {
    if (selected >= total) setSelected(Math.max(0, total - 1));
  }, [selected, total]);

  const select = useCallback(
    (result: Result) => {
      if (result.kind === "record") {
        setOpen(false);
        router.push(result.record.href);
      } else if (result.kind === "surface") {
        setOpen(false);
        router.push(result.href);
      } else {
        result.onSelect();
      }
    },
    [router],
  );

  if (!open) return null;

  return (
    <div
      aria-modal
      className="dealer-cmdk-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
      role="dialog"
    >
      <div className="dealer-cmdk">
        <header>
          <span aria-hidden>⌕</span>
          <input
            aria-label="Command palette search"
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSelected((s) => Math.min(total - 1, s + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSelected((s) => Math.max(0, s - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                const r = results[selected];
                if (r) select(r);
              }
            }}
            placeholder="Find a record, jump to a surface, ask Pi…"
            ref={inputRef}
            type="search"
            value={query}
          />
          <kbd>esc</kbd>
        </header>

        <div className="dealer-cmdk-results" role="listbox">
          {loading && records === null ? (
            <p className="dealer-cmdk-empty">Indexing vault…</p>
          ) : results.length === 0 ? (
            <p className="dealer-cmdk-empty">No matches. Try a cert number or card identity.</p>
          ) : (
            results.map((r, idx) => {
              const isSel = idx === selected;
              const key =
                r.kind === "record" ? `r:${r.record.id}` : r.kind === "surface" ? `s:${r.href}` : `a:${r.label}`;
              return (
                <button
                  aria-selected={isSel}
                  className={`dealer-cmdk-row dealer-cmdk-row--${r.kind}${isSel ? " is-selected" : ""}`}
                  key={key}
                  onClick={() => select(r)}
                  onMouseEnter={() => setSelected(idx)}
                  role="option"
                  type="button"
                >
                  {r.kind === "record" ? (
                    <>
                      <span className="dealer-cmdk-icon" aria-hidden>
                        ◇
                      </span>
                      <span className="dealer-cmdk-text">
                        <strong>{r.record.title}</strong>
                        <small>{r.record.subtitle}</small>
                      </span>
                      <span className="dealer-cmdk-tag">record</span>
                    </>
                  ) : r.kind === "surface" ? (
                    <>
                      <span className="dealer-cmdk-icon" aria-hidden>
                        {r.icon}
                      </span>
                      <span className="dealer-cmdk-text">
                        <strong>{r.label}</strong>
                      </span>
                      <span className="dealer-cmdk-tag">surface</span>
                    </>
                  ) : (
                    <>
                      <span className="dealer-cmdk-icon" aria-hidden>
                        {r.icon}
                      </span>
                      <span className="dealer-cmdk-text">
                        <strong>{r.label}</strong>
                      </span>
                      <span className="dealer-cmdk-tag">action</span>
                    </>
                  )}
                </button>
              );
            })
          )}
        </div>

        <footer className="dealer-cmdk-foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> navigate
          </span>
          <span>
            <kbd>↵</kbd> select
          </span>
          <span>
            <kbd>esc</kbd> dismiss
          </span>
          <span className="dealer-cmdk-foot-count">
            {total} result{total === 1 ? "" : "s"}
          </span>
        </footer>
      </div>
    </div>
  );
}
