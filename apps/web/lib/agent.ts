import { createScanDraft, type DingDetection, type VaultItem } from "./vault";
import { inferenceApiBaseUrl } from "./inference-api";

export type AgentMessage = {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  createdAt: string;
  attachmentName?: string;
};

export type AgentAnalyzeResult = {
  item: VaultItem;
  warnings: string[];
  modelVersion: string;
  persisted: "local" | "convex-ready";
};

export function dataUrlToImagePayload(dataUrl: string, filename = "agent-upload.jpg") {
  const [header, payload] = dataUrl.split(",");
  const contentType = header.match(/data:(.*?);base64/)?.[1] ?? "image/jpeg";
  return { image_base64: payload ?? dataUrl, filename, content_type: contentType };
}

export function apiFindingsToDings(
  findings: Array<Record<string, unknown>>,
  width = 640,
  height = 896,
): DingDetection[] {
  return findings.map((finding, index) => {
    const raw = Array.isArray(finding.bbox) ? finding.bbox.map(Number) : [50, 50, 180, 160];
    const [x1, y1, x2, y2] = raw.length === 4 ? raw : [50, 50, 180, 160];
    return {
      id: `agent-det-${Date.now()}-${index}`,
      type: String(finding.kind ?? "unknown_damage"),
      zone: "normalized_card",
      confidence: Math.max(0, Math.min(1, Number(finding.confidence ?? 0.35))),
      severity: Number(finding.confidence ?? 0.35) > 0.72 ? "moderate" : "minor",
      bbox: [
        Math.max(0, Math.min(96, (x1 / width) * 100)),
        Math.max(0, Math.min(96, (y1 / height) * 100)),
        Math.max(4, Math.min(100, (x2 / width) * 100)),
        Math.max(4, Math.min(100, (y2 / height) * 100)),
      ],
      source: "model",
    };
  });
}

function confidenceForAlphaReport(findingCount: number, conditionScore: unknown) {
  if (findingCount === 0) return 0.62;
  const rawScore = Number(conditionScore ?? 68) / 100;
  return Math.max(0.45, Math.min(0.78, rawScore));
}

function benchmarkForAlphaReport(findingCount: number) {
  return findingCount === 0 ? "Needs human review" : "DING review";
}

export async function analyzeUploadInBrowser(dataUrl: string, title = "Agent upload"): Promise<AgentAnalyzeResult> {
  const draft = createScanDraft(dataUrl, title);
  const apiBase = inferenceApiBaseUrl();
  let response: Response;

  try {
    response = await fetch(`${apiBase}/scan/analyze`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": draft.evidence.scanSessionId,
        "X-Scan-Session-Id": draft.evidence.scanSessionId,
      },
      body: JSON.stringify({
      ...dataUrlToImagePayload(dataUrl),
      card_id: draft.id,
      report_id: `${draft.id}-report`,
      scan_session_id: draft.evidence.scanSessionId,
    }),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "network error";
    throw new Error(
      `Inference model service is unavailable at ${apiBase}. Start the FastAPI service or set NEXT_PUBLIC_INFERENCE_API_URL to a reachable HTTPS inference endpoint. No DING detections were generated. (${reason})`,
    );
  }

  if (!response.ok) {
    throw new Error(
      `Inference model service returned HTTP ${response.status}. No DING detections were generated.`,
    );
  }
  const body = await response.json();
  const normalized = body.normalized ?? {};
  const report = body.report ?? {};
  const evidenceManifest = report.evidence_manifest ?? {};
  const evidenceItems = Array.isArray(evidenceManifest.items)
    ? (evidenceManifest.items as Array<Record<string, unknown>>)
    : [];
  const evidenceHashFor = (name: string) => {
    const match = evidenceItems.find((item) => item.name === name);
    return typeof match?.sha256 === "string" ? match.sha256 : undefined;
  };
  const detections = apiFindingsToDings(report.findings ?? [], normalized.width, normalized.height);
  const normalizedDataUrl = normalized.image_base64 ? `data:image/png;base64,${normalized.image_base64}` : dataUrl;

  return {
    item: {
      ...draft,
      title,
      grade: benchmarkForAlphaReport(detections.length),
      confidence: confidenceForAlphaReport(detections.length, report.condition_score),
      notes: String(report.summary ?? draft.notes),
      analysisJobKey: typeof report.analysis_job_key === "string" ? report.analysis_job_key : undefined,
      inputSha256: typeof report.input_sha256 === "string" ? report.input_sha256 : undefined,
      normalizedSha256: typeof report.normalized_sha256 === "string" ? report.normalized_sha256 : normalized.sha256,
      modelVersion: typeof report.model_version === "string" ? report.model_version : undefined,
      imageDataUrl: normalizedDataUrl,
      sourceImageDataUrl: dataUrl,
      detections,
      evidence: {
        ...draft.evidence,
        model: {
          ...draft.evidence.model,
          dingDetector: body.report?.evidence_manifest?.model?.ding_detector ?? "ding-detector-v0",
        },
        files: draft.evidence.files.map((file) => {
          if (file.role === "front_original") {
            return { ...file, sha256: evidenceHashFor("source") ?? file.sha256 };
          }
          if (file.role === "front_normalized") {
            return { ...file, sha256: evidenceHashFor("normalized") ?? normalized.sha256 ?? file.sha256 };
          }
          if (file.role === "report_json") {
            return { ...file, sha256: evidenceManifest.manifest_sha256 ?? file.sha256 };
          }
          return file;
        }),
      },
    },
    warnings: normalized.warnings ?? [],
    modelVersion: body.report?.evidence_manifest?.model?.ding_detector ?? "ding-detector-v0",
    persisted: process.env.NEXT_PUBLIC_CONVEX_URL ? "convex-ready" : "local",
  };
}
