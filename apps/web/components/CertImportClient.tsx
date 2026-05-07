"use client";

import { useMemo, useState } from "react";
import type { CertifiedReference } from "../lib/cert-references";

type Props = {
  initialReferences: CertifiedReference[];
};

const DEFAULT_BATCH = [
  "https://www.psacard.com/cert/154378339",
  "148901886",
  "142558459",
  "142558463",
  "148901879",
  "152528467",
  "142558471",
  "139091062",
  "https://my.taggrading.com/card/J6994233",
].join("\n");

export function CertImportClient({ initialReferences }: Props) {
  const [text, setText] = useState(DEFAULT_BATCH);
  const [fileInputs, setFileInputs] = useState<
    Array<{ name: string; text?: string; base64?: string; mimeType?: string }>
  >([]);
  const [references, setReferences] = useState(initialReferences);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const counts = useMemo(() => {
    return {
      total: references.length,
      psa: references.filter((ref) => ref.provider === "PSA").length,
      tag: references.filter((ref) => ref.provider === "TAG").length,
      silverPlus: references.filter((ref) => ref.trustTier === "silver_plus").length,
      goldCandidates: references.filter((ref) => ref.trustTier === "gold_candidate").length,
    };
  }, [references]);

  async function onFilesSelected(files: FileList | null) {
    if (!files) return;
    const next: Array<{ name: string; text?: string; base64?: string; mimeType?: string }> = [];
    for (const file of Array.from(files).slice(0, 12)) {
      const isImage = /^image\//i.test(file.type) || /\.(png|jpe?g|webp|heic|tif|tiff)$/i.test(file.name);
      if (isImage) {
        // Cap encoded payload to prevent abusive large uploads (5 MB binary = ~6.7 MB base64).
        if (file.size > 5 * 1024 * 1024) {
          next.push({ name: file.name, mimeType: file.type, text: "" });
          continue;
        }
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result ?? ""));
          reader.onerror = () => reject(reader.error ?? new Error("file read failed"));
          reader.readAsDataURL(file);
        });
        const base64 = dataUrl.split(",")[1] ?? "";
        next.push({ name: file.name, base64, mimeType: file.type });
        continue;
      }
      let textContent = "";
      if (/text|json|csv|plain/i.test(file.type) || /\.(txt|csv|json)$/i.test(file.name)) {
        textContent = await file.text();
      }
      next.push({ name: file.name, text: textContent, mimeType: file.type });
    }
    setFileInputs(next);
  }

  async function submit() {
    setIsSubmitting(true);
    setMessage("");
    setWarnings([]);
    try {
      const response = await fetch("/api/certs/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text,
          files: fileInputs,
        }),
      });
      const data = (await response.json()) as {
        ok: boolean;
        error?: string;
        message?: string;
        references?: CertifiedReference[];
        allReferences?: CertifiedReference[];
        warnings?: string[];
        ocrAdapterId?: string;
      };
      if (!response.ok || !data.ok) {
        setMessage(data.error ?? "Import failed.");
        return;
      }
      setReferences(data.allReferences ?? data.references ?? references);
      setWarnings(data.warnings ?? []);
      const adapterSuffix = data.ocrAdapterId && data.ocrAdapterId !== "none" ? ` (OCR adapter: ${data.ocrAdapterId})` : "";
      setMessage((data.message ?? "Imported.") + adapterSuffix);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Import failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <section className="cert-import-grid">
        <form
          className="cert-import-card"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div>
            <span className="page-kicker">Batch import</span>
            <h2>Paste links, numbers, or label OCR text</h2>
            <p className="muted">
              PSA cert numbers are resolved through the API when configured. Otherwise they stay as reviewable
              Silver+ references. TAG links are stored without crawling the report.
            </p>
          </div>
          <label htmlFor="cert-import-text">Cert input</label>
          <textarea
            id="cert-import-text"
            onChange={(event) => setText(event.target.value)}
            spellCheck={false}
            value={text}
          />
          <label htmlFor="cert-import-files">Label screenshots or text exports</label>
          <input
            accept="image/*,.txt,.csv,.json"
            id="cert-import-files"
            multiple
            onChange={(event) => void onFilesSelected(event.target.files)}
            type="file"
          />
          {fileInputs.length > 0 ? (
            <ul className="cert-import-file-list">
              {fileInputs.map((file) => {
                const isImage =
                  Boolean(file.base64) || /^image\//i.test(file.mimeType ?? "") || /\.(png|jpe?g|webp)$/i.test(file.name);
                let status: string;
                if (file.text) status = "text parsed";
                else if (isImage && file.base64) status = "image bytes attached - local OCR runs server-side when available";
                else if (isImage) status = "image too large (>5MB) — only filename will be parsed";
                else status = "filename parsed; OCR adapter not configured";
                return (
                  <li key={file.name}>
                    <strong>{file.name}</strong>
                    <span>{status}</span>
                  </li>
                );
              })}
            </ul>
          ) : null}
          <button className="primary-button" disabled={isSubmitting} type="submit">
            {isSubmitting ? "Importing..." : "Import certified references"}
          </button>
          {message ? <p className="cert-import-message">{message}</p> : null}
        </form>

        <aside className="cert-import-card cert-import-scoreboard">
          <span className="page-kicker">Current registry</span>
          <div className="cert-import-stats">
            <div>
              <span>Total</span>
              <strong>{counts.total}</strong>
            </div>
            <div>
              <span>PSA</span>
              <strong>{counts.psa}</strong>
            </div>
            <div>
              <span>TAG</span>
              <strong>{counts.tag}</strong>
            </div>
            <div>
              <span>Silver+</span>
              <strong>{counts.silverPlus}</strong>
            </div>
          </div>
          <p className="muted">
            Deployability is decided by the offline cert-reference eval, not this import form. A reference becomes Gold
            only after raw pre-submission scans, official outcome, consent, and human DING review exist.
          </p>
          {warnings.length > 0 ? (
            <div className="cert-import-warnings">
              <strong>Warnings</strong>
              {warnings.slice(0, 6).map((warning) => (
                <span key={warning}>{warning}</span>
              ))}
            </div>
          ) : null}
        </aside>
      </section>

      <section className="cert-import-results">
        <h2>Certified references</h2>
        <div className="cert-import-table-wrap">
          <table className="benchmarks-table cert-import-table">
            <thead>
              <tr>
                <th>Provider</th>
                <th>Cert</th>
                <th>Outcome</th>
                <th>Trust</th>
                <th>Policy</th>
                <th>Gold gap</th>
              </tr>
            </thead>
            <tbody>
              {references.map((ref) => (
                <tr key={ref.id}>
                  <td>{ref.provider}</td>
                  <td>
                    <a href={ref.externalUrl} rel="noreferrer" target="_blank">
                      {ref.certNumber}
                    </a>
                    <small>{ref.cardIdentity ?? "identity pending"}</small>
                  </td>
                  <td>
                    <strong>{ref.officialGrade ?? "pending"}</strong>
                    <small>{ref.metadataConfidence.replaceAll("_", " ")}</small>
                  </td>
                  <td>
                    <span className={`cert-tier cert-tier--${ref.trustTier}`}>{ref.trustTier.replace("_", "+")}</span>
                  </td>
                  <td>
                    <small>{ref.ingestionPolicy}</small>
                  </td>
                  <td>
                    {ref.needsRawScanForGold ? (
                      <span className="cert-gap">Needs raw scan + DING review</span>
                    ) : (
                      <span className="cert-ready">Gold-ready</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
