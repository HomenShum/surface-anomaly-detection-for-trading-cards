import Link from "next/link";
import type { VerifiedMethod } from "../lib/community-methods";
import { statusLabel } from "../lib/community-methods";

export function MethodCard({ method, compact = false }: { method: VerifiedMethod; compact?: boolean }) {
  const verified = method.status === "verified" || method.status === "canary" || method.status === "production";

  return (
    <article className={`method-card ${compact ? "method-card--compact" : ""}`}>
      <div className="method-card-head">
        <span className={`method-status method-status--${method.status}`}>{statusLabel(method.status)}</span>
        <code>{method.versionHash}</code>
      </div>
      <h3>
        <Link href={`/methods/${method.slug}`}>{method.title}</Link>
      </h3>
      <p>{method.problem}</p>
      <div className="method-card-metrics">
        <div>
          <span>False positives</span>
          <strong>{verified ? `-${method.benchmark.falsePositiveReductionPct}%` : "pending"}</strong>
        </div>
        <div>
          <span>Precision</span>
          <strong>{verified ? `+${method.benchmark.precisionLiftPct}%` : "pending"}</strong>
        </div>
        <div>
          <span>Latency</span>
          <strong>{method.benchmark.latencyAddedMs ? `+${method.benchmark.latencyAddedMs}ms` : "pending"}</strong>
        </div>
      </div>
      <div className="method-card-foot">
        <Link href={`/contributors/${method.contributorHandle}`}>@{method.contributorHandle}</Link>
        <span suppressHydrationWarning>{new Intl.NumberFormat("en-US").format(method.usedInScans)} scans</span>
      </div>
    </article>
  );
}
