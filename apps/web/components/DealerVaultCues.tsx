import Link from "next/link";
import type { DealerRecord } from "../lib/dealer/types";
import { loadEventsForRecord, loadSessionsForRecord } from "../lib/dealer/sessions";

function fmtRelative(iso: string | undefined): string {
  if (!iso) return "n/a";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "n/a";
  const diff = Date.now() - t;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

function statusTone(status?: string): string {
  if (status === "failed") return "dealer-vault-event--failed";
  if (status === "warning") return "dealer-vault-event--warning";
  if (status === "running") return "dealer-vault-event--running";
  if (status === "passed") return "dealer-vault-event--passed";
  return "";
}

export function DealerVaultCues({ record }: { record: DealerRecord }) {
  const sessions = loadSessionsForRecord(record.id);
  const events = loadEventsForRecord(record.id).sort((a, b) =>
    a.timestamp.localeCompare(b.timestamp),
  );
  const lastEvent = events[events.length - 1];
  const reportVersion = events.filter((e) => e.type === "report.updated" || e.type === "evidence.saved").length;

  return (
    <section className="dealer-vault-cues" aria-label="Vault cues">
      <header className="dealer-vault-cues-head">
        <div>
          <span className="dealer-vault-cues-kicker">Saved to your vault</span>
          <h2>
            Card record <code>{record.id}</code>
          </h2>
          <p className="dealer-vault-cues-sub">
            This record lives in <code>data/dealer/records.jsonl</code>. You can reopen it later if the card is shipped,
            graded, returned, listed, or sold. Re-running the inspection appends new events to the audit trail;
            existing evidence packets keep their signatures.
          </p>
        </div>
        <div className="dealer-vault-cues-meta">
          <div>
            <span>Last analyzed</span>
            <strong>{fmtRelative(record.updatedAt)}</strong>
          </div>
          <div>
            <span>Report version</span>
            <strong>v{Math.max(1, reportVersion)}</strong>
          </div>
          <div>
            <span>Sessions</span>
            <strong>{sessions.length}</strong>
          </div>
          <div>
            <span>Events</span>
            <strong>{events.length}</strong>
          </div>
          <div>
            <span>Visibility</span>
            <strong>{record.consentFlag === "granted" ? "shared OK" : "private"}</strong>
          </div>
        </div>
      </header>

      <details className="dealer-vault-audit">
        <summary>
          Audit trail <span className="dealer-vault-audit-count">{events.length} event{events.length === 1 ? "" : "s"}</span>
        </summary>
        {events.length === 0 ? (
          <p className="dealer-vault-audit-empty">
            No events yet. Re-run the inspection or generate an evidence packet to populate the audit trail.
          </p>
        ) : (
          <ol className="dealer-vault-audit-list">
            {events.map((e) => (
              <li className={`dealer-vault-event ${statusTone(e.status)}`} key={e.id}>
                <time>{e.timestamp.replace("T", " ").replace(/\..*$/, "Z")}</time>
                <span className="dealer-vault-event-type">{e.type.replace(/\./g, ":")}</span>
                <span className="dealer-vault-event-label">{e.label}</span>
                {e.targetRegion ? <span className="dealer-vault-event-region">{e.targetRegion}</span> : null}
              </li>
            ))}
          </ol>
        )}
      </details>

      <p className="dealer-vault-share">
        Share the read-only report:&nbsp;
        <Link href={`/dealer/records/${record.id}/evidence`} target="_blank">
          /dealer/records/{record.id}/evidence
        </Link>
        {lastEvent ? (
          <>
            &nbsp;|&nbsp;last event <strong>{lastEvent.type}</strong> ({fmtRelative(lastEvent.timestamp)})
          </>
        ) : null}
      </p>
    </section>
  );
}
