import { NextResponse } from "next/server";
import { completeWorkspaceChat } from "../../../../lib/agent/card-report-agent";

export const runtime = "nodejs";

type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

function fallbackAgent(messages: ChatMessage[]) {
  const last = messages.at(-1)?.content.toLowerCase() ?? "";
  if (last.includes("compare")) {
    return "I can build a before/after packet from two scans. Upload the returned-card image, then I will run comparison, list possible new DINGS, and attach the evidence hashes.";
  }
  if (last.includes("save")) {
    return "I saved the reviewed card to the local catalog. In production this operation writes the card, scan session, detections, report, and evidence manifest to Convex.";
  }
  if (last.includes("upload") || last.includes("analy")) {
    return "Upload the front image in this sidebar and click Analyze upload. I will normalize the card, run the trained DING detector if weights are available, and keep the full report auditable.";
  }
  return "I am ready to help review a card. Upload a front image, ask for analysis, then approve any save or correction operation before it changes the catalog.";
}

async function callInflection(messages: ChatMessage[]) {
  const apiKey = process.env.INFLECTION_API_KEY;
  if (!apiKey) return null;

  const baseUrl = process.env.INFLECTION_API_BASE_URL ?? "https://api.inflection.ai/v1";
  const model = process.env.INFLECTION_MODEL ?? "inflection_3_pi";
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content:
            "You are Card Condition Vault's calm operating agent. Help collectors scan cards, detect visible DINGS, correct reports, save catalog records, and create evidence packets. Never claim official grading.",
        },
        ...messages,
      ],
      max_tokens: 600,
      temperature: 0.4,
    }),
  });
  if (!response.ok) throw new Error(`Inflection API returned ${response.status}`);
  const body = await response.json();
  return String(body.choices?.[0]?.message?.content ?? "");
}

export async function POST(request: Request) {
  const { messages = [] }: { messages?: ChatMessage[] } = await request.json();
  try {
    const piResponse = await completeWorkspaceChat(messages);
    if (piResponse.provider !== "local-fallback" || !process.env.INFLECTION_API_KEY) {
      return NextResponse.json({
        role: "assistant",
        content: piResponse.content,
        provider: piResponse.provider,
        model: piResponse.model,
        error: piResponse.error,
      });
    }
    const content = (await callInflection(messages)) ?? piResponse.content ?? fallbackAgent(messages);
    return NextResponse.json({
      role: "assistant",
      content,
      provider: process.env.INFLECTION_API_KEY ? "inflection" : piResponse.provider,
      model: piResponse.model,
    });
  } catch (error) {
    return NextResponse.json({
      role: "assistant",
      content: `${fallbackAgent(messages)}\n\nProvider fallback used because the configured pi-ai/OpenRouter request failed.`,
      provider: "local-fallback",
      error: error instanceof Error ? error.message : "unknown",
    });
  }
}
