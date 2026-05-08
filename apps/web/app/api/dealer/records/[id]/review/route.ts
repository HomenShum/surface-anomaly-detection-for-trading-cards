import { NextResponse } from "next/server";
import { appendEvent, openSession } from "../../../../../../lib/dealer/sessions";
import { loadRecord, upsertRecord } from "../../../../../../lib/dealer/store";
import type { DealerHumanReview, DealerLane } from "../../../../../../lib/dealer/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ReviewBody = {
  reviewer?: string;
  decisions?: Record<number, "accepted" | "rejected" | "pending">;
  addedFinding?: {
    type: string;
    bbox: [number, number, number, number];
    severity?: "minor" | "moderate" | "major" | "uncertain";
    note?: string;
  };
  notes?: string;
  decision?: DealerHumanReview["decision"];
  advanceLane?: DealerLane;
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const record = loadRecord(id);
  if (!record) return NextResponse.json({ error: "not_found" }, { status: 404 });
  let body: ReviewBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const reviewer = body.reviewer ?? record.humanReview?.reviewer ?? "vendor_pilot";
  const findings = [...(record.modelFindings ?? [])];
  if (body.decisions) {
    for (const [idxStr, decision] of Object.entries(body.decisions)) {
      const idx = Number.parseInt(idxStr, 10);
      if (Number.isNaN(idx) || idx < 0 || idx >= findings.length) continue;
      findings[idx] = { ...findings[idx], acceptedByReview: decision };
    }
  }
  const added = body.addedFinding
    ? [
        ...findings,
        {
          type: body.addedFinding.type,
          bbox: body.addedFinding.bbox,
          severity: body.addedFinding.severity ?? "moderate",
          confidence: 1,
          modelVersion: "human",
          imageHash: record.imageHash,
          acceptedByReview: "accepted" as const,
          reviewerNote: body.addedFinding.note,
        },
      ]
    : findings;

  const accepted = added.filter((f) => f.acceptedByReview === "accepted").length;
  const rejected = added.filter((f) => f.acceptedByReview === "rejected").length;
  const review: DealerHumanReview = {
    reviewedAt: new Date().toISOString(),
    reviewer,
    acceptedFindings: accepted,
    rejectedFindings: rejected,
    addedFindings: body.addedFinding
      ? [
          ...((record.humanReview?.addedFindings ?? []) as DealerHumanReview["addedFindings"]),
          added[added.length - 1],
        ]
      : record.humanReview?.addedFindings ?? [],
    notes: body.notes ?? record.humanReview?.notes,
    decision: body.decision ?? record.humanReview?.decision,
  };
  const lane: DealerLane = body.advanceLane ?? (accepted > 0 || rejected > 0 ? "ready" : record.lane);
  const updated = await upsertRecord({
    ...record,
    modelFindings: added,
    humanReview: review,
    lane,
  });

  // Audit trail: each review touch becomes a session event tied to the record.
  const session = openSession({ mode: "slab_scan", recordId: id, notes: `review:${reviewer}` });
  appendEvent({
    sessionId: session.id,
    recordId: id,
    type: "report.updated",
    label: `Review by ${reviewer}: ${accepted} accepted · ${rejected} rejected · decision=${review.decision ?? "—"}`,
    status: "passed",
    payload: { decision: review.decision, acceptedFindings: accepted, rejectedFindings: rejected },
  });
  if (body.addedFinding) {
    appendEvent({
      sessionId: session.id,
      recordId: id,
      type: "tool.completed",
      label: `Human-added DING: ${body.addedFinding.type.replaceAll("_", " ")}`,
      targetRegion: body.addedFinding.type,
      bboxNorm: [body.addedFinding.bbox[0] / 100, body.addedFinding.bbox[1] / 100, body.addedFinding.bbox[2] / 100, body.addedFinding.bbox[3] / 100],
      status: "passed",
    });
  }

  return NextResponse.json({ record: updated, sessionId: session.id });
}
