import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

export type CardReportAgentInput = {
  cardId?: string;
  prompt: string;
  reportJson?: unknown;
  evidenceManifest?: unknown;
  inspectionTrace?: unknown;
};

export type CardReportAgentResponse = {
  content: string;
  provider:
    | "pi-ai-openrouter"
    | "openrouter-direct"
    | "convex-openrouter"
    | "convex-gemini"
    | "convex-openai"
    | "convex-anthropic"
    | "convex-local-fallback"
    | "gemini-direct-fallback"
    | "openai-direct-fallback"
    | "anthropic-direct-fallback"
    | "local-fallback";
  model: string;
  error?: string;
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

const INSPECTION_TOOL_NAMES = [
  "detect_card_boundary",
  "normalize_card",
  "mask_label_region",
  "crop_region",
  "crop_corner",
  "crop_edge_strip",
  "zoom_region",
  "rotate_image",
  "enhance_contrast",
  "generate_glare_mask",
  "run_ding_detector",
  "run_ding_detector_on_crop",
  "run_surface_anomaly_detector",
  "run_severity_scorer",
  "compare_with_certified_reference",
  "compare_before_after",
  "create_human_review_task",
  "cite_evidence",
] as const;

const convexExplainReport = makeFunctionReference<"action", Record<string, unknown>, CardReportAgentResponse>(
  "agentRuntime:explainReport",
);

function convexUrl() {
  return process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function callConvexAgent(input: CardReportAgentInput): Promise<CardReportAgentResponse | null> {
  const url = convexUrl();
  if (!url) return null;
  const client = new ConvexHttpClient(url);
  return await withTimeout(
    client.action(convexExplainReport, {
      cardId: input.cardId,
      prompt: input.prompt,
      reportJson: input.reportJson,
      evidenceManifest: input.evidenceManifest,
    }),
    Number(process.env.CARD_AGENT_CONVEX_TIMEOUT_MS ?? 6000),
    "Convex agent runtime",
  );
}

function textFromAssistantMessage(message: { content?: Array<{ type: string; text?: string }> }) {
  return message.content
    ?.filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("")
    .trim() ?? "";
}

function summarizeFindings(reportJson: unknown) {
  const report = reportJson as { findings?: Array<Record<string, unknown>>; summary?: string; condition_score?: number };
  const findings = Array.isArray(report?.findings) ? report.findings : [];
  const top = findings
    .slice(0, 5)
    .map((finding) => {
      const kind = String(finding.kind ?? "unknown_damage").replaceAll("_", " ");
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

function localExplanation(input: CardReportAgentInput) {
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

function agentPayload(input: CardReportAgentInput) {
  return {
    task: input.prompt,
    cardId: input.cardId,
    report: input.reportJson,
    evidenceManifest: input.evidenceManifest,
    inspectionTrace: input.inspectionTrace,
    availableInspectionTools: INSPECTION_TOOL_NAMES,
    hardRules: [
      "Do not invent DINGs that are absent from report.findings or inspectionTrace annotation candidates.",
      "Do not claim an official grade.",
      "If evidence is missing, ask for crop/zoom/glare/detector reinspection or human review.",
      "Treat LLM-only visual observations as candidate notes until human-reviewed.",
    ],
  };
}

async function callPiAi(input: CardReportAgentInput, apiKey: string, modelName: string): Promise<CardReportAgentResponse> {
  const { complete, getModel, Type } = await import("@mariozechner/pi-ai");
  const reportTools = [
    {
      name: "get_card_report",
      description: "Fetch the saved condition report for a card. The route injects report JSON directly for now.",
      parameters: Type.Object({
        cardId: Type.String(),
      }),
    },
    {
      name: "create_dispute_packet",
      description: "Create a before/after evidence packet summary from existing reports.",
      parameters: Type.Object({
        cardId: Type.String(),
        beforeReportId: Type.String(),
        afterReportId: Type.String(),
      }),
    },
    {
      name: "crop_region",
      description: "Request a replayable crop for a specific card region. Use before reinspection claims.",
      parameters: Type.Object({
        cardId: Type.String(),
        region: Type.String(),
      }),
    },
    {
      name: "run_ding_detector_on_crop",
      description: "Request the ML DING detector on a region crop. Output must ground any candidate DING claim.",
      parameters: Type.Object({
        cardId: Type.String(),
        region: Type.String(),
      }),
    },
    {
      name: "run_glare_check",
      description: "Check whether a suspected surface scratch overlaps glare/specular highlights.",
      parameters: Type.Object({
        cardId: Type.String(),
        region: Type.String(),
      }),
    },
    {
      name: "create_human_review_task",
      description: "Create a human review task for low-confidence, disputed, or LLM-only findings.",
      parameters: Type.Object({
        cardId: Type.String(),
        reason: Type.String(),
        region: Type.String(),
      }),
    },
    {
      name: "cite_evidence",
      description: "Cite evidence hashes/tool outputs that ground a report claim.",
      parameters: Type.Object({
        cardId: Type.String(),
        claim: Type.String(),
      }),
    },
  ];
  const provider = process.env.CARD_AGENT_PROVIDER ?? "openrouter";
  const model = getModel(provider as never, modelName as never);
  const context = {
    systemPrompt: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: JSON.stringify(agentPayload(input)),
        timestamp: Date.now(),
      },
    ],
    tools: reportTools,
  };
  const message = await complete(model, context as never, {
    apiKey,
    temperature: 0.25,
    maxTokens: 700,
  });
  return {
    content: textFromAssistantMessage(message) || localExplanation(input),
    provider: "pi-ai-openrouter",
    model: modelName,
  };
}

async function callOpenRouterDirect(
  input: CardReportAgentInput,
  apiKey: string,
  modelName: string,
): Promise<CardReportAgentResponse> {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
      "X-Title": "Card Condition Vault",
    },
    body: JSON.stringify({
      model: modelName,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: JSON.stringify(agentPayload(input)),
        },
      ],
      temperature: 0.25,
      max_tokens: 700,
    }),
  });
  if (!response.ok) throw new Error(`OpenRouter returned ${response.status}`);
  const body = await response.json();
  return {
    content: String(body.choices?.[0]?.message?.content ?? localExplanation(input)),
    provider: "openrouter-direct",
    model: modelName,
  };
}

