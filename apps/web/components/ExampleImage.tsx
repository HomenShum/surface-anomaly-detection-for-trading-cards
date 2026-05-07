"use client";

import { useState } from "react";

type Props = {
  src: string | null;
  alt: string;
  fallbackLabel: string;
  fallbackHint?: string;
  externalReferenceUrl?: string;
  externalReferenceLabel?: string;
  /** When true, renders a more verbose placeholder (used in detail view). */
  verbose?: boolean;
  opacity?: number;
};

export function ExampleImage({
  src,
  alt,
  fallbackLabel,
  fallbackHint,
  externalReferenceUrl,
  externalReferenceLabel,
  verbose = false,
  opacity = 1,
}: Props) {
  const [errored, setErrored] = useState(false);
  const showImage = Boolean(src) && !errored;

  if (showImage) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        alt={alt}
        loading="lazy"
        onError={() => setErrored(true)}
        src={src!}
        style={{ opacity }}
      />
    );
  }

  return (
    <div className={verbose ? "example-image-placeholder" : "example-card-placeholder"}>
      <span>{fallbackLabel}</span>
      {verbose ? (
        <em>{fallbackHint ?? "Identity image is deep-link only."}</em>
      ) : (
        <em>{fallbackHint ?? "external reference only - no local image"}</em>
      )}
      {externalReferenceUrl ? (
        <a href={externalReferenceUrl} rel="noopener noreferrer" target="_blank">
          {externalReferenceLabel ?? "View source"} ↗
        </a>
      ) : null}
    </div>
  );
}
