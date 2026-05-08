import { NextResponse } from "next/server";
import { explainCardReport } from "../../../../lib/agent/card-report-agent";
import { currentOwnerId } from "../../../../lib/dealer/owner";
import { loadAllRecords, loadRecord } from "../../../../lib/dealer/store";
import type { DealerRecord } from "../../../../lib/dealer/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

type Body = {
  messages?: ChatMessage[];
  focusedRecordId?: string | null;
};

function snapshotRecord(r: DealerRecord): string {
  const dings = r.modelFindings?.length ?? 0;
  const cert = r.certNumber ? `${r.certProvider ?? "PSA"} ${r.certNumber}` : "raw";
  const grade = r.officialGrade ?? "no grade";
  const lane = r.lane;
  const reco = r.roi?.recommendation ?? "n/a";
  const evGraded = r.roi?.expectedGradedEv ?? null;
  const rawHigh = r.pricing?.rawHigh ?? null;
  const proof = r.evidencePacket ? "yes" : "no";
  const review = r.humanReview?.decision ?? "pending";
  return [
    `id=${r.id}`,
    `cert=${cert}`,
    `card=${r.cardIdentity ?? "(no identity)"}`,
    `grade=${grade}`,
    `lane=${lane}`,
    `dings=${dings}`,
    `recommendation=${reco}`,
    `rawHigh=${rawHigh ?? "n/a"}`,
    `expectedGradedEv=${evGraded ?? "n/a"}`,
    `evidence-packet=${proof}`,
    `human-review=${review}`,
  ].join(" | ");
}

function buildVaultSnapshot(
  ownerId: string,
  focusedRecordId: string | null | undefined,
): {
  contextText: string;
  reportJson: Record<string, unknown>;
} {
  const all = loadAllRecords(ownerId);
  const totalRecords = all.length;
  const reviewed = all.filter((r) => r.humanReview).length;
  const needsReview = all.filter((r) => r.lane === "human_review").length;
  const listed = all.filter((r) => r.listing).length;
  const submitted = all.filter((r) => r.submission).length;
  const inventory = all.reduce((s, r) => s + (r.pricing?.rawHigh ?? 0), 0);

  // Top 6 by value across all records.
  const topByValue = [...all]
    .filter((r) => r.pricing?.rawHigh)
    .sort((a, b) => (b.pricing?.rawHigh ?? 0) - (a.pricing?.rawHigh ?? 0))
    .slice(0, 6);
  const recent = [...all]
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, 6);
  const focused = focusedRecordId ? loadRecord(ownerId, focusedRecordId) ?? null : null;

  const lines: string[] = [
    "# Live vault snapshot",
    `total=${totalRecords} reviewed=${reviewed} needs_review=${needsReview} listed=${listed} submitted=${submitted} inventory_rawHigh=$${inventory}`,
  ];
  if (focused) {
    lines.push("", "## Focused record (the user is asking about this)", snapshotRecord(focused));
  } else if (focusedRecordId) {
    lines.push("", `## Focused record id=${focusedRecordId} (NOT FOUND in vault)`);
  }
  if (topByValue.length > 0) {
    lines.push("", "## Top by raw value");
    for (const r of topByValue) lines.push(snapshotRecord(r));
  }
  if (recent.length > 0) {
    lines.push("", "## Most recent activity");
    for (const r of recent) lines.push(snapshotRecord(r));
  }

  // Build a structured reportJson the report-explainer formats into the
  // LLM prompt body. This bypasses completeWorkspaceChat which throws
  // away history + context.
  const summarize = (r: DealerRecord) => ({
    id: r.id,
    cert: r.certNumber ? `${r.certProvider ?? "PSA"} ${r.certNumber}` : null,
    card: r.cardIdentity ?? null,
    grade: r.officialGrade ?? null,
    lane: r.lane,
    rawHigh: r.pricing?.rawHigh ?? null,
    expectedGradedEv: r.roi?.expectedGradedEv ?? null,
    recommendation: r.roi?.recommendation ?? null,
    dings: r.modelFindings?.length ?? 0,
    proofSaved: Boolean(r.evidencePacket),
    humanReview: r.humanReview?.decision ?? null,
  });

  const reportJson: Record<string, unknown> = {
    summary: `Dealer-OS vault: ${totalRecords} records · $${inventory.toLocaleString()} inventory · ${needsReview} needs review · ${listed} listed · ${submitted} submitted.`,
    findings: [],
    vault: {
      totals: { totalRecords, reviewed, needsReview, listed, submitted, inventoryValue: inventory },
      focusedRecord: focused ? summarize(focused) : null,
      topByValue: topByValue.map(summarize),
      recent: recent.map(summarize),
    },
  };

  return { contextText: lines.join("\n"), reportJson };
}