async function callOpenAiDirect(
  input: CardReportAgentInput,
  apiKey: string,
  modelName: string,
): Promise<CardReportAgentResponse> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: modelName,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: JSON.stringify(agentPayload(input)),
        },
      ],
      temperature: 0.25,
      max_tokens: 700,
    }),
  });
  if (!response.ok) throw new Error(`OpenAI returned ${response.status}`);
  const body = await response.json();
  return {
    content: String(body.choices?.[0]?.message?.content ?? localExplanation(input)),
    provider: "openai-direct-fallback",
    model: modelName,
  };
}

async function callGeminiDirect(
  input: CardReportAgentInput,
  apiKey: string,
  modelName: string,
): Promise<CardReportAgentResponse> {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [
        {
          role: "user",
          parts: [
            {
              text: JSON.stringify(agentPayload(input)),
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.25,
        maxOutputTokens: 700,
      },
    }),
  });
  if (!response.ok) throw new Error(`Gemini returned ${response.status}`);
  const body = await response.json();
  const text = (body.candidates?.[0]?.content?.parts ?? [])
    .map((part: { text?: string }) => part.text ?? "")
    .join("")
    .trim();
  return {
    content: text || localExplanation(input),
    provider: "gemini-direct-fallback",
    model: modelName,
  };
}

async function callAnthropicDirect(
  input: CardReportAgentInput,
  apiKey: string,
  modelName: string,
): Promise<CardReportAgentResponse> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: modelName,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: JSON.stringify(agentPayload(input)),
        },
      ],
      temperature: 0.25,
      max_tokens: 700,
    }),
  });
  if (!response.ok) throw new Error(`Anthropic returned ${response.status}`);
  const body = await response.json();
  const text = (body.content ?? [])
    .map((part: { type?: string; text?: string }) => (part.type === "text" ? part.text ?? "" : ""))
    .join("")
    .trim();
  return {
    content: text || localExplanation(input),
    provider: "anthropic-direct-fallback",
    model: modelName,
  };
}

