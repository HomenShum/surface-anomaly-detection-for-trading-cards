import { action } from "./_generated/server";
import { v } from "convex/values";

declare const process: {
  env: Record<string, string | undefined>;
};

const SYSTEM_PROMPT = `
You are Card Condition Vault's report assistant.
You explain AI-assisted card condition reports and evidence manifests.
Use only the report JSON, evidence manifest, and user-provided context.
Do not invent detections.
Do not claim this is an official grade.
Do not claim this is legal proof.
You may recommend crop, zoom, rotate, glare-check, or reinspection methods, but you must label them as proposed inspection methods until benchmarks pass.
Do not say a proposed method is active for all users unless the skill registry says it is promoted.
Always explain uncertainty clearly.
Keep answers compact and operator-friendly.
`;

function summarizeFindings(reportJson: unknown) {
  const report = reportJson as { findings?: Array<Record<string, unknown>>; summary?: string; condition_score?: number };
  const findings = Array.isArray(report?.findings) ? report.findings : [];
  const top = findings
    .slice(0, 5)
    .map((finding) => {
      const kind = String(finding.kind ?? finding.type ?? "unknown_damage").replaceAll("_", " ");
      const confidence = Math.round(Number(finding.confidence ?? 0) * 100);
      const severity = String(finding.severity ?? "low");
      return `- ${kind}: ${severity}, ${confidence}% confidence`;
    })
    .join("\n");
  return {
    summary: String(report?.summary ?? "No saved report summary was provided."),
    score: typeof report?.condition_score === "number" ? Math.round(report.condition_score) : undefined,
    findingsText: top || "- No visible DING candidate exceeded the current detector threshold.",
  };
}

function localExplanation(input: { prompt: string; reportJson?: unknown }) {
  const report = summarizeFindings(input.reportJson);
  const scoreLine = report.score === undefined ? "" : `\nCondition benchmark: ${report.score}/100.`;
  return `Summary: ${report.summary}${scoreLine}

Visible DINGS:
${report.findingsText}

Confidence: Treat this as an alpha AI-assisted condition read. Empty or low-confidence detections are not proof the card is clean.

What to retake: Retake if the image is blurry, angled, cropped at the edges, too dark, or has glare across the surface.

What not to conclude: This is not an official grade or legal guarantee.

Next step: Review each DING box, correct false positives, then save the evidence manifest before shipping or submitting the card.`;
}

function payload(input: { prompt: string; cardId?: string; reportJson?: unknown; evidenceManifest?: unknown }) {
  return JSON.stringify({
    task: input.prompt,
    cardId: input.cardId,
    report: input.reportJson,
    evidenceManifest: input.evidenceManifest,
  });
}

async function callOpenRouter(input: { prompt: string; cardId?: string; reportJson?: unknown; evidenceManifest?: unknown }, apiKey: string, model: string) {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL ?? process.env.SITE_URL ?? "http://localhost:3000",
      "X-Title": "Card Condition Vault Convex Agent",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: payload(input) },
      ],
      temperature: 0.25,
      max_tokens: 700,
    }),
  });
  if (!response.ok) throw new Error(`OpenRouter returned ${response.status}`);
  const body = await response.json();
  return String(body.choices?.[0]?.message?.content ?? localExplanation(input));
}

async function callGemini(input: { prompt: string; cardId?: string; reportJson?: unknown; evidenceManifest?: unknown }, apiKey: string, model: string) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: "user", parts: [{ text: payload(input) }] }],
      generationConfig: { temperature: 0.25, maxOutputTokens: 700 },
    }),
  });
  if (!response.ok) throw new Error(`Gemini returned ${response.status}`);
  const body = await response.json();
  return (body.candidates?.[0]?.content?.parts ?? [])
    .map((part: { text?: string }) => part.text ?? "")
    .join("")
    .trim() || localExplanation(input);
}

