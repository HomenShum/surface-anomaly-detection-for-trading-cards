"use client";

import { useState, type ReactNode } from "react";

/**
 * Image-with-fallback for dealer card thumbs.
 *
 * Behavior:
 *  - Renders <img> with `loading="lazy"` + `decoding="async"` while
 *    `src` is provided and not errored.
 *  - On image-load error (network 404, decode failure, missing slab.*
 *    file on disk), swaps in `fallback` so the slab silhouette + cert
 *    badge still renders instead of a blank box.
 *  - Skeleton shimmer comes from the parent CSS (::before keyframe);
 *    this component is purely about handling the failure path.
 */
export function DealerCardThumb({
  src,
  alt,
  fallback,
  className,
  loading = "lazy",
}: {
  src: string | null | undefined;
  alt?: string;
  fallback: ReactNode;
  className?: string;
  loading?: "lazy" | "eager";
}) {
  const [errored, setErrored] = useState(false);
  const isRemoteUrl = /^https?:\/\//i.test(src ?? "");
  if (!src || errored || isRemoteUrl) {
    return <>{fallback}</>;
  }
  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      alt={alt ?? ""}
      className={className}
      decoding="async"
      loading={loading}
      onError={() => setErrored(true)}
      src={src}
    />
  );
}