export async function explainCardReport(input: CardReportAgentInput): Promise<CardReportAgentResponse> {
  const apiKey = process.env.OPENROUTER_API_KEY ?? "";
  const modelName = process.env.CARD_AGENT_MODEL ?? "google/gemma-4-26b-a4b";
  const errors: string[] = [];
  try {
    const convexResponse = await callConvexAgent(input);
    if (convexResponse) return convexResponse;
    errors.push("Convex agent URL missing");
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "Convex agent runtime failed");
  }

  try {
    if (apiKey) return await callPiAi(input, apiKey, modelName);
    errors.push("OpenRouter key missing");
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "pi-ai failed");
  }
  try {
    if (apiKey) return await callOpenRouterDirect(input, apiKey, modelName);
  } catch (fallbackError) {
    errors.push(fallbackError instanceof Error ? fallbackError.message : "direct OpenRouter fallback failed");
  }

  const geminiKey = process.env.GEMINI_API_KEY ?? "";
  const geminiModel = process.env.CARD_AGENT_GEMINI_MODEL ?? "gemini-2.5-flash";
  try {
    if (geminiKey) return await callGeminiDirect(input, geminiKey, geminiModel);
    errors.push("Gemini fallback key missing");
  } catch (geminiError) {
    errors.push(geminiError instanceof Error ? geminiError.message : "direct Gemini fallback failed");
  }

  const openAiKey = process.env.OPENAI_API_KEY ?? "";
  const openAiModel = process.env.CARD_AGENT_BACKUP_MODEL ?? "gpt-4o-mini";
  try {
    if (openAiKey) return await callOpenAiDirect(input, openAiKey, openAiModel);
    errors.push("OpenAI fallback key missing");
  } catch (openAiError) {
    errors.push(openAiError instanceof Error ? openAiError.message : "direct OpenAI fallback failed");
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY ?? "";
  const anthropicModel = process.env.CARD_AGENT_ANTHROPIC_MODEL ?? "claude-3-5-haiku-latest";
  try {
    if (anthropicKey) return await callAnthropicDirect(input, anthropicKey, anthropicModel);
    errors.push("Anthropic fallback key missing");
  } catch (anthropicError) {
    errors.push(anthropicError instanceof Error ? anthropicError.message : "direct Anthropic fallback failed");
  }

  return {
    content: localExplanation(input),
    provider: "local-fallback",
    model: modelName,
    error: errors.join("; "),
  };
}

export async function explainCardReportWithOpenRouterStrict(
  input: CardReportAgentInput,
): Promise<CardReportAgentResponse> {
  const apiKey = process.env.OPENROUTER_API_KEY ?? "";
  const modelName = process.env.CARD_AGENT_MODEL ?? "google/gemma-4-26b-a4b";
  if (!apiKey) {
    return { content: localExplanation(input), provider: "local-fallback", model: modelName, error: "OpenRouter key missing" };
  }
  try {
    return await callPiAi(input, apiKey, modelName);
  } catch (error) {
    try {
      return await callOpenRouterDirect(input, apiKey, modelName);
    } catch (fallbackError) {
      return {
        content: localExplanation(input),
        provider: "local-fallback",
        model: modelName,
        error: `${error instanceof Error ? error.message : "pi-ai failed"}; ${
          fallbackError instanceof Error ? fallbackError.message : "direct fallback failed"
        }`,
      };
    }
  }
}

export async function completeWorkspaceChat(messages: Array<{ role: string; content: string }>): Promise<CardReportAgentResponse> {
  const latest = messages.at(-1)?.content ?? "Help me operate the card review workflow.";
  return explainCardReport({
    prompt: `Answer this agent workspace request. Do not invent detections or claim official grading: ${latest}`,
    reportJson: {
      summary: "Workspace-level operation request; fetch a saved report before discussing specific DINGS.",
      findings: [],
    },
  });
}
