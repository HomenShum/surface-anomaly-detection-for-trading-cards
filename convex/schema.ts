import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    authSubject: v.string(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_auth_subject", ["authSubject"]),

  cards: defineTable({
    ownerId: v.string(),
    title: v.string(),
    game: v.string(),
    setName: v.string(),
    variant: v.string(),
    conditionBenchmark: v.string(),
    confidence: v.number(),
    notes: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_owner", ["ownerId"]),

  cardImages: defineTable({
    ownerId: v.string(),
    cardId: v.id("cards"),
    role: v.string(),
    storageId: v.optional(v.id("_storage")),
    dataUrlPreview: v.optional(v.string()),
    sha256: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_card", ["cardId"]),

  scanSessions: defineTable({
    ownerId: v.string(),
    cardId: v.optional(v.id("cards")),
    status: v.string(),
    captureMode: v.string(),
    modelVersion: v.string(),
    scanSessionId: v.optional(v.string()),
    inputSha256: v.optional(v.string()),
    analysisJobKey: v.optional(v.string()),
    retryCount: v.optional(v.number()),
    qualityWarnings: v.array(v.string()),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
  }).index("by_owner", ["ownerId"]).index("by_analysis_job_key", ["ownerId", "analysisJobKey"]),

  detections: defineTable({
    ownerId: v.string(),
    scanSessionId: v.id("scanSessions"),
    cardId: v.optional(v.id("cards")),
    type: v.string(),
    zone: v.string(),
    confidence: v.number(),
    severity: v.string(),
    bbox: v.array(v.number()),
    source: v.string(),
    createdAt: v.number(),
  }).index("by_scan", ["scanSessionId"]),

  conditionReports: defineTable({
    ownerId: v.string(),
    cardId: v.optional(v.id("cards")),
    scanSessionId: v.id("scanSessions"),
    summary: v.string(),
    confidence: v.string(),
    reportVersion: v.number(),
    disclaimer: v.string(),
    createdAt: v.number(),
  }).index("by_scan", ["scanSessionId"]).index("by_card", ["cardId"]),

  evidenceManifests: defineTable({
    ownerId: v.string(),
    cardId: v.optional(v.id("cards")),
    scanSessionId: v.id("scanSessions"),
    manifestJson: v.string(),
    manifestSha256: v.string(),
    createdAt: v.number(),
  }).index("by_scan", ["scanSessionId"]),

  userCorrections: defineTable({
    ownerId: v.string(),
    detectionId: v.optional(v.id("detections")),
    reportId: v.optional(v.id("conditionReports")),
    action: v.string(),
    label: v.string(),
    note: v.string(),
    createdAt: v.number(),
  }).index("by_report", ["reportId"]),

  chatThreads: defineTable({
    ownerId: v.string(),
    title: v.string(),
    activeCardId: v.optional(v.id("cards")),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_owner", ["ownerId"]),

  chatMessages: defineTable({
    ownerId: v.string(),
    threadId: v.id("chatThreads"),
    role: v.string(),
    content: v.string(),
    attachmentStorageId: v.optional(v.id("_storage")),
    operation: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_thread", ["threadId"]),

  agentJobs: defineTable({
    ownerId: v.string(),
    threadId: v.optional(v.id("chatThreads")),
    scanSessionId: v.optional(v.id("scanSessions")),
    type: v.string(),
    status: v.string(),
    analysisJobKey: v.optional(v.string()),
    retryCount: v.optional(v.number()),
    inputJson: v.string(),
    outputJson: v.optional(v.string()),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
  }).index("by_owner", ["ownerId"]).index("by_analysis_job_key", ["ownerId", "analysisJobKey"]),

  inspectionSkillCandidates: defineTable({
    ownerId: v.string(),
    sourceThreadId: v.optional(v.id("chatThreads")),
    sourceReportId: v.optional(v.id("conditionReports")),
    skillId: v.string(),
    title: v.string(),
    status: v.string(),
    consentScope: v.string(),
    triggerJson: v.string(),
    methodJson: v.string(),
    safetyReviewJson: v.string(),
    createdByAgentVersion: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_owner_status", ["ownerId", "status"])
    .index("by_skill_id", ["skillId"]),

  inspectionSkillBenchmarks: defineTable({
    ownerId: v.string(),
    candidateId: v.id("inspectionSkillCandidates"),
    benchmarkName: v.string(),
    datasetVersion: v.string(),
    metricsJson: v.string(),
    passed: v.boolean(),
    evaluator: v.string(),
    createdAt: v.number(),
  }).index("by_candidate", ["candidateId"]),

  inspectionSkillPromotions: defineTable({
    ownerId: v.string(),
    candidateId: v.id("inspectionSkillCandidates"),
    fromStatus: v.string(),
    toStatus: v.string(),
    reason: v.string(),
    promotedBy: v.string(),
    createdAt: v.number(),
  }).index("by_candidate", ["candidateId"]),
});
