"use client";

import Link from "next/link";
import { scoreLabel } from "../lib/vault";
import { useVault } from "./useVault";

export function DashboardClient() {
  const { items, stats, resetSamples } = useVault();
  const recent = items.slice(0, 3);

  return (
    <main className="container page-stack">
      <div className="page-kicker">Local MVP</div>
      <div className="split-title">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="lede">Catalog health, evidence readiness, and demo workflow state.</p>
        </div>
        <div className="actions">
          <Link className="button" href="/scan">
            Add Card
          </Link>
          <button className="button secondary" onClick={resetSamples} type="button">
            Reset Samples
          </button>
        </div>
      </div>

      <section className="grid three">
        <div className="card">
          <p className="metric-label">Cards</p>
          <div className="stat">{stats.total}</div>
        </div>
        <div className="card">
          <p className="metric-label">Avg surface</p>
          <div className="stat">{stats.averageSurface}</div>
        </div>
        <div className="card">
          <p className="metric-label">Review flags</p>
          <div className="stat">{stats.flagged}</div>
        </div>
      </section>

      <section className="card">
        <div className="section-head">
          <h2>Recent catalog records</h2>
          <Link href="/cards">View all</Link>
        </div>
        <div className="table-list">
          {recent.map((item) => (
            <Link className="row-link" href={`/cards/${item.id}`} key={item.id}>
              <span>{item.title}</span>
              <span>{item.grade}</span>
              <span>{scoreLabel(item.surfaceScore)}</span>
              <span>{item.evidence.files.length} evidence files</span>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
