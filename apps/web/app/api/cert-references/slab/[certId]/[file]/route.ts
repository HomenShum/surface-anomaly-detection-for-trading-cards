import { NextResponse } from "next/server";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { repoRoot } from "../../../../../../lib/cert-references";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_EXT = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

function safeJoin(rootDir: string, ...segments: string[]) {
  const target = resolve(join(rootDir, ...segments));
  const normalizedRoot = resolve(rootDir);
  if (!target.startsWith(normalizedRoot)) return null;
  return target;
}

function resolveExistingImage(slabRoot: string, certId: string, cleanFile: string) {
  const exact = safeJoin(slabRoot, certId, cleanFile);
  if (exact && existsSync(exact)) return exact;

  const requestedView = cleanFile.split(".")[0]?.toLowerCase();
  if (!["front", "back", "label", "other"].includes(requestedView)) return null;

  for (const ext of ALLOWED_EXT) {
    const candidate = safeJoin(slabRoot, certId, `${requestedView}${ext}`);
    if (candidate && existsSync(candidate)) return candidate;
  }
  return null;
}

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ certId: string; file: string }> },
) {
  const { certId, file } = await ctx.params;
  // Defence: reject path-traversal attempts. Only [a-z0-9_-]+ in cert id and
  // simple basename in file.
  if (!/^[a-z0-9_]+$/i.test(certId)) {
    return NextResponse.json({ ok: false, error: "invalid cert id" }, { status: 400 });
  }
  const cleanFile = normalize(file).replace(/^([./\\])+/, "");
  if (cleanFile.includes("..") || cleanFile.includes("/") || cleanFile.includes("\\")) {
    return NextResponse.json({ ok: false, error: "invalid filename" }, { status: 400 });
  }
  const ext = extname(cleanFile).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) {
    return NextResponse.json({ ok: false, error: "unsupported file extension" }, { status: 400 });
  }
  const slabRoot = join(repoRoot(), "data", "cert-references", "slab-images");
  const target = resolveExistingImage(slabRoot, certId, cleanFile);
  if (!target) {
    return NextResponse.json(
      {
        ok: false,
        error: "No replayable local certified-reference image found for this view.",
        policy: "Only user/vendor-provided or permissioned local images are served. Remote cert images are not proxied or cached.",
      },
      { status: 404 },
    );
  }
  const stat = statSync(target);
  if (!stat.isFile()) {
    return NextResponse.json({ ok: false, error: "not a file" }, { status: 400 });
  }
  if (stat.size > 8 * 1024 * 1024) {
    return NextResponse.json({ ok: false, error: "image too large to serve" }, { status: 413 });
  }
  const buffer = readFileSync(target);
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "content-type": MIME_BY_EXT[ext] ?? "application/octet-stream",
      "cache-control": "private, max-age=300",
      "x-served-by": "ccv-cert-slab",
      "x-ccv-image-policy": "replayable-certified-reference-evidence-not-training-data",
    },
  });
}
