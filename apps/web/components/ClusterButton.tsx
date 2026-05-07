"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type ClusterPayload = {
  ok: boolean;
  scannedTraces?: number;
  newDrafts?: number;
  clusters?: Array<{ skillId: string; sampleSize: number; isNew: boolean }>;
  error?: string;
};

export function ClusterButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ClusterPayload | null>(null);

  async function run() {
    setBusy(true);
    setResult(null);
    try {
      const response = await fetch("/api/skills/cluster", { method: "POST" });
      setResult((await response.json()) as ClusterPayload);
    } catch (error) {
      setResult({ ok: false, error: error instanceof Error ? error.message : "cluster failed" });
    } finally {
      setBusy(false);
      startTransition(() => router.refresh());
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
      <button className="button secondary" disabled={busy || pending} onClick={run} type="button">
        {busy ? "Clustering…" : "Cluster traces → drafts"}
      </button>
      {result ? (
        <small style={{ color: result.ok ? "rgba(255,255,255,0.78)" : "#ff9c9c", fontSize: 11 }}>
          {result.ok
            ? `Scanned ${result.scannedTraces ?? 0} trace(s) → ${result.newDrafts ?? 0} new draft(s) (${result.clusters?.length ?? 0} cluster(s) total).`
            : `Cluster failed: ${result.error}`}
        </small>
      ) : null}
    </div>
  );
}
