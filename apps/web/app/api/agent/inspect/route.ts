import { NextResponse } from "next/server";
import {
  buildToolDescriptors,
  executeTool,
  intentBucketFor,
  type AgentReportContext,
  type ToolName,
  type ToolInputs,
  type ToolCallTrace,
  type AgentUIAction,
} from "../../../../lib/agent/tools";
import { loadUserMemory, mergeUserMemoryFromTrace } from "../../../../lib/agent/user-memory";
import {
  appendMethodTrace,
  bucketGlareScore,
  bucketSurfaceScore,
  matchPromotedSkills,
  type MethodTraceRecord,
} from "../../../../lib/agent/skill-store";

export const runtime = "nodejs";

/**
 * Tool-loop inspection chat endpoint.
 *
 * Contract:
 *   POST { message: string, history: [{role, content}], reportContext: AgentReportContext }
 *   → { content, toolCalls: [...with results...], uiActions: [...], proposedSkillIds: [...], provider, model }
 *
 * Behavior:
 *   - LLM decides which tools to call (up to MAX_ITERS rounds).
 *   - Each tool call is executed locally via `executeTool` against the report context.
 *   - Tool results are appended to the conversation; the LLM gets to reason again.
 *   - If no LLM key is configured, a deterministic local agent runs instead.
 *   - Every run writes one anonymized record to candidates.jsonl.
 */

const MAX_ITERS = 6;

const SYSTEM_PROMPT = `You are Card Condition Vault's report inspection agent.

Your job: answer the user's question about a specific card condition report. You have a tool kit that can: look at findings, fire the zoom-lens animation, crop pixel regions, re-run the detector on a crop, compute glare from pixels, look up the promoted skill registry, cite SHA-256 evidence, generate retake guidance, and propose new inspection methods.

Hard rules — these are not negotiable:
1. NEVER claim something is an official grade (PSA/BGS/CGC). You produce AI-assisted condition signals only.
2. NEVER claim legal proof. Reports are not court evidence.
3. EVERY claim about a finding MUST be backed by a tool call in this turn — no claim from memory.
4. If the surface_score is low or glare_score is high on a holo/glossy finish, default to "glare_uncertain" rather than calling a scratch.
5. If you discover a useful inspection workflow (e.g. "for holo cards with high glare, retake at 20-degree tilt before claiming surface damage"), call propose_inspection_method to log it. It will NOT be activated automatically — it goes to a draft queue for benchmark + human review.
6. If the user mentions a PSA/TAG/CGC/BGS cert (number, URL, or "the slab I sent"), call compare_to_cert_reference (cert_id or provider+cert_number) BEFORE asserting a band. If the tool returns band_agreement=mismatch or adjacent, walk through the self_correction_hints; if any of them surface a reusable pattern, call propose_inspection_method to log a candidate skill. Never claim the predicted band IS the cert's grade — we only claim band agreement / mismatch.

How to use the image-op tools (when imageDataUrl is attached):
- Call crop_finding with index or region to cut a sub-image. The user sees the magnified crop preview.
- Call glare_check_on_crop with the returned crop_id to compute pixel-level glare. Use this to disambiguate "scratch vs glare".
- Call rerun_detector_on_crop with the crop_id to give the YOLO detector a closer look at a low-confidence region. Compare its findings to the original report.

How to use the reasoning tools:
- Call lookup_promoted_skill FIRST when context matches a known pattern (holo + glare, edge wear + low edge_score, etc.). Reuse a promoted method when it fits.
- Call request_zoom_animation BEFORE you describe what you see in a region (only needed if you are NOT already cropping — crop_finding shows the user the same magnified region).
- Call evaluate_glare_risk on holo/glossy finishes before claiming any surface damage (cheap, no pixels).
- Call cite_evidence when the user asks for proof or audit trail.

Style:
- Compact. 4-7 sentences. Use bullet points only when listing 3+ items.
- Honest about uncertainty. Do not pad.
- Reference tool outputs explicitly (e.g. "The glare_check_on_crop tool returned glare_score=0.42 — high"), do not hide them.
- Adapt to the operator memory line if present.`;

type ChatMessage = { role: "system" | "user" | "assistant" | "tool"; content: string; tool_call_id?: string; tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> };

type InspectRequestBody = {
  message: string;
  userId?: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  reportContext: AgentReportContext;
};

