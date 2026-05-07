export type VaultItem = {
  id: string;
  title: string;
  category: "card" | "sealed" | "ticket" | "other";
  game: "pokemon" | "sports" | "one-piece" | "magic" | "unknown";
  setName: string;
  variant: string;
  grade: string;
  confidence: number;
  surfaceScore: number;
  centeringScore: number;
  edgeScore: number;
  notes: string;
  analysisJobKey?: string;
  inputSha256?: string;
  normalizedSha256?: string;
  modelVersion?: string;
  imageDataUrl?: string;
  sourceImageDataUrl?: string;
  backImageDataUrl?: string;
  detections: DingDetection[];
  corrections: UserCorrection[];
  evidence: EvidenceManifest;
  scannedAt: string;
};

export type DingDetection = {
  id: string;
  type: string;
  zone: string;
  confidence: number;
  severity: "minor" | "moderate" | "major";
  bbox: [number, number, number, number];
  source: "mock" | "model" | "user";
};

export type UserCorrection = {
  id: string;
  detectionId?: string;
  action: "false_positive" | "change_label" | "add_missed_ding" | "mark_unsure";
  label: string;
  note: string;
  createdAt: string;
};

export type EvidenceManifest = {
  manifestVersion: "0.1";
  cardId: string;
  scanSessionId: string;
  createdAt: string;
  files: Array<{
    role: "front_original" | "back_original" | "front_normalized" | "back_normalized" | "report_json";
    sha256: string;
    path: string;
  }>;
  model: {
    dingDetector: string;
    normalizer: string;
  };
  disclaimer: string;
};

export const vaultStorageKey = "card-condition-vault.items.v1";
export const reportDisclaimer =
  "This is a timestamped condition evidence record and AI-assisted condition estimate. It is not an official grade or legal guarantee.";

function svgCard(title: string, accent: string, back = false) {
  const label = encodeURIComponent(title);
  const stripe = back ? "%23e6eef0" : encodeURIComponent(accent);
  return `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='720' height='1008' viewBox='0 0 720 1008'%3E%3Crect width='720' height='1008' fill='%23f8faf9'/%3E%3Crect x='58' y='58' width='604' height='892' rx='32' fill='white' stroke='%23263338' stroke-width='12'/%3E%3Crect x='92' y='94' width='536' height='328' rx='18' fill='${stripe}'/%3E%3Crect x='92' y='456' width='536' height='62' rx='10' fill='%2318272c'/%3E%3Crect x='92' y='552' width='536' height='48' rx='8' fill='%23dce8e6'/%3E%3Crect x='92' y='626' width='420' height='32' rx='8' fill='%23dce8e6'/%3E%3Crect x='92' y='714' width='536' height='144' rx='14' fill='%23eef3f2'/%3E%3Ctext x='360' y='494' fill='white' font-family='Arial' font-size='32' text-anchor='middle' font-weight='700'%3E${label}%3C/text%3E%3Ccircle cx='612' cy='902' r='22' fill='%23b42318'/%3E%3C/svg%3E`;
}

