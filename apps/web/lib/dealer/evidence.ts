/**
 * Evidence packet generator.
 *
 * Creates a tamper-evident JSON manifest from a Dealer record. The packet
 * is signed with HMAC-SHA256 using a key derived from
 * `process.env.DEALER_EVIDENCE_SIGNING_KEY` (or a deterministic local
 * fallback for the vendor pilot — clearly NOT for production trust). The
 * signature covers a canonical (sorted) string serialization of the body
 * so any later tamper changes the digest.
 *
 * Body fields are intentionally minimal and audit-friendly:
 *   - cert URL + cert number + provider
 *   - image hash (sha256 of the slab image bytes)
 *   - accepted DING findings with bbox + severity + reviewer note
 *   - reviewer + decision + reviewedAt
 *   - model version + generatedAt
 *
 * The HTML view is a static printable page suitable for embedding in a
 * marketplace listing or sending to a buyer.
 */

import { createHmac } from "node:crypto";
import type { DealerEvidencePacket, DealerRecord } from "./types";

const DEFAULT_KEY = "ccv-vendor-pilot-evidence-v1";

function signingKey(): string {
  return process.env.DEALER_EVIDENCE_SIGNING_KEY ?? DEFAULT_KEY;
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(",")}}`;
}

export type EvidenceBody = {
  packetId: string;
  generatedAt: string;
  recordId: string;
  cert: { provider: string | null; number: string | null; url: string | null; grade: string | null };
  card: { identity: string | null; quantity: number; trustTier: string | null };
  image: { hash: string | null };
  detector: { modelVersion: string | null; totalFindings: number; acceptedFindings: number };
  findings: Array<{
    type: string;
    bbox: [number, number, number, number];
    severity: string;
    confidence: number;
    accepted: boolean;
    addedByHuman: boolean;
    reviewerNote?: string;
  }>;
  review: {
    reviewer: string | null;
    reviewedAt: string | null;
    notes: string | null;
    decision: string | null;
  };
  disclaimer: string;
};

const DISCLAIMER =
  "AI-assisted visible condition report. Not an official grade. Not legal proof. Not authenticity verification. The dealer reviewer accepts the findings above; the buyer should verify against the official cert link before transacting.";

export function buildEvidenceBody(record: DealerRecord): EvidenceBody {
  const findings = record.modelFindings ?? [];
  const accepted = findings.filter((f) => f.acceptedByReview === "accepted");
  const modelVersion =
    findings.map((f) => f.modelVersion).find(Boolean) ?? "ding-detector-v0";
  const packetId = `pkt_${record.id}_${Date.now().toString(36)}`;
  return {
    packetId,
    generatedAt: new Date().toISOString(),
    recordId: record.id,
    cert: {
      provider: record.certProvider ?? null,
      number: record.certNumber ?? null,
      url: record.certUrl ?? null,
      grade: record.officialGrade ?? null,
    },
    card: {
      identity: record.cardIdentity ?? null,
      quantity: record.quantity,
      trustTier: record.trustTier ?? null,
    },
    image: {
      hash: record.imageHash ?? null,
    },
    detector: {
      modelVersion,
      totalFindings: findings.length,
      acceptedFindings: accepted.length,
    },
    findings: findings.map((f) => ({
      type: f.type,
      bbox: f.bbox,
      severity: f.severity,
      confidence: f.confidence,
      accepted: f.acceptedByReview === "accepted",
      addedByHuman: f.modelVersion === "human",
      reviewerNote: f.reviewerNote,
    })),
    review: {
      reviewer: record.humanReview?.reviewer ?? null,
      reviewedAt: record.humanReview?.reviewedAt ?? null,
      notes: record.humanReview?.notes ?? null,
      decision: record.humanReview?.decision ?? null,
    },
    disclaimer: DISCLAIMER,
  };
}

export function signEvidence(body: EvidenceBody): {
  body: EvidenceBody;
  signature: string;
  algorithm: "HMAC-SHA256";
} {
  const canonical = canonicalize(body);
  const signature = createHmac("sha256", signingKey()).update(canonical).digest("hex");
  return { body, signature, algorithm: "HMAC-SHA256" };
}

export function verifyEvidence(payload: { body: EvidenceBody; signature: string }): boolean {
  const expected = createHmac("sha256", signingKey())
    .update(canonicalize(payload.body))
    .digest("hex");
  return expected === payload.signature;
}

export function evidencePacketSummary(record: DealerRecord): DealerEvidencePacket {
  const findings = record.modelFindings ?? [];
  const accepted = findings.filter((f) => f.acceptedByReview === "accepted");
  const body = buildEvidenceBody(record);
  const signed = signEvidence(body);
  return {
    packetId: body.packetId,
    generatedAt: body.generatedAt,
    certUrl: record.certUrl,
    imageHash: record.imageHash,
    modelVersion: body.detector.modelVersion ?? undefined,
    reviewer: record.humanReview?.reviewer,
    detectionsCount: findings.length,
    acceptedDetectionsCount: accepted.length,
    signed: true,
    signature: signed.signature,
    exportedAs: ["json", "html"],
  };
}

export function evidencePacketHtml(record: DealerRecord): string {
  const body = buildEvidenceBody(record);
  const signed = signEvidence(body);
  const fmtBbox = (b: number[]) => `[${b.join(", ")}]`;
  const findingsRows = body.findings
    .map((f) => {
      const tag = f.accepted ? "✓ accepted" : "· pending/rejected";
      return `<tr>
        <td>${f.type.replace(/_/g, " ")}</td>
        <td>${f.severity}</td>
        <td>${(f.confidence * 100).toFixed(0)}%</td>
        <td>${fmtBbox(f.bbox)}</td>
        <td>${f.addedByHuman ? "human" : "model"}</td>
        <td>${tag}</td>
        <td>${f.reviewerNote ? f.reviewerNote.replace(/</g, "&lt;") : ""}</td>
      </tr>`;
    })
    .join("");
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Evidence packet · ${body.packetId}</title>
<style>
  :root{--bg:#fafafa;--ink:#1a1a1a;--muted:#666;--accent:#9a6a00;--card:#fff;--line:#dadcde}
  *{box-sizing:border-box}
  body{background:var(--bg);color:var(--ink);font-family:-apple-system,system-ui,sans-serif;margin:0;padding:32px clamp(16px,4vw,48px);line-height:1.45}
  h1{font-size:22px;margin:0 0 4px}
  h2{font-size:14px;letter-spacing:.08em;margin:24px 0 8px;text-transform:uppercase;color:var(--muted)}
  .kicker{color:var(--accent);font-size:11px;letter-spacing:.18em;text-transform:uppercase}
  .packet{background:var(--card);border:1px solid var(--line);border-radius:12px;margin:0 auto;max-width:780px;padding:24px}
  dl{display:grid;gap:4px 12px;grid-template-columns:max-content 1fr;font-size:12px;margin:0}
  dt{color:var(--muted)}
  dd{margin:0;font-family:ui-monospace,SFMono-Regular,monospace}
  table{border-collapse:collapse;font-size:12px;width:100%;margin-top:8px}
  th,td{border-bottom:1px solid var(--line);padding:7px 10px;text-align:left}
  th{color:var(--muted);font-size:10px;letter-spacing:.08em;text-transform:uppercase}
  .sig{background:#fff8e1;border:1px solid #f5d76a;border-radius:8px;padding:12px;margin-top:16px;font-size:11px}
  .sig code{background:#fff;border:1px solid var(--line);border-radius:4px;font-size:10px;padding:2px 5px;word-break:break-all}
  .disc{color:var(--muted);font-size:11px;margin-top:16px;padding:12px;background:#f3f4f6;border-radius:8px}
  a{color:#1d4ed8}
  @media print{body{padding:0;background:#fff}.packet{border:0;box-shadow:none}}
</style>
</head><body>
<article class="packet">
  <p class="kicker">Card Condition Vault · Vendor Pilot · Evidence Packet</p>
  <h1>${body.cert.provider ?? "Cert"} ${body.cert.number ?? ""} · ${body.cert.grade ?? "ungraded"}</h1>
  <p style="color:var(--muted);font-size:12px;margin:4px 0 16px">Packet ${body.packetId} · generated ${body.generatedAt}</p>

  <h2>Cert</h2>
  <dl>
    <dt>provider</dt><dd>${body.cert.provider ?? "—"}</dd>
    <dt>number</dt><dd>${body.cert.number ?? "—"}</dd>
    <dt>official link</dt><dd>${body.cert.url ? `<a href="${body.cert.url}" target="_blank" rel="noopener noreferrer">${body.cert.url}</a>` : "—"}</dd>
    <dt>official grade</dt><dd>${body.cert.grade ?? "—"}</dd>
  </dl>

  <h2>Card</h2>
  <dl>
    <dt>identity</dt><dd>${body.card.identity ?? "—"}</dd>
    <dt>quantity</dt><dd>${body.card.quantity}</dd>
    <dt>trust tier</dt><dd>${body.card.trustTier ?? "—"}</dd>
  </dl>

  <h2>Image</h2>
  <dl>
    <dt>sha256</dt><dd>${body.image.hash ?? "—"}</dd>
  </dl>

  <h2>Detector</h2>
  <dl>
    <dt>model</dt><dd>${body.detector.modelVersion ?? "—"}</dd>
    <dt>findings</dt><dd>${body.detector.totalFindings} total · ${body.detector.acceptedFindings} accepted by reviewer</dd>
  </dl>

  <h2>Findings</h2>
  <table>
    <thead><tr><th>type</th><th>severity</th><th>conf</th><th>bbox</th><th>source</th><th>review</th><th>note</th></tr></thead>
    <tbody>${findingsRows || `<tr><td colspan="7" style="color:var(--muted);font-style:italic">No findings.</td></tr>`}</tbody>
  </table>

  <h2>Reviewer</h2>
  <dl>
    <dt>reviewer</dt><dd>${body.review.reviewer ?? "—"}</dd>
    <dt>reviewed at</dt><dd>${body.review.reviewedAt ?? "—"}</dd>
    <dt>decision</dt><dd>${body.review.decision ?? "—"}</dd>
    <dt>notes</dt><dd>${(body.review.notes ?? "—").replace(/</g, "&lt;")}</dd>
  </dl>

  <div class="sig">
    <strong>Signature</strong>
    <p style="margin:4px 0 0;font-size:11px">algorithm: ${signed.algorithm}</p>
    <p style="margin:4px 0 0"><code>${signed.signature}</code></p>
  </div>

  <p class="disc">${body.disclaimer}</p>
</article>
</body></html>`;
}
