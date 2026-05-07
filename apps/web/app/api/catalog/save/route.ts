import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { createHash } from "node:crypto";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions, ownerIdFromSession } from "../../../../lib/auth";

const upsertFromAnalysis = makeFunctionReference<"mutation", Record<string, unknown>, unknown>("cards:upsertFromAnalysis");

function getConvexClient() {
  const url = process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) return null;
  return new ConvexHttpClient(url);
}

async function resolveOwnerId() {
  try {
    const session = await getServerSession(authOptions);
    return ownerIdFromSession(session);
  } catch {
    return process.env.DEMO_USER_ID ?? "local-demo";
  }
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function evidenceFileSha(item: Record<string, unknown>, role: string) {
  const files = (item.evidence as { files?: Array<{ role?: string; sha256?: string }> } | undefined)?.files;
  return files?.find((file) => file.role === role)?.sha256;
}

export async function POST(request: Request) {
  const item = await request.json();
  const client = getConvexClient();
  const ownerId = await resolveOwnerId();
  const evidence = item.evidence as
    | {
        scanSessionId?: string;
        files?: Array<{ role?: string; sha256?: string }>;
        model?: { dingDetector?: string };
      }
    | undefined;
  const inputSha256 = String(item.inputSha256 ?? evidenceFileSha(item, "front_original") ?? "unavailable");
  const modelVersion = String(item.modelVersion ?? evidence?.model?.dingDetector ?? "ding-detector-v0");
  const scanSessionId = String(evidence?.scanSessionId ?? item.id ?? "scan");
  const analysisJobKey = String(
    item.analysisJobKey ?? sha256(`${scanSessionId}:${inputSha256}:${modelVersion}`),
  );
  if (!client) {
    return NextResponse.json({
      persisted: "local",
      reason: "CONVEX_URL not configured",
      analysisJobKey,
    });
  }

  try {
    const result = await client.mutation(upsertFromAnalysis, {
      ownerId,
      title: String(item.title ?? "Agent upload"),
      game: String(item.game ?? "unknown"),
      setName: String(item.setName ?? "Unknown set"),
      variant: String(item.variant ?? "Unknown"),
      conditionBenchmark: String(item.grade ?? "Review"),
      confidence: Number(item.confidence ?? 0.5),
      notes: String(item.notes ?? "AI-assisted condition review."),
      imageDataUrl: item.imageDataUrl,
      scanSessionId,
      inputSha256,
      modelVersion,
      analysisJobKey,
      qualityWarnings: Array.isArray(item.qualityWarnings) ? item.qualityWarnings.map(String) : [],
      detections: Array.isArray(item.detections)
        ? item.detections.map((detection: Record<string, unknown>) => ({
            type: String(detection.type ?? "unknown_damage"),
            zone: String(detection.zone ?? "normalized_card"),
            confidence: Number(detection.confidence ?? 0.35),
            severity: String(detection.severity ?? "minor"),
            bbox: Array.isArray(detection.bbox) ? detection.bbox.map(Number) : [0, 0, 1, 1],
            source: String(detection.source ?? "model"),
          }))
        : [],
      evidenceManifestJson: JSON.stringify(item.evidence ?? {}),
      manifestSha256: String(evidenceFileSha(item, "report_json") ?? evidenceFileSha(item, "front_original") ?? "unavailable"),
    });
    return NextResponse.json({ persisted: "convex", result });
  } catch (error) {
    return NextResponse.json(
      {
        persisted: "local",
        reason: error instanceof Error ? error.message : "Convex mutation failed",
        analysisJobKey,
      },
      { status: 200 },
    );
  }
}
