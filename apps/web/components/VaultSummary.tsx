"use client";

import Link from "next/link";
import { scoreLabel } from "../lib/vault";
import { useVault } from "./useVault";

export function VaultSummary({ mode }: { mode: "demo" | "catalog" | "report" | "compare" | "settings" }) {
  const { items, resetSamples, stats } = useVault();
  const [first, second] = items;

  if (mode === "demo") {
    return (
      <div className="grid three">
        <div className="card">
          <h2>Scan</h2>
          <p className="muted">Frame a collectible, trigger the DING overlay, then correct the result.</p>
          <Link className="button" href="/scan">
            Try scanner
          </Link>
        </div>
        <div className="card">
          <h2>Vault</h2>
          <p className="stat">{stats.total}</p>
          <p className="muted">Sample and saved items persist in localStorage.</p>
        </div>
        <div className="card">
          <h2>Flags</h2>
          <p className="stat">{stats.flagged}</p>
          <p className="muted">Entries with weak surface or edge scores.</p>
        </div>
      </div>
    );
  }

  if (mode === "catalog") {
    return (
      <div className="grid three">
        {items.map((item) => (
          <article className="card" key={item.id}>
            {item.imageDataUrl ? (
              <img className="media-thumb" src={item.imageDataUrl} alt={item.title} />
            ) : null}
            <h2>{item.title}</h2>
            <span className="pill">{item.grade}</span>
            <p className="muted">{item.notes}</p>
            <Score name="Surface" value={item.surfaceScore} />
            <Score name="Centering" value={item.centeringScore} />
            <Score name="Edges" value={item.edgeScore} />
          </article>
        ))}
      </div>
    );
  }

  if (mode === "report") {
    return (
      <div className="grid two">
        <section className="card">
          <h2>Collection Health</h2>
          <p className="stat">{stats.averageSurface}</p>
          <p className="muted">Average surface score across the local vault.</p>
          <Score name="Surface average" value={stats.averageSurface} />
          <Score name="Risk pressure" value={Math.max(0, 100 - stats.flagged * 16)} />
        </section>
        <section className="card">
          <h2>Condition Notes</h2>
          {items.slice(0, 5).map((item) => (
            <p key={item.id}>
              <strong>{item.title}</strong>
              <br />
              <span className="muted">{item.notes}</span>
            </p>
          ))}
        </section>
      </div>
    );
  }

  if (mode === "compare") {
    return (
      <div className="grid two">
        {[first, second].filter(Boolean).map((item) => (
          <section className="card" key={item.id}>
            <h2>{item.title}</h2>
            <span className="pill">
              {item.grade} - {Math.round(item.confidence * 100)}% confidence
            </span>
            <Score name="Surface" value={item.surfaceScore} />
            <Score name="Centering" value={item.centeringScore} />
            <Score name="Edges" value={item.edgeScore} />
            <p className="muted">{scoreLabel(Math.min(item.surfaceScore, item.edgeScore))} watch level</p>
          </section>
        ))}
      </div>
    );
  }

  return (
    <div className="grid two">
      <section className="card">
        <h2>Google OAuth</h2>
        <p className="muted">
          Configure Google sign-in with environment variables and the Auth.js route at
          /api/auth/[...nextauth].
        </p>
        <code>GOOGLE_CLIENT_ID</code>
        <br />
        <code>GOOGLE_CLIENT_SECRET</code>
        <br />
        <code>NEXTAUTH_SECRET</code>
        <br />
        <code>NEXTAUTH_URL</code>
      </section>
      <section className="card">
        <h2>Local Data</h2>
        <p className="muted">{stats.total} items stored on this device.</p>
        <button className="button secondary" onClick={resetSamples} type="button">
          Reset samples
        </button>
      </section>
    </div>
  );
}

function Score({ name, value }: { name: string; value: number }) {
  return (
    <div style={{ marginTop: 12 }}>
      <div className="actions" style={{ justifyContent: "space-between" }}>
        <strong>{name}</strong>
        <span className="muted">{value}</span>
      </div>
      <div className="scorebar">
        <span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
    </div>
  );
}