async function callOpenAi(input: { prompt: string; cardId?: string; reportJson?: unknown; evidenceManifest?: unknown }, apiKey: string, model: string) {
  const response = await fetch(`${process.env.CONVEX_OPENAI_BASE_URL ?? "https://api.openai.com"}/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: payload(input) },
      ],
      temperature: 0.25,
      max_tokens: 700,
    }),
  });
  if (!response.ok) throw new Error(`OpenAI returned ${response.status}`);
  const body = await response.json();
  return String(body.choices?.[0]?.message?.content ?? localExplanation(input));
}

async function callAnthropic(input: { prompt: string; cardId?: string; reportJson?: unknown; evidenceManifest?: unknown }, apiKey: string, model: string) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: payload(input) }],
      temperature: 0.25,
      max_tokens: 700,
    }),
  });
  if (!response.ok) throw new Error(`Anthropic returned ${response.status}`);
  const body = await response.json();
  return (body.content ?? [])
    .map((part: { type?: string; text?: string }) => (part.type === "text" ? part.text ?? "" : ""))
    .join("")
    .trim() || localExplanation(input);
}

export const envHealth = action({
  args: {},
  handler: async () => ({
    provider: process.env.CARD_AGENT_PROVIDER ?? "openrouter",
    primaryModel: process.env.CARD_AGENT_MODEL ?? "google/gemini-2.5-flash",
    fallbackModels: {
      gemini: process.env.CARD_AGENT_GEMINI_MODEL ?? "gemini-2.5-flash",
      openai: process.env.CARD_AGENT_BACKUP_MODEL ?? "gpt-4o-mini",
      anthropic: process.env.CARD_AGENT_ANTHROPIC_MODEL ?? "claude-3-5-haiku-latest",
    },
    configured: {
      openrouter: Boolean(process.env.OPENROUTER_API_KEY),
      gemini: Boolean(process.env.GEMINI_API_KEY),
      openai: Boolean(process.env.OPENAI_API_KEY ?? process.env.CONVEX_OPENAI_API_KEY),
      anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
      roboflow: Boolean(process.env.ROBOFLOW_API_KEY),
    },
  }),
});

export const explainReport = action({
  args: {
    cardId: v.optional(v.string()),
    prompt: v.string(),
    reportJson: v.optional(v.any()),
    evidenceManifest: v.optional(v.any()),
  },
  handler: async (_ctx, args) => {
    const errors: string[] = [];
    const openRouterKey = process.env.OPENROUTER_API_KEY ?? "";
    const openRouterModel = process.env.CARD_AGENT_MODEL ?? "google/gemini-2.5-flash";
    try {
      if (openRouterKey) {
        return {
          content: await callOpenRouter(args, openRouterKey, openRouterModel),
          provider: "convex-openrouter",
          model: openRouterModel,
        };
      }
      errors.push("OpenRouter key missing");
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "OpenRouter failed");
    }

    const geminiKey = process.env.GEMINI_API_KEY ?? "";
    const geminiModel = process.env.CARD_AGENT_GEMINI_MODEL ?? "gemini-2.5-flash";
    try {
      if (geminiKey) {
        return {
          content: await callGemini(args, geminiKey, geminiModel),
          provider: "convex-gemini",
          model: geminiModel,
        };
      }
      errors.push("Gemini key missing");
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Gemini failed");
    }

    const openAiKey = process.env.OPENAI_API_KEY ?? process.env.CONVEX_OPENAI_API_KEY ?? "";
    const openAiModel = process.env.CARD_AGENT_BACKUP_MODEL ?? "gpt-4o-mini";
    try {
      if (openAiKey) {
        return {
          content: await callOpenAi(args, openAiKey, openAiModel),
          provider: "convex-openai",
          model: openAiModel,
        };
      }
      errors.push("OpenAI key missing");
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "OpenAI failed");
    }

    const anthropicKey = process.env.ANTHROPIC_API_KEY ?? "";
    const anthropicModel = process.env.CARD_AGENT_ANTHROPIC_MODEL ?? "claude-3-5-haiku-latest";
    try {
      if (anthropicKey) {
        return {
          content: await callAnthropic(args, anthropicKey, anthropicModel),
          provider: "convex-anthropic",
          model: anthropicModel,
        };
      }
      errors.push("Anthropic key missing");
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Anthropic failed");
    }

    return {
      content: localExplanation(args),
      provider: "convex-local-fallback",
      model: openRouterModel,
      error: errors.join("; "),
    };
  },
});