function reportContextToContextString(ctx: AgentReportContext): string {
  return JSON.stringify({
    cardId: ctx.cardId,
    summary: ctx.reportSummary,
    conditionScore: ctx.conditionScore,
    surfaceScore: ctx.surfaceScore,
    centeringScore: ctx.centeringScore,
    edgeScore: ctx.edgeScore,
    glareScore: ctx.glareScore,
    finishType: ctx.finishType,
    findings: ctx.findings.map((finding, index) => ({
      index,
      type: finding.type,
      confidence: finding.confidence,
      severity: finding.severity,
      bbox_pct: finding.bbox,
      zone: finding.zone,
    })),
    evidenceFileCount: ctx.evidence.length,
    promotedSkillsAvailable: matchPromotedSkills({
      finishType: ctx.finishType,
      glareScore: ctx.glareScore,
    }).map((skill) => ({ id: skill.skillId, title: skill.title, status: skill.status })),
  });
}

function toolDescriptorsToOpenAI(descriptors: Awaited<ReturnType<typeof buildToolDescriptors>>) {
  return descriptors.map((descriptor) => ({
    type: "function" as const,
    function: {
      name: descriptor.name,
      description: descriptor.description,
      parameters: descriptor.parameters,
    },
  }));
}

function hasContributionIntent(message: string): boolean {
  return /\b(method|workflow|pattern|contribut|open[-\s]?source|registry|benchmark|worked|try this|what if|if we|help future|make the agent|scan better|detect better|guide the agent)\b/i.test(
    message,
  );
}

function safeSkillIdPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 42);
}

async function runOpenRouterToolLoop(input: {
  apiKey: string;
  modelName: string;
  messages: ChatMessage[];
  tools: ReturnType<typeof toolDescriptorsToOpenAI>;
  ctx: AgentReportContext;
}): Promise<{
  finalContent: string;
  toolTraces: ToolCallTrace[];
  uiActions: AgentUIAction[];
  proposedSkillIds: string[];
  iterations: number;
}> {
  const messages = [...input.messages];
  const toolTraces: ToolCallTrace[] = [];
  const uiActions: AgentUIAction[] = [];
  const proposedSkillIds: string[] = [];

  for (let iter = 0; iter < MAX_ITERS; iter += 1) {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
        "X-Title": "Card Condition Vault — Inspect",
      },
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({
        model: input.modelName,
        messages,
        tools: input.tools,
        tool_choice: "auto",
        temperature: 0.2,
        max_tokens: 800,
      }),
    });
    if (!response.ok) throw new Error(`OpenRouter returned ${response.status}: ${(await response.text()).slice(0, 240)}`);
    const body = await response.json();
    const choice = body.choices?.[0];
    const assistantMessage = choice?.message ?? {};
    const toolCalls: NonNullable<ChatMessage["tool_calls"]> = assistantMessage.tool_calls ?? [];

    if (!toolCalls.length) {
      return {
        finalContent: String(assistantMessage.content ?? "No response generated."),
        toolTraces,
        uiActions,
        proposedSkillIds,
        iterations: iter + 1,
      };
    }

    messages.push({ role: "assistant", content: assistantMessage.content ?? "", tool_calls: toolCalls });

    for (const call of toolCalls) {
      let parsedArgs: Record<string, unknown> = {};
      try {
        parsedArgs = JSON.parse(call.function.arguments || "{}");
      } catch {
        parsedArgs = {};
      }
      const toolName = call.function.name as ToolName;
      const result = await executeTool(toolName, parsedArgs as ToolInputs[ToolName], input.ctx);
      toolTraces.push(result.trace);
      if (result.ok && result.uiAction) uiActions.push(result.uiAction);
      if (result.ok && result.proposedSkillId) proposedSkillIds.push(result.proposedSkillId);
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result.content),
      });
    }
  }

  return {
    finalContent: "Tool loop hit MAX_ITERS without final answer. Last tool results are above.",
    toolTraces,
    uiActions,
    proposedSkillIds,
    iterations: MAX_ITERS,
  };
}

/**
 * Local deterministic agent — used when no LLM key is configured.
 * Honest: it runs the same tools the LLM would, follows a fixed plan
 * based on the user's intent, and produces a real answer with citations.
 * No fabricated text.
 */
