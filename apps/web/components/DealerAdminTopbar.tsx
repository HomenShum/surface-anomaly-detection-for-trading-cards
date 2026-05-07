import Link from "next/link";
import { AlphaBadge } from "./AlphaBadge";
import { InferenceHealthPill } from "./InferenceHealthPill";

type Props = {
  expert?: boolean;
};

export function DealerAdminTopbar({ expert = false }: Props) {
  return (
    <header className="methods-topbar">
      <Link className="brand report-brand" href="/">
        <span className="brand-mark">CV</span>
        <span>Card Condition Vault</span>
      </Link>
      <nav className="methods-nav" aria-label="Dealer nav">
        <Link href="/dealer">Back to drop</Link>
        {expert ? (
          <>
            <Link href="/dealer/intake?expert=1">Intake</Link>
            <Link href="/dealer/dashboard?expert=1">Dashboard</Link>
            <Link href="/dealer/listings?expert=1">Listings</Link>
            <Link href="/dealer/submissions?expert=1">Submissions</Link>
            <Link href="/dealer/alerts?expert=1">Alerts</Link>
            <Link href="/examples">Examples</Link>
            <Link href="/benchmarks">Benchmarks</Link>
          </>
        ) : null}
      </nav>
      <div className="methods-top-actions">
        <AlphaBadge />
        <InferenceHealthPill />
      </div>
    </header>
  );
}
