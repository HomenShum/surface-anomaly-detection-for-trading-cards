import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const demoOwner = "local-demo";

export const startThread = mutation({
  args: { ownerId: v.optional(v.string()), title: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("chatThreads", {
      ownerId: args.ownerId ?? demoOwner,
      title: args.title ?? "Card review",
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const messages = query({
  args: { threadId: v.id("chatThreads") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("chatMessages")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .collect();
  },
});

export const addMessage = mutation({
  args: {
    ownerId: v.optional(v.string()),
    threadId: v.id("chatThreads"),
    role: v.string(),
    content: v.string(),
    operation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.patch(args.threadId, { updatedAt: now });
    return await ctx.db.insert("chatMessages", {
      ownerId: args.ownerId ?? demoOwner,
      threadId: args.threadId,
      role: args.role,
      content: args.content,
      operation: args.operation,
      createdAt: now,
    });
  },
});

export const createAgentJob = mutation({
  args: {
    ownerId: v.optional(v.string()),
    threadId: v.optional(v.id("chatThreads")),
    type: v.string(),
    analysisJobKey: v.optional(v.string()),
    inputJson: v.string(),
  },
  handler: async (ctx, args) => {
    const ownerId = args.ownerId ?? demoOwner;
    if (args.analysisJobKey) {
      const existing = await ctx.db
        .query("agentJobs")
        .withIndex("by_analysis_job_key", (q) =>
          q.eq("ownerId", ownerId).eq("analysisJobKey", args.analysisJobKey),
        )
        .first();
      if (existing) return existing._id;
    }
    return await ctx.db.insert("agentJobs", {
      ownerId,
      threadId: args.threadId,
      type: args.type,
      status: "queued",
      analysisJobKey: args.analysisJobKey,
      retryCount: 0,
      inputJson: args.inputJson,
      createdAt: Date.now(),
    });
  },
});
