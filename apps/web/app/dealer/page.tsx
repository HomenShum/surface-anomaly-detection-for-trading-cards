import Link from "next/link";
import { AlphaBadge } from "../../components/AlphaBadge";
import { DealerDecisionFlow } from "../../components/DealerDecisionFlow";
import { InferenceHealthPill } from "../../components/InferenceHealthPill";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Dealer - Drop card photo. Get decision. Save proof.",
  description:
    "Single-screen vendor pilot entrypoint: drop a card photo, stream the inspection, get one decision, and save a signed proof packet.",
};

type Props = {
  searchParams?: Promise<{ expert?: string }>;
};

export default async function DealerHomePage({ searchParams }: Props) {
  const params = (await searchParams) ?? {};
  const expert = params.expert === "1";
  return (
    <main className="dealer-shell dealer-hero-shell">
      <header className="dealer-hero-topbar">
        <Link className="brand" href="/">
          <span className="brand-mark">CV</span>
          <span>Card Condition Vault</span>
        </Link>
        <div className="dealer-hero-actions">
          <AlphaBadge />
          <InferenceHealthPill />
          {expert ? (
            <nav className="dealer-hero-expert" aria-label="Expert nav">
              <Link href="/dealer/intake?expert=1">Intake lanes</Link>
              <Link href="/dealer/dashboard?expert=1">Dashboard</Link>
              <Link href="/dealer/listings?expert=1">Listings</Link>
              <Link href="/dealer/submissions?expert=1">Submissions</Link>
              <Link href="/dealer/alerts?expert=1">Alerts</Link>
            </nav>
          ) : null}
        </div>
      </header>

      <DealerDecisionFlow />
    </main>
  );
}
