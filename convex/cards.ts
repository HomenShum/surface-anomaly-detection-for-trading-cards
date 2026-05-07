import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const demoOwner = "local-demo";

export const list = query({
  args: { ownerId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("cards")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId ?? demoOwner))
      .order("desc")
      .collect();
  },
});

export const upsertFromAnalysis = mutation({
  args: {
    ownerId: v.optional(v.string()),
    title: v.string(),
    game: v.string(),
    setName: v.string(),
    variant: v.string(),
    conditionBenchmark: v.string(),
    confidence: v.number(),
    notes: v.string(),
    imageDataUrl: v.optional(v.string()),
    scanSessionId: v.optional(v.string()),
    inputSha256: v.optional(v.string()),
    modelVersion: v.optional(v.string()),
    analysisJobKey: v.optional(v.string()),
    qualityWarnings: v.optional(v.array(v.string())),
    detections: v.array(
      v.object({
        type: v.string(),
        zone: v.string(),
        confidence: v.number(),
        severity: v.string(),
        bbox: v.array(v.number()),
        source: v.string(),
      }),
    ),
    evidenceManifestJson: v.string(),
    manifestSha256: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const ownerId = args.ownerId ?? demoOwner;
    if (args.analysisJobKey) {
      const existingSession = await ctx.db
        .query("scanSessions")
        .withIndex("by_analysis_job_key", (q) =>
          q.eq("ownerId", ownerId).eq("analysisJobKey", args.analysisJobKey),
        )
        .first();
      if (existingSession) {
        const report = await ctx.db
          .query("conditionReports")
          .withIndex("by_scan", (q) => q.eq("scanSessionId", existingSession._id))
          .first();
        const manifest = await ctx.db
          .query("evidenceManifests")
          .withIndex("by_scan", (q) => q.eq("scanSessionId", existingSession._id))
          .first();
        return {
          idempotent: true,
          cardId: existingSession.cardId,
          scanSessionId: existingSession._id,
          reportId: report?._id,
          manifestId: manifest?._id,
        };
      }
    }

    const cardId = await ctx.db.insert("cards", {
      ownerId,
      title: args.title,
      game: args.game,
      setName: args.setName,
      variant: args.variant,
      conditionBenchmark: args.conditionBenchmark,
      confidence: args.confidence,
      notes: args.notes,
      createdAt: now,
      updatedAt: now,
    });
    if (args.imageDataUrl) {
      await ctx.db.insert("cardImages", {
        ownerId,
        cardId,
        role: "front_original",
        dataUrlPreview: args.imageDataUrl,
        createdAt: now,
      });
    }
    const scanSessionId = await ctx.db.insert("scanSessions", {
      ownerId,
      cardId,
      status: "completed",
      captureMode: "agent_upload",
      modelVersion: args.modelVersion ?? "ding-detector-v0",
      scanSessionId: args.scanSessionId,
      inputSha256: args.inputSha256,
      analysisJobKey: args.analysisJobKey,
      retryCount: 0,
      qualityWarnings: args.qualityWarnings ?? [],
      createdAt: now,
      completedAt: now,
    });
    for (const detection of args.detections) {
      await ctx.db.insert("detections", {
        ownerId,
        scanSessionId,
        cardId,
        ...detection,
        createdAt: now,
      });
    }
    const reportId = await ctx.db.insert("conditionReports", {
      ownerId,
      cardId,
      scanSessionId,
      summary: args.notes,
      confidence: args.confidence >= 0.75 ? "medium" : "low",
      reportVersion: 1,
      disclaimer:
        "This is a timestamped condition evidence record and AI-assisted condition estimate. It is not an official grade or legal guarantee.",
      createdAt: now,
    });
    const manifestId = await ctx.db.insert("evidenceManifests", {
      ownerId,
      cardId,
      scanSessionId,
      manifestJson: args.evidenceManifestJson,
      manifestSha256: args.manifestSha256,
      createdAt: now,
    });
    return { idempotent: false, cardId, scanSessionId, reportId, manifestId };
  },
});
