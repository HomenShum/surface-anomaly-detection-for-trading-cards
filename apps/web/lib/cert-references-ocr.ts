import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { certReferenceDir, extractCertCandidates, repoRoot, type CertReferenceCandidate } from "./cert-references";

export type OcrAdapterId = "inference-api" | "tesseract" | "gcv" | "textract" | "none";

export type OcrExtractInput = {
  filename: string;
  base64?: string;
  mimeType?: string;
  providerHint?: CertReferenceCandidate["provider"];
};

export type OcrExtractResult = {
  ocrAdapterId: OcrAdapterId;
  ocrAdapterConfigured: boolean;
  candidates: CertReferenceCandidate[];
  ocrNotes: string[];
};

function probeTesseract() {
  const command = process.env.TESSERACT_CMD ?? "tesseract";
  const result = spawnSync(command, ["--version"], {
    encoding: "utf-8",
    timeout: 2500,
    windowsHide: true,
  });
  return !result.error && result.status === 0;
}

export function getOcrAdapterId(): OcrAdapterId {
  const env = (process.env.OCR_ADAPTER ?? "").toLowerCase().trim();
  if (env === "inference-api") return "inference-api";
  if (env === "gcv" || env === "textract") return env;
  if (env === "tesseract") return "tesseract";
  // No explicit override: prefer inference-api when its URL is set, then fall
  // back to local Tesseract CLI auto-detect, then nothing.
  if (env === "" && (process.env.INFERENCE_API_URL || process.env.NEXT_PUBLIC_INFERENCE_API_URL)) return "inference-api";
  if (probeTesseract()) return "tesseract";
  return "none";
}

async function runInferenceApiAdapter(input: OcrExtractInput): Promise<{
  candidates: CertReferenceCandidate[];
  notes: string[];
  configured: boolean;
}> {
  const base = (process.env.INFERENCE_API_URL ?? process.env.NEXT_PUBLIC_INFERENCE_API_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");
  const notes: string[] = [];
  if (!input.base64) {
    notes.push("Inference-API label detector selected, but no image bytes provided. Filename-only candidates.");
    return { candidates: extractCertCandidates([input.filename]), notes, configured: false };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await fetch(`${base}/certs/detect-labels`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        image_base64: input.base64,
        filename: input.filename,
        content_type: input.mimeType,
        run_ocr: true,
        include_thumbnails: false,
      }),
      cache: "no-store",
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      notes.push(`Inference-API label detector returned ${response.status}: ${text.slice(0, 160)}`);
      return { candidates: extractCertCandidates([input.filename]), notes, configured: false };
    }
    const data = (await response.json()) as {
      labels?: Array<{ candidate_certs?: string[]; ocr_text?: string }>;
      unique_certs?: string[];
      ocr_run?: boolean;
    };
    const ocrTexts = (data.labels ?? []).map((l) => l.ocr_text ?? "").filter(Boolean);
    const merged = extractCertCandidates([...ocrTexts, input.filename, ...(data.unique_certs ?? [])]);
    notes.push(
      `Inference-API label detector ran on the image: ${data.labels?.length ?? 0} label region(s) detected, ${data.unique_certs?.length ?? 0} unique cert candidate(s).`,
    );
    return { candidates: merged, notes, configured: true };
  } catch (error) {
    notes.push(
      `Inference-API label detector unreachable: ${error instanceof Error ? error.message : "unknown error"}.`,
    );
    return { candidates: extractCertCandidates([input.filename]), notes, configured: false };
  } finally {
    clearTimeout(timeout);
  }
}

function mimeToExt(mimeType = "") {
  const lower = mimeType.toLowerCase();
  if (lower.includes("jpeg") || lower.includes("jpg")) return "jpg";
  if (lower.includes("webp")) return "webp";
  if (lower.includes("tif")) return "tif";
  return "png";
}