async function runLocalAgent(input: { message: string; ctx: AgentReportContext }): Promise<{
  finalContent: string;
  toolTraces: ToolCallTrace[];
  uiActions: AgentUIAction[];
  proposedSkillIds: string[];
  iterations: number;
}> {
  const intent = intentBucketFor(input.message);
  const traces: ToolCallTrace[] = [];
  const uiActions: AgentUIAction[] = [];
  const proposedSkillIds: string[] = [];
  const userContributedMethodIdea = hasContributionIntent(input.message);
  let reusableInspectionSignal:
    | {
        findingType: string;
        region: string;
        confidence?: number;
        reason: string;
      }
    | null = null;

  const callTool = async <N extends ToolName>(name: N, args: ToolInputs[N]) => {
    const result = await executeTool(name, args, input.ctx);
    traces.push(result.trace);
    if (result.ok && result.uiAction) uiActions.push(result.uiAction);
    if (result.ok && result.proposedSkillId) proposedSkillIds.push(result.proposedSkillId);
    return result;
  };

  const skillsResult = await callTool("lookup_promoted_skill", {
    finish_type: input.ctx.finishType,
    user_intent: intent,
  });

  const lines: string[] = [];

  if (input.ctx.findings.length === 0) {
    lines.push(`No DING candidates exceeded the detector confidence floor for this report (summary: ${input.ctx.reportSummary}). Empty findings are not proof the card is clean.`);
    if (intent === "retake_question" || intent === "summary_question") {
      const retake = await callTool("recommend_retake", { reasons: ["low_surface_confidence", "glare"] });
      lines.push(`Retake guidance: ${(retake.content as { summary?: string }).summary ?? "see tool output"}.`);
    }
  } else {
    lines.push(`Report has ${input.ctx.findings.length} visible DING candidate(s). Walking the top items:`);
    const top = input.ctx.findings.slice(0, 3);
    const hasImage = Boolean(input.ctx.imageDataUrl);
    const isGlareIntent =
      intent === "glare_question" || intent === "scratch_question" || intent === "dispute_question";
    for (let i = 0; i < top.length; i += 1) {
      const detail = await callTool("get_finding_detail", { index: i });
      const detailContent = detail.content as { region?: string; type?: string; confidence?: number; severity?: string };
      const region = detailContent.region ?? "center";

      // P0.5: when we have pixels AND the user is asking about scratch/glare/dispute,
      // crop the finding and run glare_check_on_crop. This is the OpenAI-style
      // "thinking with images" loop: the agent is provably looking at the pixels.
      let pixelGlareLine: string | null = null;
      if (hasImage && isGlareIntent && i === 0) {
        const crop = await callTool("crop_finding", { index: i, padding_pct: 6 });
        const cropContent = crop.content as { crop_id?: string; error?: string };
        if (cropContent.crop_id) {
          const glareCheck = await callTool("glare_check_on_crop", { crop_id: cropContent.crop_id });
          const gContent = glareCheck.content as { glare_score?: number; finish_hint?: string; interpretation?: string };
          if (typeof gContent.glare_score === "number") {
            reusableInspectionSignal = {
              findingType: detailContent.type ?? "surface_anomaly",
              region,
              confidence: detailContent.confidence,
              reason:
                "The agent cropped a suspected scratch/glare finding and measured pixel glare before explaining uncertainty.",
            };
          }
          if (typeof gContent.glare_score === "number") {
            pixelGlareLine = `  → glare_check_on_crop(${cropContent.crop_id}): score=${gContent.glare_score.toFixed(2)} (${gContent.finish_hint}). ${gContent.interpretation ?? ""}`;
          }
        } else if (cropContent.error) {
          pixelGlareLine = `  → crop_finding failed: ${cropContent.error}`;
        }
      } else {
        await callTool("request_zoom_animation", { region: region as ToolInputs["request_zoom_animation"]["region"], label: detailContent.type });
      }

      const glare = await callTool("evaluate_glare_risk", { region });
      const glareContent = glare.content as { risk?: string; recommendation?: string };
      lines.push(
        `- Finding ${i}: ${detailContent.type?.replaceAll("_", " ")} at ${region.replaceAll("_", " ")}, confidence ${(Math.round((detailContent.confidence ?? 0) * 100))}%, severity ${detailContent.severity}. Glare risk ${glareContent.risk}.`,
      );
      if (pixelGlareLine) lines.push(pixelGlareLine);
      if (glareContent.risk === "high") {
        reusableInspectionSignal ??= {
          findingType: detailContent.type ?? "surface_anomaly",
          region,
          confidence: detailContent.confidence,
          reason:
            "The report had high glare risk, so the agent treated the finding as a candidate for reusable glare-aware reinspection.",
        };
        lines.push(`  → ${glareContent.recommendation}`);
      }
    }
  }

  if (userContributedMethodIdea || reusableInspectionSignal) {
    const firstFinding = input.ctx.findings[0];
    const signal = reusableInspectionSignal ?? {
      findingType: firstFinding?.type ?? "quality_gate",
      region: "center",
      confidence: firstFinding?.confidence,
      reason:
        "The user contributed a reusable inspection idea in chat; it should be evaluated before any shared use.",
    };
    const skillId = `draft_${safeSkillIdPart(intent)}_${safeSkillIdPart(signal.findingType)}_${Date.now()}`;
    const proposal = await callTool("propose_inspection_method", {
      skill_id: skillId,
      title:
        signal.findingType === "quality_gate"
          ? "User-proposed scan quality inspection workflow"
          : "User-proposed glare-aware DING reinspection",
      rationale: `${signal.reason} Source: report chat follow-up. This is a draft only; it must pass benchmark review before public use.`,
      trigger: {
        finish_type: input.ctx.finishType,
        finding_type: signal.findingType,
        region: signal.region,
        user_question_intent: intent,
        max_confidence: signal.confidence,
        min_glare_score: input.ctx.glareScore,
      },
      steps: [
        {
          tool: "crop_region",
          purpose: "Extract the user-mentioned or low-confidence region from the normalized card.",
          region: signal.region,
        },
        {
          tool: "zoom_region",
          purpose: "Show the operator the exact region being inspected before making any claim.",
          region: signal.region,
        },
        {
          tool: "run_glare_check",
          purpose: "Quantify glare so scratch-like marks can be downgraded to glare_uncertain when needed.",
          region: signal.region,
        },
        {
          tool: "run_ding_detector",
          purpose: "Re-run visible DING detection on the magnified region instead of relying on the full-card pass.",
          region: signal.region,
        },
        {
          tool: "explain_uncertainty",
          purpose: "Explain what the tools did and what the user should not conclude without a retake.",
          region: signal.region,
        },
      ],
    });
    if (proposal.ok) {
      const content = proposal.content as { skill_id?: string; status?: string };
      lines.push(
        `Draft method candidate logged: ${content.skill_id ?? skillId} (${content.status ?? "draft"}). It is not public or active until benchmark + human review pass.`,
      );
    }
  }

  if (intent === "dispute_question") {
    const cite = await callTool("cite_evidence", { index: 0 });
    const citeContent = cite.content as { sha256?: string; disclaimer?: string };
    lines.push(`Evidence reference for finding 0: sha256=${citeContent.sha256 ?? "n/a"}. ${citeContent.disclaimer ?? ""}`);
  }

  if (intent === "grading_value_question") {
    lines.push(`This is an alpha AI-assisted condition signal, not an official grade. Use it to decide whether grading submission is worth the cost — do not present it as a final verdict.`);
  }

  const skillsContent = skillsResult.content as { matched_count?: number; skills?: Array<{ title: string }> };
  if ((skillsContent.matched_count ?? 0) > 0) {
    const titles = (skillsContent.skills ?? []).map((skill) => skill.title).join(", ");
    lines.push(`Promoted inspection methods active for this context: ${titles}.`);
  }

  return {
    finalContent: lines.join("\n"),
    toolTraces: traces,
    uiActions,
    proposedSkillIds,
    iterations: 1,
  };
}

