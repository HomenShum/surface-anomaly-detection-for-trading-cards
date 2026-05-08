/**
 * Image validation that doesn't trust client-supplied Content-Type.
 *
 * The dealer-OS attach-image endpoint accepts base64-encoded uploads. A
 * malicious client could lie about the MIME type to smuggle in HTML or
 * SVG with embedded JS. We decode the first ~16 bytes and check for the
 * file-format magic bytes that match our allow-list (jpeg/png/webp).
 *
 * This is in addition to the size cap and rate limit. Belt + suspenders.
 */

export type SniffResult =
  | { ok: true; mime: "image/jpeg" | "image/png" | "image/webp"; ext: ".jpg" | ".png" | ".webp" }
  | { ok: false; reason: string };

/**
 * Inspect the leading bytes of a buffer and decide whether it's an
 * allowed image format. Falls back to "unknown" for anything that
 * doesn't match — caller should reject with 415 Unsupported Media Type.
 */
export function sniffImageBytes(buf: Uint8Array): SniffResult {
  if (buf.length < 16) {
    return { ok: false, reason: "truncated" };
  }
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { ok: true, mime: "image/jpeg", ext: ".jpg" };
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return { ok: true, mime: "image/png", ext: ".png" };
  }
  // WebP: RIFF....WEBP
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return { ok: true, mime: "image/webp", ext: ".webp" };
  }
  return { ok: false, reason: "unsupported_or_corrupt" };
}

export function sniffBase64(base64: string): SniffResult {
  try {
    // Decode just enough bytes to inspect the magic — the full decode
    // happens later only if validation passes.
    const head = base64.slice(0, 24); // 24 chars b64 = 18 bytes
    const buf = Buffer.from(head, "base64");
    return sniffImageBytes(new Uint8Array(buf));
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "decode_failed" };
  }
}
