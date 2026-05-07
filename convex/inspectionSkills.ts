import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const demoOwner = "local-demo";
const productionLikeStatuses = new Set(["canary", "production"]);

export const listCandidates = query({
  args: {
    ownerId: v.optional(v.string()),
    status: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ownerId = args.ownerId ?? demoOwner;
    if (args.status) {
      return await ctx.db
        .query("inspectionSkillCandidates")
        .withIndex("by_owner_status", (q) => q.eq("ownerId", ownerId).eq("status", args.status as string))
        .collect();
    }
    return await ctx.db
      .query("inspectionSkillCandidates")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .collect();
  },
});

export const proposeCandidate = mutation({
  args: {
    ownerId: v.optional(v.string()),
    sourceThreadId: v.optional(v.id("chatThreads")),
    sourceReportId: v.optional(v.id("conditionReports")),
    skillId: v.string(),
    title: v.string(),
    consentScope: v.string(),
    triggerJson: v.string(),
    methodJson: v.string(),
    safetyReviewJson: v.string(),
    createdByAgentVersion: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ownerId = args.ownerId ?? demoOwner;
    const existing = await ctx.db
      .query("inspectionSkillCandidates")
      .withIndex("by_skill_id", (q) => q.eq("skillId", args.skillId))
      .first();
    if (existing) return existing._id;

    const now = Date.now();
    return await ctx.db.insert("inspectionSkillCandidates", {
      ownerId,
      sourceThreadId: args.sourceThreadId,
      sourceReportId: args.sourceReportId,
      skillId: args.skillId,
      title: args.title,
      status: "draft",
      consentScope: args.consentScope,
      triggerJson: args.triggerJson,
      methodJson: args.methodJson,
      safetyReviewJson: args.safetyReviewJson,
      createdByAgentVersion: args.createdByAgentVersion,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const recordBenchmark = mutation({
  args: {
    ownerId: v.optional(v.string()),
    candidateId: v.id("inspectionSkillCandidates"),
    benchmarkName: v.string(),
    datasetVersion: v.string(),
    metricsJson: v.string(),
    passed: v.boolean(),
    evaluator: v.string(),
  },
  handler: async (ctx, args) => {
    const candidate = await ctx.db.get(args.candidateId);
    if (!candidate) throw new Error("Inspection skill candidate not found.");
    const ownerId = args.ownerId ?? candidate.ownerId ?? demoOwner;
    const benchmarkId = await ctx.db.insert("inspectionSkillBenchmarks", {
      ownerId,
      candidateId: args.candidateId,
      benchmarkName: args.benchmarkName,
      datasetVersion: args.datasetVersion,
      metricsJson: args.metricsJson,
      passed: args.passed,
      evaluator: args.evaluator,
      createdAt: Date.now(),
    });
    await ctx.db.patch(args.candidateId, { updatedAt: Date.now() });
    return benchmarkId;
  },
});

export const requestPromotion = mutation({
  args: {
    ownerId: v.optional(v.string()),
    candidateId: v.id("inspectionSkillCandidates"),
    targetStatus: v.string(),
    reason: v.string(),
    promotedBy: v.string(),
    humanApproved: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const candidate = await ctx.db.get(args.candidateId);
    if (!candidate) throw new Error("Inspection skill candidate not found.");
    const ownerId = args.ownerId ?? candidate.ownerId ?? demoOwner;
    const targetStatus = args.targetStatus;

    if (productionLikeStatuses.has(targetStatus)) {
      const benchmarks = await ctx.db
        .query("inspectionSkillBenchmarks")
        .withIndex("by_candidate", (q) => q.eq("candidateId", args.candidateId))
        .collect();
      if (!benchmarks.some((benchmark) => benchmark.passed)) {
        throw new Error("Canary or production promotion requires at least one passed benchmark.");
      }
    }
    if (targetStatus === "production" && !args.humanApproved) {
      throw new Error("Production promotion requires explicit human approval.");
    }

    const promotionId = await ctx.db.insert("inspectionSkillPromotions", {
      ownerId,
      candidateId: args.candidateId,
      fromStatus: candidate.status,
      toStatus: targetStatus,
      reason: args.reason,
      promotedBy: args.promotedBy,
      createdAt: Date.now(),
    });
    await ctx.db.patch(args.candidateId, { status: targetStatus, updatedAt: Date.now() });
    return promotionId;
  },
});
