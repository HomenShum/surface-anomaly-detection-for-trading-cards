import { NextResponse } from "next/server";
import { existsSync, readFileSync } from "node:fs";
import { join, extname } from "node:path";
import { dealerDataDir, loadRecord } from "../../../../../../lib/dealer/store";

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
  const rec = loadRecord(id);
  if (!rec) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const dir = join(dealerDataDir(), "images", id);
  for (const name of ["slab.jpg", "slab.jpeg", "slab.png", "slab.webp"]) {
    const path = join(dir, name);
    if (existsSync(path)) {
      const buf = readFileSync(path);
      const mime = MIME_BY_EXT[extname(name).toLowerCase()] ?? "application/octet-stream";
      return new Response(new Uint8Array(buf), {
        status: 200,
        headers: {
          "Content-Type": mime,
          "Cache-Control": "private, max-age=60",
        },
      });
    }
  }
  return NextResponse.json({ error: "no_image_attached" }, { status: 404 });
}