function runBatchLabelOcr(imagePath: string) {
  const notes: string[] = [];
  const scriptPath = join(repoRoot(), "scripts", "certs", "psa_label_ocr.py");
  if (!existsSync(scriptPath)) return { text: "", notes: ["Batch label OCR helper not found."], configured: false };
  const result = spawnSync("python", [scriptPath, imagePath, "--json"], {
    encoding: "utf-8",
    timeout: 30_000,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  if (result.error) {
    notes.push(`Batch label OCR failed: ${result.error.message}`);
    return { text: "", notes, configured: false };
  }
  if (result.status !== 0) {
    notes.push(`Batch label OCR exited ${result.status}: ${String(result.stderr ?? "").trim()}`);
    return { text: "", notes, configured: false };
  }
  try {
    const payload = JSON.parse(String(result.stdout ?? "{}")) as { text?: string; label_crop_count?: number };
    notes.push(`Batch label OCR scanned ${payload.label_crop_count ?? 0} label-like crop(s).`);
    return { text: payload.text ?? "", notes, configured: true };
  } catch {
    notes.push("Batch label OCR returned non-JSON output.");
    return { text: "", notes, configured: false };
  }
}

function runTesseract(input: OcrExtractInput) {
  const notes: string[] = [];
  if (!input.base64) {
    notes.push("Tesseract OCR available, but image bytes were not included. Filename-derived candidates only.");
    return { text: "", notes, configured: false };
  }

  const approxBytes = Math.floor((input.base64.length * 3) / 4);
  if (approxBytes > 8 * 1024 * 1024) {
    notes.push("Image skipped by OCR size limit (>8MB). Filename-derived candidates only.");
    return { text: "", notes, configured: false };
  }

  const tmpDir = join(certReferenceDir(), ".tmp-ocr");
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
  const hash = createHash("sha256").update(`${input.filename}:${input.base64.slice(0, 4096)}`).digest("hex").slice(0, 12);
  const imagePath = join(tmpDir, `${hash}.${mimeToExt(input.mimeType)}`);
  writeFileSync(imagePath, Buffer.from(input.base64, "base64"));

  try {
    const textParts: string[] = [];
    let configured = false;
    const command = process.env.TESSERACT_CMD ?? "tesseract";
    const result = spawnSync(command, [imagePath, "stdout", "--psm", "6"], {
      encoding: "utf-8",
      timeout: 20_000,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });
    if (result.error) {
      notes.push(`Tesseract OCR failed: ${result.error.message}`);
    } else if (result.status !== 0) {
      notes.push(`Tesseract OCR exited ${result.status}: ${String(result.stderr ?? "").trim()}`);
    } else {
      const text = String(result.stdout ?? "").trim();
      if (text) textParts.push(text);
      else notes.push("Tesseract OCR returned no text from full image.");
      configured = true;
    }

    const batch = runBatchLabelOcr(imagePath);
    textParts.push(batch.text);
    notes.push(...batch.notes);
    configured = configured || batch.configured;
    return { text: textParts.filter(Boolean).join("\n"), notes, configured };
  } finally {
    rmSync(imagePath, { force: true });
  }
}

export async function extractCertCandidatesFromImage(input: OcrExtractInput): Promise<OcrExtractResult> {
  const adapterId = getOcrAdapterId();
  const filenameCandidates = extractCertCandidates([input.filename]);
  const ocrNotes: string[] = [];

  if (adapterId === "none") {
    ocrNotes.push("OCR adapter not configured and Tesseract CLI was not found. Filename-derived candidates only.");
    if (filenameCandidates.length === 0) {
      ocrNotes.push("Filename did not contain a recognizable cert number. Paste the cert URL/number or rename the file.");
    }
    return {
      ocrAdapterId: "none",
      ocrAdapterConfigured: false,
      candidates: filenameCandidates,
      ocrNotes,
    };
  }

  if (adapterId === "inference-api") {
    const apiResult = await runInferenceApiAdapter(input);
    ocrNotes.push(...apiResult.notes);
    if (apiResult.configured) {
      return {
        ocrAdapterId: "inference-api",
        ocrAdapterConfigured: true,
        candidates: apiResult.candidates,
        ocrNotes,
      };
    }
    // Fall back to Tesseract when inference API is unreachable.
    if (probeTesseract()) {
      ocrNotes.push("Falling back to local Tesseract OCR.");
      const result = runTesseract(input);
      const merged = extractCertCandidates([result.text, input.filename]);
      ocrNotes.push(...result.notes);
      return {
        ocrAdapterId: "tesseract",
        ocrAdapterConfigured: result.configured,
        candidates: merged,
        ocrNotes,
      };
    }
    return {
      ocrAdapterId: "inference-api",
      ocrAdapterConfigured: false,
      candidates: apiResult.candidates,
      ocrNotes,
    };
  }

  if (adapterId === "tesseract") {
    const result = runTesseract(input);
    const merged = extractCertCandidates([result.text, input.filename]);
    ocrNotes.push(...result.notes);
    ocrNotes.push(`Tesseract OCR processed image; extracted ${merged.length} cert candidate(s) from text + filename.`);
    return {
      ocrAdapterId: "tesseract",
      ocrAdapterConfigured: result.configured,
      candidates: merged,
      ocrNotes,
    };
  }

  ocrNotes.push(
    `${adapterId} adapter selected, but this local MVP only wires the Tesseract CLI adapter. Filename-derived candidates only.`,
  );
  return {
    ocrAdapterId: adapterId,
    ocrAdapterConfigured: false,
    candidates: filenameCandidates,
    ocrNotes,
  };
}

export async function extractFromCertImportFiles(
  files: Array<{ name: string; text?: string; base64?: string; mimeType?: string }>,
): Promise<{ candidates: CertReferenceCandidate[]; notes: string[]; adapterId: OcrAdapterId }> {
  const adapterId = getOcrAdapterId();
  const candidates: CertReferenceCandidate[] = [];
  const notes: string[] = [];

  for (const file of files.slice(0, 24)) {
    const isImage =
      (file.mimeType ?? "").toLowerCase().startsWith("image/") ||
      /\.(png|jpe?g|webp|heic|tif|tiff)$/i.test(file.name);
    if (!isImage) continue;

    const result = await extractCertCandidatesFromImage({
      filename: file.name,
      base64: file.base64,
      mimeType: file.mimeType,
    });
    for (const candidate of result.candidates) candidates.push(candidate);
    for (const note of result.ocrNotes) notes.push(`${file.name}: ${note}`);
  }
  return { candidates, notes, adapterId };
}
