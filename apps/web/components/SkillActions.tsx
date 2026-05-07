"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type Props = {
  skillId: string;
  status: string;
  showClusterButton?: boolean;
};

type BenchmarkResultPayload = {
  ok: boolean;
  record?: {
    summary: {
      passed: boolean;
      latencyAddedMs: number;
      precisionDelta: number;
      officialGradeClaims: number;
      privacyViolations: number;
      agentClaimsWithoutToolEvidence: number;
    };
    fixtures: Array<{ fixtureName: string; passed: boolean; failedStepCount: number }>;
  };
  error?: string;
};

type PromotePayload = {
  ok: boolean;
  reasons?: string[];
  benchmarksFound?: number;
  error?: string;
};

type ClusterPayload = {
  ok: boolean;
  scannedTraces?: number;
  newDrafts?: number;
  clusters?: Array<{ skillId: string; sampleSize: number; isNew: boolean }>;
  error?: string;
};

export function SkillActions({ skillId, status, showClusterButton = false }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [benchmark, setBenchmark] = useState<BenchmarkResultPayload | null>(null);
  const [promotion, setPromotion] = useState<PromotePayload | null>(null);
  const [cluster, setCluster] = useState<ClusterPayload | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  async function callBenchmark() {
    setBusyAction("benchmark");
    setBenchmark(null);
    try {
      const response = await fetch("/api/skills/benchmark", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skillId }),
      });
      const body = (await response.json()) as BenchmarkResultPayload;
      setBenchmark(body);
    } catch (error) {
      setBenchmark({ ok: false, error: error instanceof Error ? error.message : "benchmark failed" });
    } finally {
      setBusyAction(null);
      startTransition(() => router.refresh());
    }
  }

  async function callPromote(target: "staging" | "canary" | "production") {
    if (target === "production") {
      const confirm = window.confirm(
        `Promote ${skillId} to PRODUCTION? This skill will fire for all users matching its trigger. You are explicitly approving this — there is no undo without a manual edit.`,
      );
      if (!confirm) return;
    }
    setBusyAction(`promote-${target}`);
    setPromotion(null);
    try {
      const response = await fetch("/api/skills/promote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skillId, target, humanApproved: target === "production" }),
      });
      const body = (await response.json()) as PromotePayload;
      setPromotion(body);
    } catch (error) {
      setPromotion({ ok: false, error: error instanceof Error ? error.message : "promote failed" });
    } finally {
      setBusyAction(null);
      startTransition(() => router.refresh());
    }
  }

  async function callCluster() {
    setBusyAction("cluster");
    setCluster(null);
    try {
      const response = await fetch("/api/skills/cluster", { method: "POST" });
      const body = (await response.json()) as ClusterPayload;
      setCluster(body);
    } catch (error) {
      setCluster({ ok: false, error: error instanceof Error ? error.message : "cluster failed" });
    } finally {
      setBusyAction(null);
      startTransition(() => router.refresh());
    }
  }

  return (
    <div className="skills-card-actions">
      <div className="skills-card-action-row">
        <button
          className="button secondary"
          disabled={isPending || busyAction === "benchmark"}
          onClick={callBenchmark}
          type="button"
        >
          {busyAction === "benchmark" ? "Running…" : "Run benchmark"}
        </button>
        {status !== "production" ? (
          <>
            <button
              className="button"
              disabled={isPending || !!busyAction}
              onClick={() => void callPromote("staging")}
              type="button"
            >
              {busyAction === "promote-staging" ? "Promoting…" : "→ staging"}
            </button>
            <button
              className="button"
              disabled={isPending || !!busyAction}
              onClick={() => void callPromote("canary")}
              type="button"
            >
              {busyAction === "promote-canary" ? "Promoting…" : "→ canary"}
            </button>
            <button
              className="button warn"
              disabled={isPending || !!busyAction}
              onClick={() => void callPromote("production")}
              type="button"
            >
              {busyAction === "promote-production" ? "Promoting…" : "→ production (human approve)"}
            </button>
          </>
        ) : null}
        {showClusterButton ? (
          <button
            className="button secondary"
            disabled={isPending || busyAction === "cluster"}
            onClick={callCluster}
            type="button"
          >
            {busyAction === "cluster" ? "Clustering…" : "Cluster traces"}
          </button>
        ) : null}
      </div>

      {benchmark ? (
        <div className={`skills-card-result ${benchmark.ok && benchmark.record?.summary.passed ? "ok" : "warn"}`}>
          <strong>Benchmark</strong>
          {benchmark.record ? (
            <>
              <span>
                {benchmark.record.summary.passed ? "PASSED" : "FAILED"} ·{" "}
                {benchmark.record.fixtures.filter((f) => f.passed).length}/{benchmark.record.fixtures.length} fixtures ·{" "}
                avg {benchmark.record.summary.latencyAddedMs}ms
              </span>
              {benchmark.record.summary.officialGradeClaims > 0 ? (
                <span className="warn">⚠ {benchmark.record.summary.officialGradeClaims} forbidden grade claim(s)</span>
              ) : null}
              {benchmark.record.summary.privacyViolations > 0 ? (
                <span className="warn">⚠ {benchmark.record.summary.privacyViolations} privacy violation(s)</span>
              ) : null}
            </>
          ) : (
            <span>error: {benchmark.error}</span>
          )}
        </div>
      ) : null}

      {promotion ? (
        <div className={`skills-card-result ${promotion.ok ? "ok" : "warn"}`}>
          <strong>Promotion</strong>
          <span>{promotion.ok ? "Allowed." : "Blocked."}</span>
          {promotion.reasons && promotion.reasons.length > 0 ? (
            <ul>
              {promotion.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          ) : null}
          {promotion.error ? <span>error: {promotion.error}</span> : null}
        </div>
      ) : null}

      {cluster ? (
        <div className={`skills-card-result ${cluster.ok ? "ok" : "warn"}`}>
          <strong>Clustering</strong>
          <span>
            Scanned {cluster.scannedTraces ?? 0} trace(s) · {cluster.newDrafts ?? 0} new draft(s) ·{" "}
            {cluster.clusters?.length ?? 0} cluster(s) total
          </span>
          {cluster.error ? <span>error: {cluster.error}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
