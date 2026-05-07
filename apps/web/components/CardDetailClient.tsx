"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { conditionSummary } from "../lib/vault";
import { DingOverlay } from "./DingOverlay";
import { useVault } from "./useVault";

export function CardDetailClient() {
  const params = useParams<{ id: string }>();
  const { items } = useVault();
  const item = items.find((entry) => entry.id === params.id) ?? items[0];

  if (!item) return null;

  return (
    <main className="container page-stack">
      <div className="split-title">
        <div>
          <div className="page-kicker">Card record</div>
          <h1 className="page-title">{item.title}</h1>
          <p className="lede">{conditionSummary(item)}</p>
        </div>
        <div className="actions">
          <Link className="button" href={`/cards/${item.id}/report`}>
            Report
          </Link>
          <Link className="button secondary" href="/compare">
            Compare
          </Link>
        </div>
      </div>

      <section className="grid two">
        <div className="card">
          <DingOverlay detections={item.detections} imageDataUrl={item.imageDataUrl} />
        </div>
        <div className="card page-stack compact">
          <h2>Evidence</h2>
          <dl className="detail-list">
            <div><dt>Scan session</dt><dd>{item.evidence.scanSessionId}</dd></div>
            <div><dt>Model</dt><dd>{item.evidence.model.dingDetector}</dd></div>
            <div><dt>Normalizer</dt><dd>{item.evidence.model.normalizer}</dd></div>
            <div><dt>Report version</dt><dd>{item.corrections.length + 1}</dd></div>
          </dl>
          <h2>DINGS</h2>
          <ul className="finding-list">
            {item.detections.map((detection) => (
              <li key={detection.id}>
                <strong>{detection.type.replaceAll("_", " ")}</strong>
                <span>{detection.zone} - {Math.round(detection.confidence * 100)}%</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </main>
  );
}
