import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { NextResponse } from "next/server";
import { loadAllCertifiedReferences, repoRoot } from "../../../../../lib/cert-references";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SlabView = "front" | "back" | "label" | "other";

const ALLOWED_VIEWS = new Set<SlabView>(["front", "back", "label", "other"]);
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 8 * 1024 * 1024;

function cleanCertId(value: unknown) {
  const certId = String(value ?? "").trim().toLowerCase();
  return /^[a-z0-9_]+$/.test(certId) ? certId : null;
}

function cleanView(value: unknown): SlabView {
  const view = String(value ?? "front").trim().toLowerCase() as SlabView;
  return ALLOWED_VIEWS.has(view) ? view : "other";
}

function extFromMime(mime: string, filename?: string) {
  const byName = extname(filename ?? "").toLowerCase();
  if ([".jpg", ".jpeg", ".png", ".webp"].includes(byName)) return byName === ".jpeg" ? "jpg" : byName.slice(1);
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/webp") return "webp";
  return "png";
}

function parseDataUrl(dataUrl: string) {
  const match = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl);
  if (!match) return null;
  const mime = match[1].toLowerCase();
  if (!ALLOWED_MIME.has(mime)) return null;
  const buffer = Buffer.from(match[2], "base64");
  return { mime, buffer };
}

async function parseUpload(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return { error: "file is required." };
    const buffer = Buffer.from(await file.arrayBuffer());
    return {
      certId: form.get("certId"),
      view: form.get("view"),
      consentToStore: form.get("consentToStore"),
      userProvided: form.get("userProvided"),
      originalFilename: file.name,
      mime: file.type,
      buffer,
      sourceNote: String(form.get("sourceNote") ?? ""),
    };
  }

  const body = (await request.json().catch(() => null)) as
    | {
        certId?: string;
        view?: string;
        consentToStore?: boolean;
        userProvided?: boolean;
        filename?: string;
        dataUrl?: string;
        sourceNote?: string;
      }
    | null;
  if (!body) return { error: "Invalid JSON or multipart body." };
  if (!body.dataUrl) return { error: "dataUrl is required for JSON uploads." };
  const parsed = parseDataUrl(body.dataUrl);
  if (!parsed) return { error: "dataUrl must be a jpeg/png/webp base64 image." };
  return {
    certId: body.certId,
    view: body.view,
    consentToStore: body.consentToStore,
    userProvided: body.userProvided,
    originalFilename: body.filename ?? "cert-reference-image",
    mime: parsed.mime,
    buffer: parsed.buffer,
    sourceNote: body.sourceNote ?? "",
  };
}

function safeJoin(rootDir: string, ...segments: string[]) {
  const target = resolve(join(rootDir, ...segments));
  const normalizedRoot = resolve(rootDir);
  return target.startsWith(normalizedRoot) ? target : null;
}

export async function POST(request: Request) {
  const parsed = await parseUpload(request);
  if ("error" in parsed) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });

  const certId = cleanCertId(parsed.certId);
  if (!certId) return NextResponse.json({ ok: false, error: "certId must match [a-z0-9_]+." }, { status: 400 });

  const consentToStore = parsed.consentToStore === true || parsed.consentToStore === "true";
  const userProvided = parsed.userProvided === true || parsed.userProvided === "true";
  if (!consentToStore || !userProvided) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Certified images can only be stored when userProvided=true and consentToStore=true. Do not upload scraped/cached cert images.",
      },
      { status: 400 },
    );
  }

  if (!ALLOWED_MIME.has(parsed.mime)) {
    return NextResponse.json({ ok: false, error: "Only jpeg/png/webp images are supported." }, { status: 415 });
  }
  if (parsed.buffer.byteLength <= 0 || parsed.buffer.byteLength > MAX_BYTES) {
    return NextResponse.json({ ok: false, error: "Image must be between 1 byte and 8 MB." }, { status: 413 });
  }

  const ref = loadAllCertifiedReferences().find((item) => item.id === certId);
  const view = cleanView(parsed.view);
  const ext = extFromMime(parsed.mime, parsed.originalFilename);
  const filename = `${view}.${ext}`;
  const slabRoot = join(repoRoot(), "data", "cert-references", "slab-images");
  const targetDir = safeJoin(slabRoot, certId);
  if (!targetDir) return NextResponse.json({ ok: false, error: "Invalid cert image path." }, { status: 400 });
  await mkdir(targetDir, { recursive: true });

  const filePath = safeJoin(targetDir, filename);
  if (!filePath) return NextResponse.json({ ok: false, error: "Invalid filename." }, { status: 400 });

  const sha256 = createHash("sha256").update(parsed.buffer).digest("hex");
  await writeFile(filePath, parsed.buffer);
  await writeFile(
    join(targetDir, `${view}.metadata.json`),
    `${JSON.stringify(
      {
        certId,
        referenceKnown: Boolean(ref),
        provider: ref?.provider ?? null,
        certNumber: ref?.certNumber ?? null,
        view,
        filename,
        originalFilename: parsed.originalFilename,
        mime: parsed.mime,
        sizeBytes: parsed.buffer.byteLength,
        sha256,
        source: "user_provided_cert_reference_image",
        sourceNote: parsed.sourceNote,
        consentToStore: true,
        userProvided: true,
        trainingAllowed: false,
        storedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    "utf-8",
  );

  return NextResponse.json({
    ok: true,
    certId,
    referenceKnown: Boolean(ref),
    view,
    filename,
    sha256,
    url: `/api/cert-references/slab/${certId}/${filename}`,
    message:
      "Certified reference image stored as a replayable artifact. It remains evaluation evidence only; it is not training data.",
  });
}
