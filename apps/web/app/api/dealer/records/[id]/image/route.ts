import { NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { currentOwnerId } from "../../../../../../lib/dealer/owner";
import { loadRecord, resolveSlabImagePath } from "../../../../../../lib/dealer/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ownerId = await currentOwnerId();
  const rec = loadRecord(ownerId, id);
  if (!rec) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const resolved = resolveSlabImagePath(ownerId, id);
  if (!resolved) {
    return NextResponse.json({ error: "no_image_attached" }, { status: 404 });
  }
  const buf = readFileSync(resolved.path);
  const mime = MIME_BY_EXT[extname(resolved.path).toLowerCase()] ?? "application/octet-stream";
  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": mime,
      "Cache-Control": "private, max-age=60",
    },
  });
}