export function stableHash(value: string) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(h2 >>> 0).toString(16).padStart(8, "0")}${(h1 >>> 0)
    .toString(16)
    .padStart(8, "0")}`.repeat(4);
}

export function createEvidenceManifest(cardId: string, createdAt = new Date().toISOString()): EvidenceManifest {
  return {
    manifestVersion: "0.1",
    cardId,
    scanSessionId: `scan-${stableHash(`${cardId}:${createdAt}`).slice(0, 12)}`,
    createdAt,
    files: [
      {
        role: "front_original",
        sha256: stableHash(`${cardId}:front:${createdAt}`),
        path: `storage/scans/${cardId}/front_original.jpg`
      },
      {
        role: "front_normalized",
        sha256: stableHash(`${cardId}:front-normalized:${createdAt}`),
        path: `storage/scans/${cardId}/front_normalized.jpg`
      },
      {
        role: "report_json",
        sha256: stableHash(`${cardId}:report:${createdAt}`),
        path: `storage/reports/${cardId}/condition_report.json`
      }
    ],
    model: {
      dingDetector: "ding-detector-v0",
      normalizer: "opencv-v0.1"
    },
    disclaimer: reportDisclaimer
  };
}

export const sampleDetections: DingDetection[] = [
  {
    id: "det-back-left-edge",
    type: "edge_wear",
    zone: "back_left_edge",
    confidence: 0.78,
    severity: "minor",
    bbox: [4, 42, 10, 56],
    source: "model"
  },
  {
    id: "det-bottom-right-corner",
    type: "corner_wear",
    zone: "bottom_right_corner",
    confidence: 0.72,
    severity: "minor",
    bbox: [80, 82, 96, 98],
    source: "model"
  },
  {
    id: "det-surface-line",
    type: "scratch",
    zone: "front_surface",
    confidence: 0.41,
    severity: "minor",
    bbox: [38, 28, 68, 34],
    source: "model"
  }
];

export const sampleItems: VaultItem[] = [
  {
    id: "sample-1999-charizard",
    title: "1999 Holo Charizard",
    category: "card",
    game: "pokemon",
    setName: "Base Set",
    variant: "Holo",
    grade: "DING review",
    confidence: 0.86,
    surfaceScore: 88,
    centeringScore: 82,
    edgeScore: 79,
    notes: "Light back-edge whitening. Holo field looks clean in direct light.",
    imageDataUrl: svgCard("Charizard", "#0f766e"),
    backImageDataUrl: svgCard("Back", "#263338", true),
    detections: sampleDetections,
    corrections: [],
    evidence: createEvidenceManifest("sample-1999-charizard", "2026-05-01T18:24:00.000Z"),
    scannedAt: "2026-05-01T18:24:00.000Z"
  },
  {
    id: "sample-rookie-silver",
    title: "Rookie Silver Prizm",
    category: "card",
    game: "sports",
    setName: "Demo Hoops",
    variant: "Silver Prizm",
    grade: "Surface review",
    confidence: 0.78,
    surfaceScore: 73,
    centeringScore: 91,
    edgeScore: 76,
    notes: "Fine print line visible at lower left under angled light.",
    imageDataUrl: svgCard("Rookie Silver", "#b42318"),
    backImageDataUrl: svgCard("Back", "#263338", true),
    detections: [sampleDetections[2]],
    corrections: [],
    evidence: createEvidenceManifest("sample-rookie-silver", "2026-05-02T16:10:00.000Z"),
    scannedAt: "2026-05-02T16:10:00.000Z"
  },
  {
    id: "sample-ticket",
    title: "Finals Ticket Stub",
    category: "ticket",
    game: "unknown",
    setName: "Finals",
    variant: "Stub",
    grade: "Edge review",
    confidence: 0.7,
    surfaceScore: 68,
    centeringScore: 74,
    edgeScore: 62,
    notes: "Soft corners and shallow crease near barcode.",
    imageDataUrl: svgCard("Ticket", "#a16207"),
    backImageDataUrl: svgCard("Back", "#263338", true),
    detections: [
      {
        id: "det-crease",
        type: "crease",
        zone: "middle_left",
        confidence: 0.61,
        severity: "moderate",
        bbox: [16, 50, 55, 58],
        source: "model"
      }
    ],
    corrections: [],
    evidence: createEvidenceManifest("sample-ticket", "2026-05-03T21:03:00.000Z"),
    scannedAt: "2026-05-03T21:03:00.000Z"
  }
];

export function createScanDraft(imageDataUrl?: string, title = "Fresh scan"): VaultItem {
  const id = `scan-${Date.now()}`;
  const scannedAt = new Date().toISOString();
  return {
    id,
    title,
    category: "card",
    game: "unknown",
    setName: "Unknown set",
    variant: "Unknown",
    grade: "Needs review",
    confidence: 0.62,
    surfaceScore: 68,
    centeringScore: 70,
    edgeScore: 68,
    notes: "AI-assisted evidence draft. Empty detections are not proof the card is clean.",
    imageDataUrl,
    sourceImageDataUrl: imageDataUrl,
    detections: sampleDetections.slice(0, 2),
    corrections: [],
    evidence: createEvidenceManifest(id, scannedAt),
    scannedAt
  };
}

export function scoreLabel(score: number) {
  if (score >= 90) return "Clean";
  if (score >= 75) return "Review";
  if (score >= 60) return "Flag";
  return "Risk";
}

export function conditionSummary(item: VaultItem) {
  if (item.detections.length === 0) {
    return "No visible DING candidates exceeded the current threshold. Human review still recommended.";
  }
  const top = item.detections
    .slice()
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 3)
    .map((finding) => `${finding.type.replaceAll("_", " ")} (${Math.round(finding.confidence * 100)}%)`);
  return `Visible DINGS: ${top.join(", ")}.`;
}
