import Link from "next/link";
import { currentOwnerId, currentOwnerIdentity } from "../lib/dealer/owner";
import { loadAllRecords } from "../lib/dealer/store";

/**
 * Vercel-style permanent left rail for the dealer-OS.
 *
 * - Brand at top with role chip
 * - `Find…` search input with ⌘K hint (visual only for now)
 * - Workflow group: Drop / Vault / Listings / Submissions / Alerts
 * - Reference group: Examples / Benchmarks
 * - Settings group: Settings (gated by ?expert=1 entries)
 * - Footer-pinned account presence + status dot
 *
 * Numeric badges on items needing attention (`Vault ³` = 3 records in
 * human_review lane). Reads vault state on the server so SSR is correct.
 */

type Props = {
  active?: "workbench" | "drop" | "vault" | "listings" | "submissions" | "alerts" | "examples" | "benchmarks" | "settings";
  expert?: boolean;
};

const ICON: Record<string, string> = {
  workbench: "◆",
  drop: "↓",
  vault: "▦",
  listings: "≡",
  submissions: "→",
  alerts: "!",
  examples: "○",
  benchmarks: "▲",
  settings: "⚙",
  search: "⌕",
  account: "●",
  agent: "✦",
};

function counts(ownerId: string) {
  const all = loadAllRecords(ownerId);
  return {
    total: all.length,
    needsReview: all.filter((r) => r.lane === "human_review").length,
    listed: all.filter((r) => Boolean(r.listing)).length,
    submitted: all.filter((r) => Boolean(r.submission)).length,
    alerts: all.filter(
      (r) =>
        r.roi?.dealScore === "high" ||
        r.pricing?.confidence === "low" ||
        r.submission?.status === "returned",
    ).length,
    workbench: all.filter(
      (r) =>
        r.lane === "human_review" ||
        (r.lane === "ready" && !r.humanReview) ||
        r.roi?.recommendation === "submit",
    ).length,
  };
}

function NavItem({
  href,
  label,
  iconKey,
  badge,
  active,
}: {
  href: string;
  label: string;
  iconKey: keyof typeof ICON;
  badge?: number | null;
  active?: boolean;
}) {
  return (
    <Link className={`dealer-sidenav-item${active ? " is-active" : ""}`} href={href}>
      <span aria-hidden className="dealer-sidenav-item-icon">{ICON[iconKey]}</span>
      <span className="dealer-sidenav-item-label">{label}</span>
      {badge && badge > 0 ? <span className="dealer-sidenav-item-badge">{badge}</span> : null}
    </Link>
  );
}

export async function DealerSideNav({ active, expert = false }: Props) {
  const identity = await currentOwnerIdentity();
  const c = counts(identity.ownerId);
  const expertSuffix = expert ? "?expert=1" : "";

  return (
    <aside className="dealer-sidenav" aria-label="Dealer nav">
      <header className="dealer-sidenav-head">
        <Link className="dealer-sidenav-brand" href="/">
          <span className="dealer-sidenav-brand-mark" aria-hidden>CV</span>
          <span className="dealer-sidenav-brand-name">Card Condition Vault</span>
          <span className="dealer-sidenav-brand-role">VENDOR</span>
        </Link>
      </header>

      <button
        aria-label="Open command palette"
        className="dealer-sidenav-search"
        data-command-palette
        type="button"
      >
        <span aria-hidden className="dealer-sidenav-search-icon">{ICON.search}</span>
        <span className="dealer-sidenav-search-input" data-placeholder="true">Find or jump to…</span>
        <span className="dealer-sidenav-search-kbd" aria-hidden>⌘K</span>
      </button>

      <nav className="dealer-sidenav-group" aria-label="Workflow">
        <NavItem href={`/dealer/workbench${expertSuffix}`} iconKey="workbench" label="Workbench" badge={c.workbench || null} active={active === "workbench"} />
        <NavItem href="/dealer" iconKey="drop" label="Drop" active={active === "drop"} />
        <NavItem href={`/dealer/dashboard${expertSuffix}`} iconKey="vault" label="Vault" badge={c.total} active={active === "vault"} />
        <NavItem href={`/dealer/listings${expertSuffix}`} iconKey="listings" label="Listings" badge={c.listed || null} active={active === "listings"} />
        <NavItem href={`/dealer/submissions${expertSuffix}`} iconKey="submissions" label="Submissions" badge={c.submitted || null} active={active === "submissions"} />
        <NavItem href={`/dealer/alerts${expertSuffix}`} iconKey="alerts" label="Alerts" badge={c.alerts || null} active={active === "alerts"} />
      </nav>

      <p className="dealer-sidenav-group-label">Reference</p>
      <nav className="dealer-sidenav-group" aria-label="Reference">
        <NavItem href="/examples" iconKey="examples" label="Examples" active={active === "examples"} />
        <NavItem href="/benchmarks" iconKey="benchmarks" label="Benchmarks" active={active === "benchmarks"} />
      </nav>

      {c.needsReview > 0 ? (
        <Link className="dealer-sidenav-callout" href={`/dealer/workbench${expertSuffix}`}>
          <span className="dealer-sidenav-callout-key">{c.needsReview} needs review</span>
          <span className="dealer-sidenav-callout-hint">open the workbench →</span>
        </Link>
      ) : null}

      <footer className="dealer-sidenav-foot">
        <button className="dealer-sidenav-agent-trigger" data-agent-summon type="button">
          <span aria-hidden className="dealer-sidenav-item-icon">{ICON.agent}</span>
          <span className="dealer-sidenav-item-label">Ask agent</span>
          <span className="dealer-sidenav-item-kbd" aria-hidden>⌘J</span>
        </button>
        <div
          className={`dealer-sidenav-account dealer-sidenav-account--${identity.kind}`}
          title={`Owner namespace: ${identity.ownerId}`}
        >
          <span className="dealer-sidenav-account-dot" aria-hidden />
          <span className="dealer-sidenav-account-id">
            <strong>{identity.label}</strong>
            <small>{identity.kind === "anon" ? `local-only · #${identity.slug}` : identity.email ?? `#${identity.slug}`}</small>
          </span>
          {identity.kind === "anon" ? (
            <Link
              aria-label="Sign in to back up the vault across devices"
              className="dealer-sidenav-account-cta"
              href="/login?callbackUrl=/dealer"
            >
              sign in
            </Link>
          ) : (
            <Link
              aria-label="Sign out"
              className="dealer-sidenav-account-cta"
              href="/api/auth/signout?callbackUrl=/dealer"
            >
              sign out
            </Link>
          )}
        </div>
      </footer>
    </aside>
  );
}
