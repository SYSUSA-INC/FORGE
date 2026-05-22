/**
 * BL-13 Phase B — zod schemas for the notification rule editor.
 *
 * The schema mirrors what the Drizzle column types allow + the
 * narrower business rules the editor enforces:
 *   - `recipientConfig` is shape-narrowed by `recipientStrategy`
 *   - `escalationStrategy`, when present, mirrors the same shape
 *   - `slaSeconds` accepts a positive integer or null
 *
 * Server actions parse `RuleInputSchema` on every mutation and
 * return a `{ ok: false, error }` shape on parse failure so the
 * client can surface the message without a thrown.
 */
import { z } from "zod";
import {
  FORMULA_KINDS,
  type FormulaKind,
} from "@/lib/notification-rules-types";
import type {
  NotificationChannel,
  NotificationFrequency,
  NotificationRecipientStrategy,
  NotificationTriggerEventKind,
} from "@/db/schema";

// The enum literal sets are kept in sync with the Drizzle pgEnum
// definitions in src/db/schema.ts. If you add a new trigger event
// kind, add it to both places (and to TRIGGER_EVENT_KIND_LABELS in
// notification-rules-types.ts).
const TRIGGER_EVENT_KIND_VALUES: [
  NotificationTriggerEventKind,
  ...NotificationTriggerEventKind[],
] = [
  "opportunity_due_soon",
  "opportunity_advanced",
  "opportunity_no_bid",
  "opportunity_won",
  "opportunity_lost",
  "proposal_created",
  "proposal_advanced",
  "proposal_section_overdue",
  "review_request_pending",
  "review_completed",
  "compliance_overdue",
  "audit_anomaly",
  "membership_invited",
  "membership_disabled",
];

const RECIPIENT_STRATEGY_VALUES: [
  NotificationRecipientStrategy,
  ...NotificationRecipientStrategy[],
] = ["specific_users", "role_based", "formula"];

const CHANNEL_VALUES: [NotificationChannel, ...NotificationChannel[]] = [
  "in_app",
  "email",
  "slack",
  "teams",
];

const FREQUENCY_VALUES: [
  NotificationFrequency,
  ...NotificationFrequency[],
] = ["immediate", "batched_daily", "batched_weekly"];

const ROLE_VALUES = [
  "admin",
  "capture",
  "proposal",
  "author",
  "reviewer",
  "pricing",
  "viewer",
] as const;

// Discriminated union per recipient strategy.
const SpecificUsersConfigSchema = z.object({
  strategy: z.literal("specific_users"),
  config: z.object({
    userIds: z.array(z.string().uuid()).min(1, "Pick at least one user."),
  }),
});

const RoleBasedConfigSchema = z.object({
  strategy: z.literal("role_based"),
  config: z.object({
    roles: z.array(z.enum(ROLE_VALUES)).min(1, "Pick at least one role."),
  }),
});

const FormulaConfigSchema = z.object({
  strategy: z.literal("formula"),
  config: z.object({
    kind: z.enum(FORMULA_KINDS as readonly [FormulaKind, ...FormulaKind[]]),
  }),
});

export const RecipientSchema = z.discriminatedUnion("strategy", [
  SpecificUsersConfigSchema,
  RoleBasedConfigSchema,
  FormulaConfigSchema,
]);

export type RecipientInput = z.infer<typeof RecipientSchema>;

// Escalation is optional. When present, same shape as the primary
// recipient (so the SLA-breach path uses the same resolver logic in
// Phase C / D).
export const EscalationSchema = z
  .object({
    strategy: z.enum(RECIPIENT_STRATEGY_VALUES),
    config: z.record(z.string(), z.unknown()),
  })
  .nullable()
  .optional();

export type EscalationInput = z.infer<typeof EscalationSchema>;

// Full rule input (used for both create + update).
export const RuleInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Rule name is required.")
    .max(128, "Rule name must be 128 characters or less."),
  description: z.string().trim().max(512).default(""),
  triggerEventKind: z.enum(TRIGGER_EVENT_KIND_VALUES),
  // Free-form jsonb; UI surfaces as a JSON textarea. Server only
  // validates that it parses; the dispatcher in Phase C interprets it.
  matchFilter: z.record(z.string(), z.unknown()).default({}),
  recipient: RecipientSchema,
  channels: z.array(z.enum(CHANNEL_VALUES)).min(1, "Pick at least one channel."),
  frequency: z.enum(FREQUENCY_VALUES).default("immediate"),
  // Seconds. 0 = no SLA. We accept null too; both map to "no SLA"
  // at the DB layer.
  slaSeconds: z
    .number()
    .int("SLA must be a whole number of seconds.")
    .min(0)
    .max(60 * 60 * 24 * 30, "SLA cannot exceed 30 days.")
    .nullable()
    .default(null),
  escalation: EscalationSchema,
  active: z.boolean().default(true),
});

export type RuleInput = z.infer<typeof RuleInputSchema>;