const SYSTEM_RULES = `You are Pi, the Card Condition Vault dealer-OS agent. You help vendors triage card-grading decisions on a private trading-card pilot.

Ground rules:
- Never claim official grades. The vault produces "AI-assisted visible condition only".
- Always cite specific record ids, cert numbers, DING counts, and dollar values from the vault snapshot above.
- Recommendations: submit, sell_raw, hold, rescan, human_review. Pick one and explain why in 2-3 lines.
- If asked about a record that isn't in the vault snapshot, say so plainly.
- Keep replies under 6 sentences unless the user explicitly asks for a long answer.
- Tone: terse, technical, dealer-friendly. No marketing fluff.`;

function flattenHistory(messages: ChatMessage[]): string {
  // Keep the chat history short — last 8 turns max — so the prompt stays
  // small and the LLM doesn't get drowned by stale context.
  const turns = messages.filter((m) => m.role === "user" || m.role === "assistant").slice(-8);
  return turns
    .map((m) => `${m.role === "user" ? "Dealer" : "Pi"}: ${m.content.trim()}`)
    .join("\n\n");
}

export async function POST(request: Request) {
  const { messages = [], focusedRecordId = null }: Body = await request.json();
  const ownerId = await currentOwnerId();
  try {
    const { contextText, reportJson } = buildVaultSnapshot(ownerId, focusedRecordId);
    const last = messages.at(-1)?.content?.trim() ?? "Help me triage the workbench.";
    const history = flattenHistory(messages.slice(0, -1));

    // Build a single prompt that the report-explainer pipes through the
    // LLM verbatim. We embed the vault snapshot, the rules, the prior
    // conversation, and the new question — bypassing completeWorkspaceChat
    // which strips message history.
    const prompt = [
      contextText,
      "",
      "----",
      SYSTEM_RULES,
      "----",
      history.length > 0 ? `Prior conversation:\n${history}\n\n----` : "",
      `Dealer's new question:\n${last}\n\nAnswer using the vault snapshot above. Cite cert numbers and dollar values when relevant.`,
    ]
      .filter((line) => line !== "")
      .join("\n");

    const reply = await explainCardReport({
      prompt,
      reportJson,
      cardId: focusedRecordId ?? undefined,
    });

    return NextResponse.json({
      role: "assistant",
      content: reply.content,
      provider: reply.provider,
      model: reply.model,
      error: reply.error,
      tools: [
        {
          name: "vault.read",
          status: "passed",
          label: focusedRecordId ? `loaded record ${focusedRecordId}` : "loaded vault snapshot",
        },
        {
          name: "vault.search",
          status: "passed",
          label: `indexed ${reportJson.vault && typeof reportJson.vault === "object" && "totals" in (reportJson.vault as Record<string, unknown>) ? "top-by-value + recent activity" : "vault state"}`,
        },
      ],
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "unknown";
    return NextResponse.json(
      {
        role: "assistant",
        content: `(agent fallback) Couldn't reach the LLM: ${msg}. Vault state still readable at /data/dealer/records.jsonl.`,
        provider: "local-fallback",
        error: msg,
      },
      { status: 200 },
    );
  }
}
