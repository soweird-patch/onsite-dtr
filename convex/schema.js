import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
  users: defineTable({
    name: v.string(), email: v.optional(v.string()), mobile: v.optional(v.string()),
    username: v.optional(v.string()), passwordHash: v.string(),
    role: v.union(v.literal('admin'), v.literal('employee')),
    active: v.boolean(), scheduleStart: v.string(), scheduleEnd: v.string(),
    workdays: v.array(v.number()), graceMinutes: v.number(), createdAt: v.string(),
    profileImageId: v.optional(v.id('_storage')),
    // Kept temporarily so existing cloud documents with the former flag remain valid; the app no longer reads or writes it.
    isDemo: v.optional(v.boolean())
  }).index('by_email', ['email']).index('by_mobile', ['mobile']).index('by_username', ['username']).index('by_role', ['role']),
  sessions: defineTable({
    tokenHash: v.string(), userId: v.id('users'), expiresAt: v.number(), createdAt: v.string()
  }).index('by_hash', ['tokenHash']).index('by_user', ['userId']),
  loginAttempts: defineTable({ email: v.string(), count: v.number(), until: v.number() })
    .index('by_email', ['email']),
  settings: defineTable({
    key: v.string(), siteName: v.string(), siteLat: v.optional(v.number()),
    siteLng: v.optional(v.number()), radiusM: v.number(), maxAccuracyM: v.number(),
    cutoffDays: v.array(v.number()), siteVersion: v.number(), updatedAt: v.string(),
    holidays: v.optional(v.array(v.object({ date: v.string(), name: v.string() }))),
    appName: v.optional(v.string()), logo192Id: v.optional(v.id('_storage')),
    logo512Id: v.optional(v.id('_storage'))
  }).index('by_key', ['key']),
  punches: defineTable({
    userId: v.id('users'), workDate: v.string(), slot: v.union(v.literal('IN'), v.literal('OUT')),
    segment: v.optional(v.number()),
    scheduleStart: v.optional(v.string()), scheduleEnd: v.optional(v.string()),
    method: v.union(v.literal('ONSITE'), v.literal('OFFSITE'), v.literal('ADMIN'), v.literal('SYSTEM')),
    timeUtc: v.string(), submittedAt: v.string(), latitude: v.optional(v.number()),
    longitude: v.optional(v.number()), accuracyM: v.optional(v.number()),
    distanceM: v.optional(v.number()), selfieId: v.optional(v.id('_storage')),
    note: v.string(), verification: v.union(v.literal('PENDING'), v.literal('APPROVED'), v.literal('REJECTED')),
    rejectionReason: v.optional(v.string()), createdBy: v.optional(v.id('users')),
    assignmentType: v.optional(v.union(v.literal('ONSITE'), v.literal('OFFSITE'))),
    reason: v.optional(v.string()), fieldAssignment: v.optional(v.string()),
    reviewedBy: v.optional(v.id('users')), reviewedAt: v.optional(v.string()),
    siteVersion: v.optional(v.number()), active: v.boolean()
  }).index('by_date', ['workDate']).index('by_user_date', ['userId', 'workDate']),
  extensions: defineTable({
    userId: v.id('users'), workDate: v.string(), continuedAt: v.string(),
    calculationKey: v.optional(v.string()),
    source: v.union(v.literal('OFFSITE'), v.literal('ADMIN'), v.literal('AUTO')),
    latitude: v.optional(v.number()), longitude: v.optional(v.number()),
    accuracyM: v.optional(v.number()), note: v.string(),
    overtimeDecision: v.union(v.literal('PENDING'), v.literal('APPROVED'), v.literal('REJECTED')),
    adjustmentDecision: v.optional(v.union(v.literal('PENDING'), v.literal('APPROVED'), v.literal('REJECTED'))),
    nightDecision: v.union(v.literal('PENDING'), v.literal('APPROVED'), v.literal('REJECTED')),
    adjustmentReason: v.optional(v.string()), overtimeReason: v.optional(v.string()), nightReason: v.optional(v.string()),
    adjustmentReviewedBy: v.optional(v.id('users')), adjustmentReviewedAt: v.optional(v.string()),
    overtimeReviewedBy: v.optional(v.id('users')), nightReviewedBy: v.optional(v.id('users')),
    overtimeReviewedAt: v.optional(v.string()), nightReviewedAt: v.optional(v.string())
  }).index('by_date', ['workDate']).index('by_user_date', ['userId', 'workDate']),
  overtime: defineTable({
    userId: v.id('users'), workDate: v.string(), minutes: v.number(), note: v.string(),
    setBy: v.id('users'), updatedAt: v.string()
  }).index('by_date', ['workDate']).index('by_user_date', ['userId', 'workDate']),
  audit: defineTable({
    actorId: v.optional(v.id('users')), action: v.string(), targetType: v.string(),
    targetId: v.string(), details: v.any(), createdAt: v.string()
  }).index('by_created', ['createdAt'])
});
