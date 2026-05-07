import Link from "next/link";

const demoCards = [
  ["Open agent workspace", "/workspace"],
  ["Try sample Pokémon card", "/cards/sample-1999-charizard/report"],
  ["Try sample sports card", "/cards/sample-rookie-silver/report"],
  ["Run before/after dispute demo", "/compare"],
  ["Upload my own card", "/scan?mode=upload"],
  ["Import certified refs", "/certs/import"]
];

export default function DemoPage() {
  return (
    <main className="container page-stack">
      <div className="page-kicker">Question-form demo</div>
      <h1 className="page-title">What do you want to try?</h1>
      <p className="lede">
        The local demo uses real seeded reports and clearly marks any model/API dependency that is not available.
      </p>
      <section className="demo-choice-grid">
        {demoCards.map(([label, href]) => (
          <Link className="choice-card" href={href} key={href}>
            <span>{label}</span>
            <small>Open workflow</small>
          </Link>
        ))}
      </section>
    </main>
  );
}