export async function POST(request: Request) {
  let body: InspectRequestBody;
  try {
    body = (await request.json()) as InspectRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!body?.message?.trim() || !body?.reportContext) {
    return NextResponse.json({ error: "message and reportContext are required." }, { status: 400 });
  }

  // Default the inference base URL from env so image-op tools can call FastAPI.
  const ctx: AgentReportContext = {
    ...body.reportContext,
    inferenceBaseUrl:
      body.reportContext.inferenceBaseUrl ??
      process.env.INFERENCE_API_URL ??
      process.env.NEXT_PUBLIC_INFERENCE_API_URL ??
      "http://localhost:8000",
  };
  const intent = intentBucketFor(body.message);
  const apiKey = process.env.OPENROUTER_API_KEY ?? "";
  const modelName = process.env.CARD_AGENT_MODEL ?? "google/gemma-2-27b-it";
  const userId = body.userId?.trim() || "anon";
  const memory = loadUserMemory(userId);
  const memorySummary = `Operator memory: ${memory.totalTurns} prior turn(s). Complexity preference: ${memory.explanationComplexity}. Frequent finishes: ${memory.cardFocus.join(", ") || "none"}. Top intents: ${memory.topUserIntents.slice(0, 3).map((entry) => `${entry.intent}×${entry.count}`).join(", ") || "none"}.`;

  let finalContent = "";
  let toolTraces: ToolCallTrace[] = [];
  let uiActions: AgentUIAction[] = [];
  let proposedSkillIds: string[] = [];
  let provider: "openrouter-tool-loop" | "local-tool-loop" = "local-tool-loop";
  let usedModel = modelName;
  let errorNote: string | undefined;

  try {
    if (apiKey) {
      const descriptors = await buildToolDescriptors();
      const messages: ChatMessage[] = [
        { role: "system", content: `${SYSTEM_PROMPT}\n\n${memorySummary}` },
        { role: "user", content: `Report context (read-only):\n${reportContextToContextString(ctx)}` },
        ...(body.history ?? []).map((entry) => ({ role: entry.role, content: entry.content })),
        { role: "user", content: body.message },
      ];
      const result = await runOpenRouterToolLoop({
        apiKey,
        modelName,
        messages,
        tools: toolDescriptorsToOpenAI(descriptors),
        ctx,
      });
      finalContent = result.finalContent;
      toolTraces = result.toolTraces;
      uiActions = result.uiActions;
      proposedSkillIds = result.proposedSkillIds;
      provider = "openrouter-tool-loop";
    } else {
      const result = await runLocalAgent({ message: body.message, ctx });
      finalContent = result.finalContent;
      toolTraces = result.toolTraces;
      uiActions = result.uiActions;
      proposedSkillIds = result.proposedSkillIds;
      usedModel = "local-deterministic-agent";
    }
  } catch (error) {
    errorNote = error instanceof Error ? error.message : "tool loop failed";
    const result = await runLocalAgent({ message: body.message, ctx });
    finalContent = `${result.finalContent}\n\n(Cloud agent unavailable: ${errorNote}. Local agent answered.)`;
    toolTraces = result.toolTraces;
    uiActions = result.uiActions;
    proposedSkillIds = result.proposedSkillIds;
    provider = "local-tool-loop";
    usedModel = "local-deterministic-agent";
  }

  const traceRecord: MethodTraceRecord = {
    traceId: `trace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ts: new Date().toISOString(),
    reportContext: {
      findingsCount: ctx.findings.length,
      surfaceScoreBucket: bucketSurfaceScore(ctx.surfaceScore),
      glareScoreBucket: bucketGlareScore(ctx.glareScore),
      finishType: ctx.finishType,
      userIntentBucket: intent,
    },
    toolSequence: toolTraces.map((trace) => ({
      tool: trace.tool,
      argsKeys: trace.argsKeys,
      durationMs: trace.durationMs,
      ok: trace.ok,
    })),
    outcome: {
      answeredFromTools: toolTraces.length > 0,
      citedFindings: toolTraces.filter((trace) => trace.tool === "cite_evidence" || trace.tool === "get_finding_detail").length,
      proposedSkillId: proposedSkillIds[0],
      refusedAsUngrounded: toolTraces.length === 0 && finalContent.toLowerCase().includes("cannot"),
    },
    modelProvider: provider,
    modelName: usedModel,
  };

  try {
    appendMethodTrace(traceRecord);
  } catch {
    // tracing must never break the response
  }

  let updatedMemorySummary = memorySummary;
  try {
    const updatedMemory = mergeUserMemoryFromTrace({ userId, trace: traceRecord });
    updatedMemorySummary = `Memory updated. ${updatedMemory.totalTurns} total turn(s). Complexity: ${updatedMemory.explanationComplexity}. Top intents: ${updatedMemory.topUserIntents.slice(0, 3).map((e) => `${e.intent}×${e.count}`).join(", ") || "none"}.`;
  } catch {
    // memory write must never break the response
  }

  return NextResponse.json({
    role: "assistant",
    content: finalContent,
    provider,
    model: usedModel,
    toolTraces,
    uiActions,
    proposedSkillIds,
    traceId: traceRecord.traceId,
    userId,
    memorySummary: updatedMemorySummary,
    error: errorNote,
  });
}
