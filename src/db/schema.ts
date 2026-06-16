import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Drizzle ships no first-class bytea — BL-9's yjs_doc.state column
// holds Y.encodeStateAsUpdate() binary blobs that are written by the
// Hocuspocus service. Reads from the Next app surface as Uint8Array.
const bytea = customType<{ data: Uint8Array; default: false }>({
  dataType() {
    return "bytea";
  },
});

export const roleEnum = pgEnum("role", [
  "admin",
  "capture",
  "proposal",
  "author",
  "reviewer",
  "pricing",
  "viewer",
]);

export const membershipStatusEnum = pgEnum("membership_status", [
  "active",
  "disabled",
]);

export const opportunityStageEnum = pgEnum("opportunity_stage", [
  "identified",
  "sources_sought",
  "qualification",
  "capture",
  "pre_proposal",
  "writing",
  "submitted",
  "won",
  "lost",
  "no_bid",
]);

export const users = pgTable("user", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: timestamp("emailVerified", { mode: "date" }),
  image: text("image"),
  passwordHash: text("password_hash"),
  isSuperadmin: boolean("is_superadmin").notNull().default(false),
  disabledAt: timestamp("disabled_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const accounts = pgTable(
  "account",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (account) => ({
    compoundKey: primaryKey({
      columns: [account.provider, account.providerAccountId],
    }),
  }),
);

export const sessions = pgTable("session", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "verificationToken",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (vt) => ({
    compoundKey: primaryKey({ columns: [vt.identifier, vt.token] }),
  }),
);

export const organizations = pgTable("organization", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: varchar("slug", { length: 64 }).notNull().unique(),
  website: text("website").notNull().default(""),

  contactName: text("contact_name").notNull().default(""),
  contactTitle: text("contact_title").notNull().default(""),
  phone: text("phone").notNull().default(""),
  email: text("email").notNull().default(""),

  addressLine1: text("address_line1").notNull().default(""),
  addressLine2: text("address_line2").notNull().default(""),
  city: text("city").notNull().default(""),
  state: text("state").notNull().default(""),
  zip: text("zip").notNull().default(""),
  country: text("country").notNull().default("USA"),

  uei: text("uei").notNull().default(""),
  cageCode: text("cage_code").notNull().default(""),
  dunsNumber: text("duns_number").notNull().default(""),

  companySecurityLevel: text("company_security_level").notNull().default("None"),
  employeeSecurityLevel: text("employee_security_level").notNull().default("None"),
  dcaaCompliant: boolean("dcaa_compliant").notNull().default(false),

  primaryNaics: text("primary_naics").notNull().default(""),
  naicsList: text("naics_list")
    .array()
    .notNull()
    .default(sql`ARRAY[]::text[]`),
  pscCodes: text("psc_codes")
    .array()
    .notNull()
    .default(sql`ARRAY[]::text[]`),

  socioEconomic: jsonb("socio_economic")
    .$type<{
      sba8a: boolean;
      smallBusiness: boolean;
      sdb: boolean;
      wosb: boolean;
      sdvosb: boolean;
      hubzone: boolean;
    }>()
    .notNull()
    .default({
      sba8a: false,
      smallBusiness: false,
      sdb: false,
      wosb: false,
      sdvosb: false,
      hubzone: false,
    }),

  contractingVehicles: jsonb("contracting_vehicles")
    .$type<
      {
        id: string;
        name: string;
        category: "civilian" | "dow";
        isCustom: boolean;
      }[]
    >()
    .notNull()
    .default(sql`'[]'::jsonb`),

  pastPerformance: jsonb("past_performance")
    .$type<
      {
        id: string;
        customer: string;
        contract: string;
        value: string;
        periodStart: string;
        periodEnd: string;
        description: string;
      }[]
    >()
    .notNull()
    .default(sql`'[]'::jsonb`),

  searchKeywords: text("search_keywords")
    .array()
    .notNull()
    .default(sql`ARRAY[]::text[]`),

  syncSource: text("sync_source").notNull().default("none"),
  lastSyncedAt: timestamp("last_synced_at"),

  disabledAt: timestamp("disabled_at"),

  // BL-15 Phase B-2 — pointer to the tenant's primary admin. Nullable
  // because an org could in theory have no admins (after disabling
  // the last one). Used by the SuperAdmin transfer-ownership flow.
  primaryAdminUserId: text("primary_admin_user_id").references(
    () => users.id,
    { onDelete: "set null" },
  ),

  // BL-12c — per-tenant audit-log retention window. Daily cron at
  // /api/cron/prune-audit-logs deletes rows older than this. Bounded
  // 90–3650 days at the action layer; the DB column is wider so
  // operators can adjust the floor without a migration if needed.
  auditRetentionDays: integer("audit_retention_days").notNull().default(365),

  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const memberships = pgTable(
  "membership",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    role: roleEnum("role").notNull().default("viewer"),
    status: membershipStatusEnum("status").notNull().default("active"),
    title: text("title"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (m) => ({
    pk: primaryKey({ columns: [m.userId, m.organizationId] }),
  }),
);

export const allowlist = pgTable("allowlist", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  role: roleEnum("role").notNull().default("viewer"),
  title: text("title"),
  invitedByUserId: text("invited_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  invitedAt: timestamp("invited_at").notNull().defaultNow(),
  consumedAt: timestamp("consumed_at"),
  revoked: boolean("revoked").notNull().default(false),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
export type Membership = typeof memberships.$inferSelect;
export type NewMembership = typeof memberships.$inferInsert;
export type Allowlist = typeof allowlist.$inferSelect;
export type NewAllowlist = typeof allowlist.$inferInsert;
export type Role = (typeof roleEnum.enumValues)[number];
export type MembershipStatus = (typeof membershipStatusEnum.enumValues)[number];

export const opportunities = pgTable("opportunity", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  agency: text("agency").notNull().default(""),
  office: text("office").notNull().default(""),
  stage: opportunityStageEnum("stage").notNull().default("identified"),
  solicitationNumber: text("solicitation_number").notNull().default(""),
  noticeId: text("notice_id").notNull().default(""),
  valueLow: text("value_low").notNull().default(""),
  valueHigh: text("value_high").notNull().default(""),
  releaseDate: timestamp("release_date", { mode: "date" }),
  responseDueDate: timestamp("response_due_date", { mode: "date" }),
  awardDate: timestamp("award_date", { mode: "date" }),
  naicsCode: text("naics_code").notNull().default(""),
  pscCode: text("psc_code").notNull().default(""),
  setAside: text("set_aside").notNull().default(""),
  contractType: text("contract_type").notNull().default(""),
  placeOfPerformance: text("place_of_performance").notNull().default(""),
  incumbent: text("incumbent").notNull().default(""),
  description: text("description").notNull().default(""),
  pWin: integer("p_win").notNull().default(0),
  ownerUserId: text("owner_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  createdByUserId: text("created_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  organizationIdIdx: index("opportunity_organization_id_idx").on(t.organizationId),
}));

export type Opportunity = typeof opportunities.$inferSelect;
export type NewOpportunity = typeof opportunities.$inferInsert;
export type OpportunityStage = (typeof opportunityStageEnum.enumValues)[number];

export const opportunityActivityKindEnum = pgEnum("opportunity_activity_kind", [
  "note",
  "meeting",
  "action",
  "stage_change",
  "gate_decision",
  "evaluation_update",
  "competitor_update",
  "owner_change",
]);

export const opportunityActivities = pgTable("opportunity_activity", {
  id: uuid("id").primaryKey().defaultRandom(),
  opportunityId: uuid("opportunity_id")
    .notNull()
    .references(() => opportunities.id, { onDelete: "cascade" }),
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  kind: opportunityActivityKindEnum("kind").notNull().default("note"),
  title: text("title").notNull().default(""),
  body: text("body").notNull().default(""),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const opportunityReviewRecommendationEnum = pgEnum(
  "opportunity_review_recommendation",
  ["pending", "bid", "no_bid", "more_info"],
);

/**
 * Quick-action review request — capture manager sends an opportunity
 * to a teammate (or external email) for a Bid / No-bid / More-info
 * recommendation. The token-authed magic link works without a login
 * so external reviewers can answer too.
 */
export const opportunityReviewRequests = pgTable(
  "opportunity_review_request",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    opportunityId: uuid("opportunity_id")
      .notNull()
      .references(() => opportunities.id, { onDelete: "cascade" }),
    senderUserId: text("sender_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    // Set when reviewer is an in-platform user. Nullable for external.
    reviewerUserId: text("reviewer_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    // Always populated — used for both in-platform and external addressing.
    reviewerEmail: text("reviewer_email").notNull(),
    reviewerName: text("reviewer_name").notNull().default(""),
    // Opaque random token. Index is unique so lookups can be cheap.
    token: text("token").notNull().unique(),
    note: text("note").notNull().default(""),
    expiresAt: timestamp("expires_at").notNull(),
    completedAt: timestamp("completed_at"),
    recommendation: opportunityReviewRecommendationEnum("recommendation")
      .notNull()
      .default("pending"),
    comment: text("comment").notNull().default(""),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
);

export type OpportunityReviewRequest =
  typeof opportunityReviewRequests.$inferSelect;
export type NewOpportunityReviewRequest =
  typeof opportunityReviewRequests.$inferInsert;
export type OpportunityReviewRecommendation =
  (typeof opportunityReviewRecommendationEnum.enumValues)[number];

export const opportunityCompetitors = pgTable("opportunity_competitor", {
  id: uuid("id").primaryKey().defaultRandom(),
  opportunityId: uuid("opportunity_id")
    .notNull()
    .references(() => opportunities.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  isIncumbent: boolean("is_incumbent").notNull().default(false),
  pastPerformance: text("past_performance").notNull().default(""),
  strengths: text("strengths").notNull().default(""),
  weaknesses: text("weaknesses").notNull().default(""),
  notes: text("notes").notNull().default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const opportunityEvaluations = pgTable("opportunity_evaluation", {
  opportunityId: uuid("opportunity_id")
    .primaryKey()
    .references(() => opportunities.id, { onDelete: "cascade" }),
  strategicFit: integer("strategic_fit").notNull().default(0),
  customerRelationship: integer("customer_relationship").notNull().default(0),
  competitivePosture: integer("competitive_posture").notNull().default(0),
  resourceAvailability: integer("resource_availability").notNull().default(0),
  financialAttractiveness: integer("financial_attractiveness").notNull().default(0),
  rationale: text("rationale").notNull().default(""),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type OpportunityActivity = typeof opportunityActivities.$inferSelect;
export type NewOpportunityActivity = typeof opportunityActivities.$inferInsert;
export type OpportunityActivityKind =
  (typeof opportunityActivityKindEnum.enumValues)[number];
export type OpportunityCompetitor = typeof opportunityCompetitors.$inferSelect;
export type NewOpportunityCompetitor = typeof opportunityCompetitors.$inferInsert;
export type OpportunityEvaluation = typeof opportunityEvaluations.$inferSelect;
export type NewOpportunityEvaluation = typeof opportunityEvaluations.$inferInsert;

export const proposalStageEnum = pgEnum("proposal_stage", [
  "draft",
  "pink_team",
  "red_team",
  "gold_team",
  "white_gloves",
  "submitted",
  "awarded",
  "lost",
  "no_bid",
  "archived",
]);

export const proposalSectionKindEnum = pgEnum("proposal_section_kind", [
  "executive_summary",
  "technical",
  "management",
  "past_performance",
  "pricing",
  "compliance",
]);

export const proposalSectionStatusEnum = pgEnum("proposal_section_status", [
  "not_started",
  "in_progress",
  "draft_complete",
  "in_review",
  "approved",
]);

export const proposals = pgTable("proposal", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  opportunityId: uuid("opportunity_id")
    .notNull()
    .references(() => opportunities.id, { onDelete: "cascade" }),
  templateId: uuid("template_id").references((): AnyPgColumn => proposalTemplates.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  stage: proposalStageEnum("stage").notNull().default("draft"),
  submittedAt: timestamp("submitted_at", { mode: "date" }),
  proposalManagerUserId: text("proposal_manager_user_id").references(
    () => users.id,
    { onDelete: "set null" },
  ),
  captureManagerUserId: text("capture_manager_user_id").references(
    () => users.id,
    { onDelete: "set null" },
  ),
  pricingLeadUserId: text("pricing_lead_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  notes: text("notes").notNull().default(""),
  createdByUserId: text("created_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  organizationIdIdx: index("proposal_organization_id_idx").on(t.organizationId),
}));

export const proposalSections = pgTable("proposal_section", {
  id: uuid("id").primaryKey().defaultRandom(),
  proposalId: uuid("proposal_id")
    .notNull()
    .references(() => proposals.id, { onDelete: "cascade" }),
  kind: proposalSectionKindEnum("kind").notNull(),
  title: text("title").notNull(),
  ordering: integer("ordering").notNull().default(0),
  content: text("content").notNull().default(""),
  bodyDoc: jsonb("body_doc")
    .$type<TipTapDoc>()
    .notNull()
    .default({ type: "doc", content: [] }),
  status: proposalSectionStatusEnum("status").notNull().default("not_started"),
  wordCount: integer("word_count").notNull().default(0),
  pageLimit: integer("page_limit"),
  authorUserId: text("author_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  proposalIdIdx: index("proposal_section_proposal_id_idx").on(t.proposalId),
}));

export type TipTapDoc = {
  type: "doc";
  content: TipTapNode[];
};
export type TipTapNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TipTapNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
};

export type Proposal = typeof proposals.$inferSelect;
export type NewProposal = typeof proposals.$inferInsert;
export type ProposalStage = (typeof proposalStageEnum.enumValues)[number];
export type ProposalSection = typeof proposalSections.$inferSelect;
export type NewProposalSection = typeof proposalSections.$inferInsert;
export type ProposalSectionKind =
  (typeof proposalSectionKindEnum.enumValues)[number];
export type ProposalSectionStatus =
  (typeof proposalSectionStatusEnum.enumValues)[number];

export const companyRelationshipEnum = pgEnum("company_relationship", [
  "customer",
  "prime",
  "subcontractor",
  "competitor",
  "teaming_partner",
  "watchlist",
]);

export const companies = pgTable("company", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  uei: text("uei").notNull().default(""),
  cageCode: text("cage_code").notNull().default(""),
  dunsNumber: text("duns_number").notNull().default(""),
  website: text("website").notNull().default(""),
  email: text("email").notNull().default(""),
  phone: text("phone").notNull().default(""),
  contactName: text("contact_name").notNull().default(""),
  contactTitle: text("contact_title").notNull().default(""),
  addressLine1: text("address_line1").notNull().default(""),
  addressLine2: text("address_line2").notNull().default(""),
  city: text("city").notNull().default(""),
  state: text("state").notNull().default(""),
  zip: text("zip").notNull().default(""),
  country: text("country").notNull().default("USA"),
  primaryNaics: text("primary_naics").notNull().default(""),
  naicsList: text("naics_list")
    .array()
    .notNull()
    .default(sql`ARRAY[]::text[]`),
  sbaCertifications: text("sba_certifications")
    .array()
    .notNull()
    .default(sql`ARRAY[]::text[]`),
  registrationStatus: text("registration_status").notNull().default(""),
  registrationExpirationDate: timestamp("registration_expiration_date"),
  relationship: companyRelationshipEnum("relationship")
    .notNull()
    .default("watchlist"),
  notes: text("notes").notNull().default(""),
  syncSource: text("sync_source").notNull().default("manual"),
  lastSyncedAt: timestamp("last_synced_at"),
  createdByUserId: text("created_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  organizationIdIdx: index("company_organization_id_idx").on(t.organizationId),
}));

export type Company = typeof companies.$inferSelect;
export type NewCompany = typeof companies.$inferInsert;
export type CompanyRelationship =
  (typeof companyRelationshipEnum.enumValues)[number];

export const reviewColorEnum = pgEnum("review_color", [
  "pink",
  "red",
  "gold",
  "white_gloves",
]);

export const reviewStatusEnum = pgEnum("review_status", [
  "scheduled",
  "in_progress",
  "complete",
  "cancelled",
]);

export const reviewVerdictEnum = pgEnum("review_verdict", [
  "pass",
  "conditional",
  "fail",
]);

export const proposalReviews = pgTable("proposal_review", {
  id: uuid("id").primaryKey().defaultRandom(),
  proposalId: uuid("proposal_id")
    .notNull()
    .references(() => proposals.id, { onDelete: "cascade" }),
  color: reviewColorEnum("color").notNull(),
  status: reviewStatusEnum("status").notNull().default("scheduled"),
  verdict: reviewVerdictEnum("verdict"),
  summary: text("summary").notNull().default(""),
  dueDate: timestamp("due_date"),
  startedByUserId: text("started_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  startedAt: timestamp("started_at"),
  closedAt: timestamp("closed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const proposalReviewAssignments = pgTable(
  "proposal_review_assignment",
  {
    reviewId: uuid("review_id")
      .notNull()
      .references(() => proposalReviews.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sectionId: uuid("section_id").references(() => proposalSections.id, {
      onDelete: "set null",
    }),
    verdict: reviewVerdictEnum("verdict"),
    summary: text("summary").notNull().default(""),
    submittedAt: timestamp("submitted_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.reviewId, t.userId] }),
  }),
);

export const proposalReviewComments = pgTable("proposal_review_comment", {
  id: uuid("id").primaryKey().defaultRandom(),
  reviewId: uuid("review_id")
    .notNull()
    .references(() => proposalReviews.id, { onDelete: "cascade" }),
  sectionId: uuid("section_id").references(() => proposalSections.id, {
    onDelete: "set null",
  }),
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  body: text("body").notNull(),
  resolved: boolean("resolved").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type ProposalReview = typeof proposalReviews.$inferSelect;
export type NewProposalReview = typeof proposalReviews.$inferInsert;
export type ReviewColor = (typeof reviewColorEnum.enumValues)[number];
export type ReviewStatus = (typeof reviewStatusEnum.enumValues)[number];
export type ReviewVerdict = (typeof reviewVerdictEnum.enumValues)[number];
export type ProposalReviewAssignment =
  typeof proposalReviewAssignments.$inferSelect;
export type NewProposalReviewAssignment =
  typeof proposalReviewAssignments.$inferInsert;
export type ProposalReviewComment = typeof proposalReviewComments.$inferSelect;
export type NewProposalReviewComment =
  typeof proposalReviewComments.$inferInsert;

export const complianceCategoryEnum = pgEnum("compliance_category", [
  "section_l",
  "section_m",
  "section_c",
  "far_clause",
  "other",
]);

export const complianceStatusEnum = pgEnum("compliance_status", [
  "not_addressed",
  "partial",
  "complete",
  "not_applicable",
]);

/**
 * Phase 14c — compliance pre-flight AI assessment.
 *
 * Stored alongside the human-set `status` so the AI never overwrites
 * a reviewer's call. The UI surfaces this as a "Pre-flight says…"
 * chip with a one-click "Accept" action.
 */
export type ComplianceAIAssessment = {
  suggestedStatus: ComplianceStatus;
  confidence: "high" | "medium" | "low";
  gap: string;
  suggestion: string;
  model: string;
};

export const complianceItems = pgTable("compliance_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  proposalId: uuid("proposal_id")
    .notNull()
    .references(() => proposals.id, { onDelete: "cascade" }),
  category: complianceCategoryEnum("category").notNull().default("section_l"),
  number: text("number").notNull().default(""),
  requirementText: text("requirement_text").notNull(),
  volume: text("volume").notNull().default(""),
  rfpPageReference: text("rfp_page_reference").notNull().default(""),
  proposalSectionId: uuid("proposal_section_id").references(
    () => proposalSections.id,
    { onDelete: "set null" },
  ),
  proposalPageReference: text("proposal_page_reference").notNull().default(""),
  status: complianceStatusEnum("status").notNull().default("not_addressed"),
  notes: text("notes").notNull().default(""),
  ordering: integer("ordering").notNull().default(0),
  ownerUserId: text("owner_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  createdByUserId: text("created_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  // Phase 14c — last AI pre-flight result for this item.
  aiAssessment: jsonb("ai_assessment").$type<ComplianceAIAssessment | null>(),
  aiAssessedAt: timestamp("ai_assessed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  proposalIdIdx: index("compliance_item_proposal_id_idx").on(t.proposalId),
}));

export type ComplianceItem = typeof complianceItems.$inferSelect;
export type NewComplianceItem = typeof complianceItems.$inferInsert;
export type ComplianceCategory =
  (typeof complianceCategoryEnum.enumValues)[number];
export type ComplianceStatus =
  (typeof complianceStatusEnum.enumValues)[number];

export const notificationKindEnum = pgEnum("notification_kind", [
  "review_assigned",
  "review_section_assigned",
  "review_comment_mentioned",
  "review_completed",
  "opportunity_review_completed",
  "solicitation_role_assigned",
]);

export const notifications = pgTable("notification", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  recipientUserId: text("recipient_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  actorUserId: text("actor_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  kind: notificationKindEnum("kind").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull().default(""),
  linkPath: text("link_path").notNull().default(""),
  proposalId: uuid("proposal_id").references(() => proposals.id, {
    onDelete: "cascade",
  }),
  reviewId: uuid("review_id").references(() => proposalReviews.id, {
    onDelete: "cascade",
  }),
  commentId: uuid("comment_id").references(() => proposalReviewComments.id, {
    onDelete: "set null",
  }),
  emailSentAt: timestamp("email_sent_at"),
  emailError: text("email_error").notNull().default(""),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  recipientUserIdIdx: index("notification_recipient_user_id_idx").on(t.recipientUserId),
}));

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
export type NotificationKind = (typeof notificationKindEnum.enumValues)[number];

// ─────────────────────────────────────────────────────────────────────
// BL-13 — Notification rules engine
//
// notification_rule:    the configurable rule itself
// notification_delivery: per-rule, per-recipient delivery + SLA tracking
//
// Distinct from `notification` above, which is the in-app inbox row.
// A single delivery may correspond to zero or one inbox rows depending
// on the channel (in_app fans out to `notification`; email/slack/teams
// go to the external system and update sent_at on the delivery row).
// ─────────────────────────────────────────────────────────────────────

export const notificationTriggerEventKindEnum = pgEnum(
  "notification_trigger_event_kind",
  [
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
    "review_assignment_added",
    "compliance_overdue",
    "audit_anomaly",
    "membership_invited",
    "membership_disabled",
    "comment_mentioned",
    "opportunity_reviewed",
    "solicitation_role_assigned",
  ],
);

export const notificationRecipientStrategyEnum = pgEnum(
  "notification_recipient_strategy",
  ["specific_users", "role_based", "formula", "mentioned_in_payload"],
);

export const notificationChannelEnum = pgEnum("notification_channel", [
  "in_app",
  "email",
  "slack",
  "teams",
]);

export const notificationFrequencyEnum = pgEnum("notification_frequency", [
  "immediate",
  "batched_daily",
  "batched_weekly",
]);

export const notificationRules = pgTable(
  "notification_rule",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    triggerEventKind: notificationTriggerEventKindEnum(
      "trigger_event_kind",
    ).notNull(),
    /** Additional filtering on the trigger payload. Empty object = match all. */
    matchFilter: jsonb("match_filter")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    recipientStrategy: notificationRecipientStrategyEnum(
      "recipient_strategy",
    ).notNull(),
    /**
     * Shape depends on recipientStrategy:
     *   specific_users: { userIds: string[] }
     *   role_based:     { roles: Role[] }
     *   formula:        { kind: "proposal_owner" | "opportunity_owner"
     *                          | "capture_mgr" | "pricing_lead" | "section_author" }
     */
    recipientConfig: jsonb("recipient_config")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    channels: notificationChannelEnum("channels")
      .array()
      .notNull()
      .default(sql`ARRAY['in_app']::notification_channel[]`),
    frequency: notificationFrequencyEnum("frequency")
      .notNull()
      .default("immediate"),
    /** Seconds to wait for acknowledgement before flagging breach. NULL = no SLA. */
    slaSeconds: integer("sla_seconds"),
    /**
     * Fallback recipient when the SLA breaches. Same shape as the primary
     * recipient strategy, but stored as one jsonb blob:
     *   { strategy: <enum>, config: { ... } }
     * NULL = no escalation.
     */
    escalationStrategy: jsonb("escalation_strategy").$type<{
      strategy:
        | "specific_users"
        | "role_based"
        | "formula"
        | "mentioned_in_payload";
      config: Record<string, unknown>;
    } | null>(),
    active: boolean("active").notNull().default(true),
    createdByUserId: text("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    orgActiveIdx: index("notification_rule_org_active_idx").on(
      t.organizationId,
      t.active,
    ),
    orgEventIdx: index("notification_rule_org_event_idx").on(
      t.organizationId,
      t.triggerEventKind,
    ),
  }),
);

export const notificationDeliveries = pgTable(
  "notification_delivery",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Denormalized for tenant-isolation enforcement at the query layer. */
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    ruleId: uuid("rule_id")
      .notNull()
      .references(() => notificationRules.id, { onDelete: "cascade" }),
    /** Denormalized so we can filter by event kind without joining the rule. */
    triggerEventKind: notificationTriggerEventKindEnum(
      "trigger_event_kind",
    ).notNull(),
    /** The payload that fired the rule (opportunityId, proposalId, etc.). */
    triggerPayload: jsonb("trigger_payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    /**
     * Resolved at dispatch time from the rule's recipientStrategy. NULL for
     * batched-pending rows (will be set when the batch materializes).
     */
    recipientUserId: text("recipient_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    channel: notificationChannelEnum("channel").notNull(),
    sentAt: timestamp("sent_at"),
    ackedAt: timestamp("acked_at"),
    slaBreachedAt: timestamp("sla_breached_at"),
    escalatedAt: timestamp("escalated_at"),
    error: text("error").notNull().default(""),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    orgRuleIdx: index("notification_delivery_org_rule_idx").on(
      t.organizationId,
      t.ruleId,
      t.createdAt,
    ),
    recipientIdx: index("notification_delivery_recipient_idx").on(
      t.recipientUserId,
      t.createdAt,
    ),
    // Cron query (BL-13 Phase D): scan for unacked deliveries past SLA.
    // Mirrors the partial index in drizzle/0039_notification_rules.sql.
    slaPendingIdx: index("notification_delivery_sla_pending_idx")
      .on(t.organizationId, t.sentAt)
      .where(sql`"acked_at" IS NULL AND "sla_breached_at" IS NULL`),
  }),
);

export type NotificationRule = typeof notificationRules.$inferSelect;
export type NewNotificationRule = typeof notificationRules.$inferInsert;
export type NotificationDelivery = typeof notificationDeliveries.$inferSelect;
export type NewNotificationDelivery = typeof notificationDeliveries.$inferInsert;
export type NotificationTriggerEventKind =
  (typeof notificationTriggerEventKindEnum.enumValues)[number];
export type NotificationRecipientStrategy =
  (typeof notificationRecipientStrategyEnum.enumValues)[number];
export type NotificationChannel = (typeof notificationChannelEnum.enumValues)[number];
export type NotificationFrequency =
  (typeof notificationFrequencyEnum.enumValues)[number];

export const proposalOutcomeTypeEnum = pgEnum("proposal_outcome_type", [
  "won",
  "lost",
  "no_bid",
  "withdrawn",
]);

export const proposalOutcomeReasonEnum = pgEnum("proposal_outcome_reason", [
  "price",
  "technical",
  "past_performance",
  "management",
  "relationship",
  "schedule",
  "requirements_fit",
  "competition",
  "compliance_gap",
  "other",
]);

export const proposalDebriefStatusEnum = pgEnum("proposal_debrief_status", [
  "not_requested",
  "requested",
  "scheduled",
  "held",
  "declined_by_govt",
  "not_offered",
  "waived",
]);

export const proposalDebriefFormatEnum = pgEnum("proposal_debrief_format", [
  "written",
  "oral",
  "both",
  "unknown",
]);

export const proposalOutcomes = pgTable("proposal_outcome", {
  id: uuid("id").primaryKey().defaultRandom(),
  proposalId: uuid("proposal_id")
    .notNull()
    .unique()
    .references(() => proposals.id, { onDelete: "cascade" }),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  outcomeType: proposalOutcomeTypeEnum("outcome_type").notNull(),
  awardValue: text("award_value").notNull().default(""),
  decisionDate: timestamp("decision_date", { mode: "date" }),
  reasons: text("reasons")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  summary: text("summary").notNull().default(""),
  lessonsLearned: text("lessons_learned").notNull().default(""),
  followUpActions: text("follow_up_actions").notNull().default(""),
  awardedToCompetitor: text("awarded_to_competitor").notNull().default(""),
  createdByUserId: text("created_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const proposalDebriefs = pgTable("proposal_debrief", {
  id: uuid("id").primaryKey().defaultRandom(),
  proposalId: uuid("proposal_id")
    .notNull()
    .unique()
    .references(() => proposals.id, { onDelete: "cascade" }),
  outcomeId: uuid("outcome_id").references(() => proposalOutcomes.id, {
    onDelete: "set null",
  }),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  status: proposalDebriefStatusEnum("status").notNull().default("not_requested"),
  format: proposalDebriefFormatEnum("format").notNull().default("unknown"),
  requestedAt: timestamp("requested_at", { mode: "date" }),
  scheduledFor: timestamp("scheduled_for", { mode: "date" }),
  heldOn: timestamp("held_on", { mode: "date" }),
  governmentAttendees: text("government_attendees").notNull().default(""),
  ourAttendees: text("our_attendees").notNull().default(""),
  strengths: text("strengths").notNull().default(""),
  weaknesses: text("weaknesses").notNull().default(""),
  improvements: text("improvements").notNull().default(""),
  pastPerformanceCitation: text("past_performance_citation")
    .notNull()
    .default(""),
  notes: text("notes").notNull().default(""),
  createdByUserId: text("created_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type ProposalOutcome = typeof proposalOutcomes.$inferSelect;
export type NewProposalOutcome = typeof proposalOutcomes.$inferInsert;
export type ProposalOutcomeType =
  (typeof proposalOutcomeTypeEnum.enumValues)[number];
export type ProposalOutcomeReason =
  (typeof proposalOutcomeReasonEnum.enumValues)[number];
export type ProposalDebrief = typeof proposalDebriefs.$inferSelect;
export type NewProposalDebrief = typeof proposalDebriefs.$inferInsert;
export type ProposalDebriefStatus =
  (typeof proposalDebriefStatusEnum.enumValues)[number];
export type ProposalDebriefFormat =
  (typeof proposalDebriefFormatEnum.enumValues)[number];

/**
 * Phase 14f — proposal-vs-winner analysis.
 *
 * After a loss with awardedToCompetitor set + a debrief, the AI
 * compares our submission to what we know about the winner and
 * stores a structured side-by-side. Read once, render the panel,
 * and re-run when new debrief details arrive.
 *
 * One row per proposal — re-runs UPDATE in place.
 */
export const proposalWinnerAnalyses = pgTable(
  "proposal_winner_analysis",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    proposalId: uuid("proposal_id")
      .notNull()
      .unique()
      .references(() => proposals.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    competitorName: text("competitor_name").notNull().default(""),
    /** AI-summarized profile of the winner — past performance, vehicles, agencies, scale. */
    winnerProfileSummary: text("winner_profile_summary").notNull().default(""),
    /** Concrete capability or evidence gaps the AI judges contributed to the loss. */
    gapsWeHad: text("gaps_we_had").notNull().default(""),
    /** Strengths in our submission the debrief didn't credit — useful for protests / future bids. */
    ourStrengthsUnrecognized: text("our_strengths_unrecognized")
      .notNull()
      .default(""),
    /** Specific actions the team should take before the next bid against this competitor. */
    recommendations: text("recommendations").notNull().default(""),
    /** USAspending evidence rows the AI was shown — JSON array of competitor awards. */
    sourceUsaspending: jsonb("source_usaspending")
      .$type<
        {
          piid: string;
          agency: string;
          value: string;
          periodStart: string;
          periodEnd: string;
          description: string;
        }[]
      >()
      .notNull()
      .default(sql`'[]'::jsonb`),
    model: text("model").notNull().default(""),
    stubbed: boolean("stubbed").notNull().default(false),
    createdByUserId: text("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
);

export type ProposalWinnerAnalysis =
  typeof proposalWinnerAnalyses.$inferSelect;
export type NewProposalWinnerAnalysis =
  typeof proposalWinnerAnalyses.$inferInsert;

/**
 * Templates can be either:
 *   - "docx": user uploads a real Word template (header, footer,
 *     graphics, cover page, TOC, page numbers all baked into the
 *     .docx). Variables substitute via docxtemplater on render.
 *     This is the v2 / preferred path.
 *   - "html": legacy HTML/CSS rendered through the PDF pipeline.
 *     Kept for backwards-compat; new templates default to docx.
 */
export const proposalTemplateKindEnum = pgEnum("proposal_template_kind", [
  "html",
  "docx",
]);

export const proposalTemplates = pgTable("proposal_template", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  isDefault: boolean("is_default").notNull().default(false),
  archivedAt: timestamp("archived_at"),

  kind: proposalTemplateKindEnum("kind").notNull().default("html"),

  // === HTML/CSS path (legacy) ===
  // Kept for templates created before the docx pipeline. New templates
  // should pick `kind: "docx"` and leave these empty.
  coverHtml: text("cover_html").notNull().default(""),
  headerHtml: text("header_html").notNull().default(""),
  footerHtml: text("footer_html").notNull().default(""),
  pageCss: text("page_css").notNull().default(""),

  // === DOCX path (preferred) ===
  // Storage path of the uploaded .docx, plus original filename + size
  // for display. variablesDetected lists the {placeholder} names we
  // pulled from the document on upload — surfaced in the UI as a
  // "variables found" check so the user knows what'll be substituted.
  docxStoragePath: text("docx_storage_path").notNull().default(""),
  docxFileName: text("docx_file_name").notNull().default(""),
  docxFileSize: integer("docx_file_size").notNull().default(0),
  docxUploadedAt: timestamp("docx_uploaded_at"),
  variablesDetected: jsonb("variables_detected")
    .$type<string[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),

  // Section seed list — array of { kind, title, ordering }
  sectionSeed: jsonb("section_seed")
    .$type<TemplateSectionSeed[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),

  // Branding tokens (still useful for HTML kind + PDF wrapper).
  brandPrimary: text("brand_primary").notNull().default("#2DD4BF"),
  brandAccent: text("brand_accent").notNull().default("#EC4899"),
  fontDisplay: text("font_display").notNull().default("Inter"),
  fontBody: text("font_body").notNull().default("Inter"),
  logoUrl: text("logo_url").notNull().default(""),

  createdByUserId: text("created_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type ProposalTemplateKind =
  (typeof proposalTemplateKindEnum.enumValues)[number];

export type TemplateSectionSeed = {
  kind: ProposalSectionKind;
  title: string;
  ordering: number;
  pageLimit?: number | null;
};

export type ProposalTemplate = typeof proposalTemplates.$inferSelect;
export type NewProposalTemplate = typeof proposalTemplates.$inferInsert;

export const proposalPdfRenders = pgTable("proposal_pdf_render", {
  id: uuid("id").primaryKey().defaultRandom(),
  proposalId: uuid("proposal_id")
    .notNull()
    .references(() => proposals.id, { onDelete: "cascade" }),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  templateId: uuid("template_id").references(() => proposalTemplates.id, {
    onDelete: "set null",
  }),
  renderedByUserId: text("rendered_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  /** Where the rendered artifact lives (R2 object key, or "stub:<id>" for stub mode). */
  storagePath: text("storage_path").notNull(),
  /** "pdf" for live renders, "html" for stub-mode renders. */
  contentType: text("content_type").notNull().default("pdf"),
  byteSize: integer("byte_size").notNull().default(0),
  pageCount: integer("page_count").notNull().default(0),
  /** Provider that produced this render: "browserless" / "stub". */
  provider: text("provider").notNull().default("stub"),
  /** Optional URL stored at render time (signed URL or public path). Used for download. */
  downloadUrl: text("download_url").notNull().default(""),
  expiresAt: timestamp("expires_at"),
  renderedAt: timestamp("rendered_at").notNull().defaultNow(),
});

export type ProposalPdfRender = typeof proposalPdfRenders.$inferSelect;
export type NewProposalPdfRender = typeof proposalPdfRenders.$inferInsert;

export const solicitationParseStatusEnum = pgEnum("solicitation_parse_status", [
  "uploaded",
  "parsing",
  "parsed",
  "failed",
]);

export const solicitationTypeEnum = pgEnum("solicitation_type", [
  "rfp",
  "rfi",
  "rfq",
  "sources_sought",
  "other",
]);

export const solicitations = pgTable("solicitation", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  title: text("title").notNull().default(""),
  agency: text("agency").notNull().default(""),
  office: text("office").notNull().default(""),
  type: solicitationTypeEnum("type").notNull().default("other"),
  solicitationNumber: text("solicitation_number").notNull().default(""),
  noticeId: text("notice_id").notNull().default(""),
  naicsCode: text("naics_code").notNull().default(""),
  setAside: text("set_aside").notNull().default(""),
  responseDueDate: timestamp("response_due_date", { mode: "date" }),
  postedDate: timestamp("posted_date", { mode: "date" }),
  source: text("source").notNull().default("uploaded"),

  // File metadata
  fileName: text("file_name").notNull().default(""),
  fileSize: integer("file_size").notNull().default(0),
  contentType: text("content_type").notNull().default(""),
  storagePath: text("storage_path").notNull().default(""),

  // Parsing state
  parseStatus: solicitationParseStatusEnum("parse_status")
    .notNull()
    .default("uploaded"),
  parseError: text("parse_error").notNull().default(""),
  rawText: text("raw_text").notNull().default(""),

  // AI-extracted summaries
  sectionLSummary: text("section_l_summary").notNull().default(""),
  sectionMSummary: text("section_m_summary").notNull().default(""),
  extractedRequirements: jsonb("extracted_requirements")
    .$type<
      {
        kind: "shall" | "should" | "may";
        text: string;
        ref: string;
      }[]
    >()
    .notNull()
    .default(sql`'[]'::jsonb`),

  // Link to created opportunity, if converted
  opportunityId: uuid("opportunity_id").references(() => opportunities.id, {
    onDelete: "set null",
  }),

  uploadedByUserId: text("uploaded_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type Solicitation = typeof solicitations.$inferSelect;
export type NewSolicitation = typeof solicitations.$inferInsert;
export type SolicitationParseStatus =
  (typeof solicitationParseStatusEnum.enumValues)[number];
export type SolicitationType =
  (typeof solicitationTypeEnum.enumValues)[number];

/**
 * Per-solicitation team roles. Distinct from the org-level membership
 * role (admin/capture/proposal/etc.) — these describe what a person
 * does on THIS specific solicitation. A user can hold multiple
 * solicitation roles on the same solicitation.
 */
export const solicitationRoleEnum = pgEnum("solicitation_role", [
  "capture_lead",
  "proposal_manager",
  "technical_lead",
  "pricing_lead",
  "compliance_reviewer",
  "color_team_reviewer",
  "subject_matter_expert",
  "contributor",
  "observer",
]);

/**
 * Phase 13a: solicitation team assignments.
 *
 * Capture managers assemble a team per solicitation — capture lead,
 * tech lead, pricing lead, reviewers, SMEs. Each row links a user to
 * a solicitation with a role and optional notes.
 *
 * Composite primary key on (solicitation_id, user_id, role) so the
 * same user can hold multiple roles on one solicitation but not the
 * same role twice.
 */
export const solicitationAssignments = pgTable(
  "solicitation_assignment",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    solicitationId: uuid("solicitation_id")
      .notNull()
      .references(() => solicitations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: solicitationRoleEnum("role").notNull(),
    notes: text("notes").notNull().default(""),
    assignedByUserId: text("assigned_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    assignedAt: timestamp("assigned_at").notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.solicitationId, t.userId, t.role] }),
  }),
);

export type SolicitationAssignment =
  typeof solicitationAssignments.$inferSelect;
export type NewSolicitationAssignment =
  typeof solicitationAssignments.$inferInsert;
export type SolicitationRole =
  (typeof solicitationRoleEnum.enumValues)[number];

export const knowledgeKindEnum = pgEnum("knowledge_kind", [
  "capability",
  "past_performance",
  "personnel",
  "boilerplate",
]);

/**
 * Phase 14a — outcome-aware Brain.
 *
 * Each knowledge artifact (and the entries derived from it) carries
 * the proposal outcome the artifact came from. Lets the section
 * drafter prefer "won" content when retrieving via embeddings, and
 * lets the /knowledge-base UI filter by outcome.
 *
 * Default `none` covers entries that aren't tied to a proposal
 * outcome (manually authored boilerplate, historical capability
 * briefs uploaded as standalone artifacts, etc.).
 */
export const knowledgeOutcomeLabelEnum = pgEnum("knowledge_outcome_label", [
  "none",
  "won",
  "lost",
  "no_bid",
  "withdrawn",
]);

export type KnowledgeOutcomeLabel =
  (typeof knowledgeOutcomeLabelEnum.enumValues)[number];

export const knowledgeEntries = pgTable("knowledge_entry", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  kind: knowledgeKindEnum("kind").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  tags: text("tags")
    .array()
    .notNull()
    .default(sql`ARRAY[]::text[]`),
  // Used for past_performance / personnel / capability metadata; opaque jsonb.
  metadata: jsonb("metadata")
    .$type<Record<string, string | number | boolean>>()
    .notNull()
    .default({}),
  // Light reuse counter — increments any time the entry is referenced from a
  // proposal section drafter / template. Keeps the autonomy ladder honest
  // about which assets actually get used.
  reuseCount: integer("reuse_count").notNull().default(0),
  // Phase 14a — outcome-aware Brain. Inherited from the source artifact
  // when promoted via the extraction queue; remains `none` for manually
  // authored entries until an admin tags them.
  outcomeLabel: knowledgeOutcomeLabelEnum("outcome_label")
    .notNull()
    .default("none"),
  // BL-10 Phase D-1 — quality score (0..1) + per-factor breakdown.
  // NULL until the entry has been scored. Phase D-2 wires automatic
  // scoring on create/update; today the columns exist for the helper
  // to populate when called.
  qualityScore: real("quality_score"),
  qualityScoreFactors: jsonb("quality_score_factors")
    .$type<Record<string, number>>()
    .notNull()
    .default({}),
  qualityScoredAt: timestamp("quality_scored_at"),
  // Phase 10f: real embedding for semantic Brain Suggest. Stored as
  // text on the JS side; the actual column type is `vector(1536)` —
  // see drizzle/0023 migration. Same provider/dim as the chunk
  // table so we don't have to recreate the column to swap.
  embedding: text("embedding"),
  embeddedAt: timestamp("embedded_at"),
  archivedAt: timestamp("archived_at"),
  createdByUserId: text("created_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  organizationIdIdx: index("knowledge_entry_organization_id_idx").on(t.organizationId),
}));

export type KnowledgeEntry = typeof knowledgeEntries.$inferSelect;
export type NewKnowledgeEntry = typeof knowledgeEntries.$inferInsert;
export type KnowledgeKind = (typeof knowledgeKindEnum.enumValues)[number];

/**
 * Knowledge artifacts — the raw corpus the FORGE Brain reads to build
 * its intelligence. Anything that gives historical context about the
 * organization belongs here: old proposals, RFPs we responded to,
 * contracts, debriefs, CPARS reports, capability briefs, resumes,
 * brochures, white papers, customer emails, technical specs, notes.
 *
 * Derived structured knowledge (knowledgeEntries) extracts from
 * artifacts. The artifact is the receipt; the entry is the polished
 * output. knowledgeEntries.sourceArtifactId carries the provenance
 * link so every derived entry can trace back to its origin.
 */
export const knowledgeArtifactKindEnum = pgEnum("knowledge_artifact_kind", [
  "proposal",
  "rfp",
  "contract",
  "cpars",
  "debrief",
  "capability_brief",
  "resume",
  "brochure",
  "whitepaper",
  "email",
  "note",
  "image",
  "spreadsheet",
  "deck",
  "other",
]);

export const knowledgeArtifactSourceEnum = pgEnum("knowledge_artifact_source", [
  "uploaded",
  "mined_from_proposal",
  "inbound_email",
  "imported",
]);

export const knowledgeArtifactStatusEnum = pgEnum("knowledge_artifact_status", [
  "uploaded",
  "extracting_text",
  "indexed",
  "failed",
]);

export const knowledgeArtifacts = pgTable("knowledge_artifact", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  kind: knowledgeArtifactKindEnum("kind").notNull().default("other"),
  source: knowledgeArtifactSourceEnum("source").notNull().default("uploaded"),
  title: text("title").notNull().default(""),
  // Free-form tags chosen by the user OR proposed by the AI on ingest.
  tags: text("tags")
    .array()
    .notNull()
    .default(sql`ARRAY[]::text[]`),
  // File metadata — null for artifacts created from inline pastes.
  fileName: text("file_name").notNull().default(""),
  fileSize: integer("file_size").notNull().default(0),
  contentType: text("content_type").notNull().default(""),
  storagePath: text("storage_path").notNull().default(""),
  // Extracted plain text from the file. Capped at 500 KB on insert.
  rawText: text("raw_text").notNull().default(""),
  status: knowledgeArtifactStatusEnum("status").notNull().default("uploaded"),
  statusError: text("status_error").notNull().default(""),
  // Set when text extraction completes; later set when chunks are
  // embedded once the embeddings ladder ships.
  indexedAt: timestamp("indexed_at"),
  // Phase 14a — outcome-aware Brain. For artifacts harvested from a
  // submitted proposal (source='mined_from_proposal'), this gets set
  // to the proposal's outcome when the outcome is recorded. Defaults
  // to 'none' for everything else.
  outcomeLabel: knowledgeOutcomeLabelEnum("outcome_label")
    .notNull()
    .default("none"),
  // Opaque metadata: ai-suggested kind, ai-suggested tags, source URL,
  // page count, etc.
  metadata: jsonb("metadata")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  // BL-10 Phase B-1 — classifier output captured at extraction time,
  // separate from `kind` (which is the applied value). Surfaces in
  // the artifact row UI as an "AI suggests: <X>" pill when the
  // suggestion differs from the current kind.
  aiSuggestedKind: knowledgeArtifactKindEnum("ai_suggested_kind"),
  aiClassificationConfidence: real("ai_classification_confidence"),
  aiClassificationReasoning: text("ai_classification_reasoning")
    .notNull()
    .default(""),
  uploadedByUserId: text("uploaded_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  archivedAt: timestamp("archived_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  organizationIdIdx: index("knowledge_artifact_organization_id_idx").on(t.organizationId),
}));

export type KnowledgeArtifact = typeof knowledgeArtifacts.$inferSelect;
export type NewKnowledgeArtifact = typeof knowledgeArtifacts.$inferInsert;
export type KnowledgeArtifactKind =
  (typeof knowledgeArtifactKindEnum.enumValues)[number];
export type KnowledgeArtifactSource =
  (typeof knowledgeArtifactSourceEnum.enumValues)[number];
export type KnowledgeArtifactStatus =
  (typeof knowledgeArtifactStatusEnum.enumValues)[number];

/**
 * Phase 10c — Brain extraction pipeline.
 *
 * The Brain reads each knowledge_artifact and proposes structured
 * knowledge_entry candidates (capabilities, past performance, named
 * personnel, boilerplate). Candidates land in a review queue; the
 * user approves or rejects each one. Approved candidates are promoted
 * to knowledge_entry rows so the existing UI surfaces them.
 *
 * extraction_run captures one AI pass over an artifact (prompt
 * version, model, status, count) so we can re-run when a prompt
 * improves and see what changed.
 */
export const knowledgeExtractionRunStatusEnum = pgEnum(
  "knowledge_extraction_run_status",
  ["queued", "running", "completed", "failed"],
);

export const knowledgeExtractionDecisionEnum = pgEnum(
  "knowledge_extraction_decision",
  ["pending", "approved", "rejected", "merged"],
);

export const knowledgeExtractionRuns = pgTable("knowledge_extraction_run", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  artifactId: uuid("artifact_id")
    .notNull()
    .references(() => knowledgeArtifacts.id, { onDelete: "cascade" }),
  status: knowledgeExtractionRunStatusEnum("status")
    .notNull()
    .default("queued"),
  promptVersion: text("prompt_version").notNull().default("v1"),
  provider: text("provider").notNull().default(""),
  model: text("model").notNull().default(""),
  candidateCount: integer("candidate_count").notNull().default(0),
  errorMessage: text("error_message").notNull().default(""),
  startedAt: timestamp("started_at"),
  finishedAt: timestamp("finished_at"),
  startedByUserId: text("started_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const knowledgeExtractionCandidates = pgTable(
  "knowledge_extraction_candidate",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    runId: uuid("run_id")
      .notNull()
      .references(() => knowledgeExtractionRuns.id, { onDelete: "cascade" }),
    artifactId: uuid("artifact_id")
      .notNull()
      .references(() => knowledgeArtifacts.id, { onDelete: "cascade" }),
    // Mirrors knowledge_kind so approved candidates can be promoted
    // straight into knowledge_entry without translation.
    kind: knowledgeKindEnum("kind").notNull(),
    title: text("title").notNull().default(""),
    body: text("body").notNull().default(""),
    tags: text("tags")
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    // The slice of artifact text the AI used as evidence — surfaced in
    // the review UI so reviewers can verify before approving.
    sourceExcerpt: text("source_excerpt").notNull().default(""),
    decision: knowledgeExtractionDecisionEnum("decision")
      .notNull()
      .default("pending"),
    decidedByUserId: text("decided_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    decidedAt: timestamp("decided_at"),
    // Once approved + promoted to a knowledge_entry, this records the
    // resulting entry id so we can avoid double-promotion and link
    // back from the review UI.
    promotedEntryId: uuid("promoted_entry_id").references(
      () => knowledgeEntries.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
);

export type KnowledgeExtractionRun =
  typeof knowledgeExtractionRuns.$inferSelect;
export type NewKnowledgeExtractionRun =
  typeof knowledgeExtractionRuns.$inferInsert;
export type KnowledgeExtractionRunStatus =
  (typeof knowledgeExtractionRunStatusEnum.enumValues)[number];
export type KnowledgeExtractionCandidate =
  typeof knowledgeExtractionCandidates.$inferSelect;
export type NewKnowledgeExtractionCandidate =
  typeof knowledgeExtractionCandidates.$inferInsert;
export type KnowledgeExtractionDecision =
  (typeof knowledgeExtractionDecisionEnum.enumValues)[number];

/**
 * Phase 10d — semantic search across the corpus.
 *
 * Each artifact's raw_text is split into ~2k-char chunks with overlap
 * and each chunk gets a 1536-dim embedding (OpenAI text-embedding-3-
 * small in live mode; deterministic stub vectors in stub mode so the
 * UI is testable without an API key).
 *
 * Cosine similarity queries run via raw SQL using pgvector's `<=>`
 * operator. The migration enables the extension and creates an
 * IVFFlat index. Drizzle treats the `embedding` column as text on
 * the JS side and we serialize/deserialize the array ourselves.
 */
export const KNOWLEDGE_EMBEDDING_DIM = 1536;

export const knowledgeArtifactChunks = pgTable("knowledge_artifact_chunk", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  artifactId: uuid("artifact_id")
    .notNull()
    .references(() => knowledgeArtifacts.id, { onDelete: "cascade" }),
  chunkIndex: integer("chunk_index").notNull(),
  content: text("content").notNull(),
  // Stored as text on the Drizzle side because pgvector isn't a
  // first-class drizzle type. The actual column type is
  // `vector(1536)` — the migration creates it. Reads parse JSON;
  // writes serialize via `[1.0,2.0,...]::vector` casts in raw SQL.
  embedding: text("embedding"),
  tokenCount: integer("token_count").notNull().default(0),
  charStart: integer("char_start").notNull().default(0),
  charEnd: integer("char_end").notNull().default(0),
  embeddingProvider: text("embedding_provider").notNull().default(""),
  embeddingModel: text("embedding_model").notNull().default(""),
  embeddedAt: timestamp("embedded_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type KnowledgeArtifactChunk =
  typeof knowledgeArtifactChunks.$inferSelect;
export type NewKnowledgeArtifactChunk =
  typeof knowledgeArtifactChunks.$inferInsert;

// ────────────────────────────────────────────────────────────────────
// Rate limiting (audit PR-5)
// ────────────────────────────────────────────────────────────────────

export const rateLimitCounters = pgTable(
  "rate_limit_counter",
  {
    key: text("key").notNull(),
    windowStart: timestamp("window_start").notNull(),
    count: integer("count").notNull().default(0),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.key, t.windowStart] }),
    updatedAtIdx: index("rate_limit_counter_updated_at_idx").on(t.updatedAt),
  }),
);

export type RateLimitCounter = typeof rateLimitCounters.$inferSelect;

// ────────────────────────────────────────────────────────────────────
// Customer-suggested opportunity sources (BL-6)
// ────────────────────────────────────────────────────────────────────

export const opportunitySourceRequestStatusEnum = pgEnum(
  "opportunity_source_request_status",
  ["pending", "under_review", "shipped", "rejected"],
);

export type OpportunitySourceRequestStatus =
  (typeof opportunitySourceRequestStatusEnum.enumValues)[number];

export const opportunitySourceRequests = pgTable(
  "opportunity_source_request",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    requesterUserId: text("requester_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    sourceName: text("source_name").notNull().default(""),
    description: text("description").notNull().default(""),
    /** Optional sample paste so the platform team can prototype against a real example. */
    sampleText: text("sample_text").notNull().default(""),
    status: opportunitySourceRequestStatusEnum("status")
      .notNull()
      .default("pending"),
    /** Platform-side triage notes. Super-admin only writes to this. */
    platformNotes: text("platform_notes").notNull().default(""),
    /** Set whenever status changes; powers "moved to under_review 3d ago". */
    statusChangedAt: timestamp("status_changed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    orgCreatedIdx: index("opportunity_source_request_org_created_idx").on(
      t.organizationId,
      t.createdAt,
    ),
    statusCreatedIdx: index(
      "opportunity_source_request_status_created_idx",
    ).on(t.status, t.createdAt),
  }),
);

export type OpportunitySourceRequest =
  typeof opportunitySourceRequests.$inferSelect;
export type NewOpportunitySourceRequest =
  typeof opportunitySourceRequests.$inferInsert;

// ────────────────────────────────────────────────────────────────────
// AI document review + Capability Matrix + Question Generator (BL-23)
// ────────────────────────────────────────────────────────────────────

export const solicitationReviewStatusEnum = pgEnum(
  "solicitation_review_status",
  ["pending", "running", "complete", "failed"],
);

export type SolicitationReviewStatus =
  (typeof solicitationReviewStatusEnum.enumValues)[number];

/**
 * Structured AI output stored on solicitation_review.result.
 * Mirrors the shape returned by the review prompt; consumed by both
 * the matrix and the question-set actions.
 */
export type SolicitationReviewResult = {
  /** 1-2 paragraph plain-prose synopsis. */
  summary: string;
  /** Section L (instructions) bullet points. */
  sectionL: string[];
  /** Section M (evaluation factors) bullet points with weights when stated. */
  sectionM: string[];
  /** Discrete requirements with kind + citation. */
  requirements: {
    id: string;
    kind: "shall" | "should" | "may";
    text: string;
    sectionRef: string;
    capabilityArea: string;
  }[];
  /** Capability buckets the model surfaces — used as the rows of the matrix. */
  capabilityAreas: string[];
  evaluationFactors: { name: string; weight: string; notes: string }[];
  periodOfPerformance: string;
  placeOfPerformance: string;
  setAside: string;
  /** Mandatory certifications / clearance requirements. */
  mandatoryCertifications: string[];
  /** Questions the model itself flagged during the review (separate from the question generator output). */
  flaggedQuestions: string[];
};

export const solicitationReviews = pgTable(
  "solicitation_review",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    solicitationId: uuid("solicitation_id")
      .notNull()
      .references(() => solicitations.id, { onDelete: "cascade" }),
    status: solicitationReviewStatusEnum("status")
      .notNull()
      .default("pending"),
    result: jsonb("result")
      .$type<SolicitationReviewResult>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    error: text("error").notNull().default(""),
    model: text("model").notNull().default(""),
    stubbed: boolean("stubbed").notNull().default(false),
    createdByUserId: text("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    completedAt: timestamp("completed_at"),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    orgSolicitationUq: uniqueIndex(
      "solicitation_review_org_solicitation_uq",
    ).on(t.organizationId, t.solicitationId),
    statusIdx: index("solicitation_review_status_idx").on(
      t.organizationId,
      t.status,
    ),
  }),
);

export type SolicitationReview = typeof solicitationReviews.$inferSelect;
export type NewSolicitationReview = typeof solicitationReviews.$inferInsert;

/** One cell in the capability matrix. */
export type CapabilityMatrixCell = {
  requirementId: string;
  /** "knowledge:<entryId>" or "" if no supporting evidence found. */
  capabilityRef: string;
  status: "strong" | "partial" | "gap" | "not_addressed";
  /** Verbatim slice from the supporting knowledge entry, if any. */
  citation: string;
  /** 1-2 sentence narrative explaining the fit (or the gap). */
  narrative: string;
};

export const solicitationCapabilityMatrices = pgTable(
  "solicitation_capability_matrix",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    solicitationId: uuid("solicitation_id")
      .notNull()
      .references(() => solicitations.id, { onDelete: "cascade" }),
    solicitationReviewId: uuid("solicitation_review_id")
      .notNull()
      .references(() => solicitationReviews.id, { onDelete: "cascade" }),
    cells: jsonb("cells")
      .$type<CapabilityMatrixCell[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    pwinRecommendationLow: integer("pwin_recommendation_low")
      .notNull()
      .default(0),
    pwinRecommendationHigh: integer("pwin_recommendation_high")
      .notNull()
      .default(0),
    model: text("model").notNull().default(""),
    stubbed: boolean("stubbed").notNull().default(false),
    createdByUserId: text("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    orgSolicitationUq: uniqueIndex(
      "solicitation_capability_matrix_org_solicitation_uq",
    ).on(t.organizationId, t.solicitationId),
  }),
);

export type SolicitationCapabilityMatrix =
  typeof solicitationCapabilityMatrices.$inferSelect;
export type NewSolicitationCapabilityMatrix =
  typeof solicitationCapabilityMatrices.$inferInsert;

/** One question in a generated question set. */
export type SolicitationQuestion = {
  id: string;
  category:
    | "scope_ambiguity"
    | "evaluation_criteria"
    | "submission_logistics"
    | "technical_constraints"
    | "security_clearance"
    | "subcontracting";
  text: string;
  rationale: string;
  /** e.g. "L.5.2.1", "M-3", "C.3" — references back into the source doc. */
  sectionRef: string;
};

export const solicitationQuestionSets = pgTable(
  "solicitation_question_set",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    solicitationId: uuid("solicitation_id")
      .notNull()
      .references(() => solicitations.id, { onDelete: "cascade" }),
    solicitationReviewId: uuid("solicitation_review_id")
      .notNull()
      .references(() => solicitationReviews.id, { onDelete: "cascade" }),
    questions: jsonb("questions")
      .$type<SolicitationQuestion[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    model: text("model").notNull().default(""),
    stubbed: boolean("stubbed").notNull().default(false),
    createdByUserId: text("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    orgSolicitationUq: uniqueIndex(
      "solicitation_question_set_org_solicitation_uq",
    ).on(t.organizationId, t.solicitationId),
  }),
);

export type SolicitationQuestionSet =
  typeof solicitationQuestionSets.$inferSelect;
export type NewSolicitationQuestionSet =
  typeof solicitationQuestionSets.$inferInsert;

// ────────────────────────────────────────────────────────────────────
// Tenant-scoped audit log (BL-12)
// ────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────
// BD INTELLIGENCE SUITE (BL-25)
//
// Reference data + per-tenant capture artefacts that hang off the
// /intelligence routes. The 8(a) registry is global because it
// describes external firms (not user data); watchlists and saved
// searches are tenant-scoped.
// ────────────────────────────────────────────────────────────────────

/**
 * Socioeconomic cert codes supported by the registry. SAM.gov's
 * `sbaBusinessTypeCode` values are mapped to these short keys for
 * filtering/display. Add new codes here when expanding coverage.
 */
export const CERT_TYPES = [
  "8a",
  "hubzone",
  "wosb",
  "edwosb",
  "sdvosb",
  "vob",
  "native_american",
] as const;
export type CertType = (typeof CERT_TYPES)[number];

export const certFirms = pgTable(
  "cert_firm",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * SAM UEI. NOT globally unique — a single firm can hold multiple
     * certs (8(a) + HUBZone + WOSB, for example). Uniqueness is
     * enforced on (uei, cert_type) via `ueiCertTypeIdx`.
     */
    uei: text("uei").notNull(),
    /** '8a' | 'hubzone' | 'wosb' | 'edwosb' | 'sdvosb' | 'vob' | 'native_american' */
    certType: text("cert_type").notNull().default("8a"),
    firmName: text("firm_name").notNull(),
    firmNameNorm: text("firm_name_norm").notNull().default(""),
    certEntryDate: timestamp("cert_entry_date", { mode: "date" }),
    certExitDate: timestamp("cert_exit_date", { mode: "date" }),
    status: text("status").notNull().default("unknown"),
    naicsPrimary: text("naics_primary").notNull().default(""),
    city: text("city").notNull().default(""),
    state: text("state").notNull().default(""),
    source: text("source").notNull().default(""),
    sourceUpdatedAt: timestamp("source_updated_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    ueiCertTypeIdx: uniqueIndex("cert_firm_uei_cert_type_idx").on(
      t.uei,
      t.certType,
    ),
    nameNormIdx: index("cert_firm_name_norm_idx").on(t.firmNameNorm),
    exitDateIdx: index("cert_firm_exit_date_idx").on(t.certExitDate),
  }),
);

export type CertFirm = typeof certFirms.$inferSelect;

export const certImportRuns = pgTable(
  "cert_import_run",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    startedAt: timestamp("started_at").notNull().defaultNow(),
    finishedAt: timestamp("finished_at"),
    status: text("status").notNull().default("running"),
    /** Which cert type the pull targeted ('8a', 'hubzone', ...). */
    certType: text("cert_type").notNull().default("8a"),
    source: text("source").notNull().default(""),
    rowsSeen: integer("rows_seen").notNull().default(0),
    rowsUpserted: integer("rows_upserted").notNull().default(0),
    error: text("error").notNull().default(""),
  },
  (t) => ({
    startedIdx: index("cert_import_run_started_idx").on(t.startedAt),
  }),
);

export type CertImportRun = typeof certImportRuns.$inferSelect;

/**
 * Singleton key/value store for platform-wide (non-tenant) settings.
 * First user is the cert-retention threshold for the monthly refresh
 * cron. Pattern is intentional: don't spin a fresh table for each
 * little knob.
 */
export const platformSettings = pgTable("platform_setting", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  updatedBy: text("updated_by").references(() => users.id, {
    onDelete: "set null",
  }),
});

export type PlatformSetting = typeof platformSettings.$inferSelect;

export const bdWatchlistItems = pgTable(
  "bd_watchlist_item",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    /** 'award' | 'firm' */
    kind: text("kind").notNull(),
    /** USAspending generated_internal_id for awards; UEI for firms. */
    externalId: text("external_id").notNull(),
    label: text("label").notNull().default(""),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    notes: text("notes").notNull().default(""),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    orgKindExtIdx: uniqueIndex("bd_watchlist_item_org_kind_ext_idx").on(
      t.organizationId,
      t.kind,
      t.externalId,
    ),
    orgKindCreatedIdx: index("bd_watchlist_item_org_kind_created_idx").on(
      t.organizationId,
      t.kind,
      t.createdAt,
    ),
  }),
);

export type BdWatchlistItem = typeof bdWatchlistItems.$inferSelect;

export const bdSavedSearches = pgTable(
  "bd_saved_search",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    /** 'awards' | 'firms' */
    kind: text("kind").notNull(),
    criteria: jsonb("criteria")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    shared: boolean("shared").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    lastRunAt: timestamp("last_run_at"),
  },
  (t) => ({
    orgOwnerIdx: index("bd_saved_search_org_owner_idx").on(
      t.organizationId,
      t.createdBy,
      t.createdAt,
    ),
    orgSharedIdx: index("bd_saved_search_org_shared_idx").on(
      t.organizationId,
      t.shared,
      t.createdAt,
    ),
  }),
);

export type BdSavedSearch = typeof bdSavedSearches.$inferSelect;

export const auditLogs = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    actorUserId: text("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    /**
     * Email snapshot at time of action — survives later deletion of
     * the actor, so the log stays readable even after offboarding.
     */
    actorEmailSnapshot: text("actor_email_snapshot").notNull().default(""),
    /**
     * Free-form action verb. Convention: "<resource>.<verb>", e.g.
     *   opportunity.create, proposal.advance_stage, settings.update,
     *   user.invite, solicitation.upload, knowledge_entry.delete
     */
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull().default(""),
    resourceId: text("resource_id").notNull().default(""),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    ip: text("ip").notNull().default(""),
    userAgent: text("user_agent").notNull().default(""),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    orgCreatedIdx: index("audit_log_org_created_idx").on(
      t.organizationId,
      t.createdAt,
    ),
    orgResourceIdx: index("audit_log_org_resource_idx").on(
      t.organizationId,
      t.resourceType,
      t.resourceId,
    ),
    orgActorIdx: index("audit_log_org_actor_idx").on(
      t.organizationId,
      t.actorUserId,
      t.createdAt,
    ),
  }),
);

export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;

// ─────────────────────────────────────────────────────────────────────
// BL-16 — subscription tiers + tenant subscriptions
// ─────────────────────────────────────────────────────────────────────

export const tenantSubscriptionStatusEnum = pgEnum(
  "tenant_subscription_status",
  ["trial", "active", "past_due", "canceled", "paused"],
);
export type TenantSubscriptionStatus =
  (typeof tenantSubscriptionStatusEnum.enumValues)[number];

/**
 * Feature flags carried by a `subscription_tier.feature_flags` JSONB.
 * New flags are added here AND in a follow-up migration that bumps
 * existing rows' defaults. The runtime gate (BL-16 Phase B) reads
 * the merged shape: tier.feature_flags ⨯ tenant.custom_overrides.
 */
export type TierFeatureFlags = {
  aiAutoDraft: boolean;
  winnerAnalysis: boolean;
  complianceMatrix: boolean;
  bulkExport: boolean;
  apiAccess: boolean;
  customTemplates: boolean;
};

/**
 * Quotas carried by a `subscription_tier.quotas` JSONB. A value of `0`
 * means "unlimited" (Platinum semantics) so the type avoids needing a
 * sentinel value for unlimited.
 */
export type TierQuotas = {
  aiRequestsPerMonth: number;
  seatsIncluded: number;
  storageGb: number;
  proposalsPerMonth: number;
};

export const subscriptionTiers = pgTable(
  "subscription_tier",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: varchar("slug", { length: 32 }).notNull().unique(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    priceMonthlyCents: integer("price_monthly_cents").notNull().default(0),
    priceYearlyCents: integer("price_yearly_cents").notNull().default(0),
    featureFlags: jsonb("feature_flags")
      .$type<TierFeatureFlags>()
      .notNull()
      .default(
        sql`'{}'::jsonb` as unknown as TierFeatureFlags,
      ),
    quotas: jsonb("quotas")
      .$type<TierQuotas>()
      .notNull()
      .default(sql`'{}'::jsonb` as unknown as TierQuotas),
    sortOrder: integer("sort_order").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    sortIdx: index("subscription_tier_sort_idx").on(t.sortOrder),
  }),
);

export type SubscriptionTier = typeof subscriptionTiers.$inferSelect;
export type NewSubscriptionTier = typeof subscriptionTiers.$inferInsert;

export const tenantSubscriptions = pgTable(
  "tenant_subscription",
  {
    organizationId: uuid("organization_id")
      .primaryKey()
      .references(() => organizations.id, { onDelete: "cascade" }),
    tierId: uuid("tier_id")
      .notNull()
      .references(() => subscriptionTiers.id, { onDelete: "restrict" }),
    status: tenantSubscriptionStatusEnum("status").notNull().default("active"),
    currentPeriodStart: timestamp("current_period_start"),
    currentPeriodEnd: timestamp("current_period_end"),
    trialUntil: timestamp("trial_until"),
    cancelAt: timestamp("cancel_at"),
    /**
     * Per-tenant overrides on top of the tier defaults. Shape mirrors
     * the merged TierFeatureFlags + TierQuotas. Examples:
     *   { "quotas": { "aiRequestsPerMonth": 5000 } }
     *   { "featureFlags": { "winnerAnalysis": true } }
     * The runtime gate reads tier.X then applies overrides.X on top.
     */
    customOverrides: jsonb("custom_overrides")
      .$type<{
        featureFlags?: Partial<TierFeatureFlags>;
        quotas?: Partial<TierQuotas>;
      }>()
      .notNull()
      .default({}),
    notes: text("notes").notNull().default(""),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    tierIdx: index("tenant_subscription_tier_idx").on(t.tierId),
    statusIdx: index("tenant_subscription_status_idx").on(t.status),
  }),
);

export type TenantSubscription = typeof tenantSubscriptions.$inferSelect;
export type NewTenantSubscription = typeof tenantSubscriptions.$inferInsert;

/**
 * BL-16 Phase B-3a — quota counters.
 *
 * One row per (organization, quota key, monthly period). The helper
 * in `src/lib/subscription-gates.ts` performs an UPSERT on increment;
 * the composite PK (organization_id, key, period_start) ensures
 * idempotent writes. Old rows stay around as historical data.
 */
export const tenantUsageCounters = pgTable(
  "tenant_usage_counter",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    key: varchar("key", { length: 64 }).notNull(),
    periodStart: timestamp("period_start").notNull(),
    periodEnd: timestamp("period_end").notNull(),
    value: integer("value").notNull().default(0),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.organizationId, t.key, t.periodStart] }),
    periodIdx: index("tenant_usage_counter_period_idx").on(
      t.organizationId,
      t.key,
      t.periodEnd,
    ),
  }),
);

export type TenantUsageCounter = typeof tenantUsageCounters.$inferSelect;
export type NewTenantUsageCounter = typeof tenantUsageCounters.$inferInsert;

/**
 * BL-16 Phase C-4 — promotional codes.
 *
 * Global discount codes. Not tenant-scoped — a code applies at
 * redemption time. Times_used is a counter incremented per
 * redemption (real redemption flow lands with BL-17 billing).
 */
export const promotionCodes = pgTable(
  "promotion_code",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: varchar("code", { length: 64 }).notNull().unique(),
    description: text("description").notNull().default(""),
    discountPercent: integer("discount_percent").notNull().default(0),
    validFrom: timestamp("valid_from"),
    validUntil: timestamp("valid_until"),
    maxUses: integer("max_uses").notNull().default(0),
    timesUsed: integer("times_used").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    createdIdx: index("promotion_code_created_idx").on(t.createdAt),
  }),
);

export type PromotionCode = typeof promotionCodes.$inferSelect;
export type NewPromotionCode = typeof promotionCodes.$inferInsert;

// ─────────────────────────────────────────────────────────────────────
// BL-QC-errors — in-app production error log
// ─────────────────────────────────────────────────────────────────────

/**
 * Replaces what an external observability backend (e.g., Sentry) would
 * give us. Same idea — uncaught exceptions land here, grouped by a
 * fingerprint hashed from the stack trace's top frames so 1000 firings
 * of the same bug become 1 row with `occurrenceCount = 1000`.
 *
 * Organization context is captured when available but the column is
 * nullable — pre-auth errors (sign-in page crash, etc.) still get
 * logged with `organizationId = NULL`. The admin viewer at
 * `/admin/errors` is superadmin-scoped so it can see across tenants.
 */
export const productionErrors = pgTable(
  "production_error",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Null when the error happened before tenant context was resolved. */
    organizationId: uuid("organization_id").references(
      () => organizations.id,
      { onDelete: "set null" },
    ),
    /** Null for client-side and pre-auth errors. */
    userId: text("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    /**
     * SHA-256 of normalized stack trace (top 5 frames, line/column
     * numbers stripped). Drives dedup — same fingerprint → bump
     * occurrenceCount + update lastSeenAt instead of inserting a new
     * row.
     */
    fingerprint: text("fingerprint").notNull(),
    message: text("message").notNull(),
    stack: text("stack").notNull().default(""),
    /** "server" | "client" | "edge" — which runtime captured this. */
    runtime: text("runtime").notNull().default("server"),
    /** "production" | "preview" | "development" — VERCEL_ENV. */
    environment: text("environment").notNull().default(""),
    /** Path on the request that triggered the error (server-side only). */
    requestPath: text("request_path").notNull().default(""),
    requestMethod: text("request_method").notNull().default(""),
    httpStatus: integer("http_status"),
    userAgent: text("user_agent").notNull().default(""),
    /** Vercel deploy SHA when the error fired (helps correlate to git). */
    releaseSha: text("release_sha").notNull().default(""),
    firstSeenAt: timestamp("first_seen_at").notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
    occurrenceCount: integer("occurrence_count").notNull().default(1),
    /** Set when an operator marks the issue as triaged. */
    acknowledgedAt: timestamp("acknowledged_at"),
    acknowledgedByUserId: text("acknowledged_by_user_id").references(
      () => users.id,
      { onDelete: "set null" },
    ),
    /** Set when the underlying bug has been fixed + verified. */
    resolvedAt: timestamp("resolved_at"),
    resolvedByUserId: text("resolved_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    notes: text("notes").notNull().default(""),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    fingerprintIdx: uniqueIndex("production_error_fingerprint_idx").on(
      t.fingerprint,
    ),
    lastSeenIdx: index("production_error_last_seen_idx").on(t.lastSeenAt),
    orgLastSeenIdx: index("production_error_org_last_seen_idx").on(
      t.organizationId,
      t.lastSeenAt,
    ),
    unresolvedIdx: index("production_error_unresolved_idx")
      .on(t.lastSeenAt)
      .where(sql`${t.resolvedAt} IS NULL`),
  }),
);

export type ProductionError = typeof productionErrors.$inferSelect;
export type NewProductionError = typeof productionErrors.$inferInsert;

/**
 * BL-9 Slice 1 — Yjs document persistence for the collaborative
 * editor. One row per (organization_id, doc_name); rewritten by the
 * Hocuspocus service (services/collab/) on every debounced commit.
 *
 * See drizzle/0053_yjs_doc.sql and docs/architecture/collab-editor.md.
 *
 * The Next app does not read or write this table in Slice 1 — the
 * Drizzle const exists so the multi-tenant isolation check sees the
 * canonical TS identifier for `yjs_doc`, and so any future server-side
 * access path (e.g. a snapshot/export endpoint) goes through Drizzle
 * with the existing `organizationId` discipline.
 */
export const yjsDocs = pgTable(
  "yjs_doc",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    docName: text("doc_name").notNull(),
    state: bytea("state").notNull(),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    orgNameUq: uniqueIndex("yjs_doc_org_name_uq").on(
      t.organizationId,
      t.docName,
    ),
    orgUpdatedIdx: index("yjs_doc_org_updated_idx").on(
      t.organizationId,
      t.updatedAt,
    ),
  }),
);

export type YjsDoc = typeof yjsDocs.$inferSelect;
export type NewYjsDoc = typeof yjsDocs.$inferInsert;
