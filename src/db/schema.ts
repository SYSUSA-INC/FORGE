import {
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  varchar,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

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
    .default([]),

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
    .default([]),

  searchKeywords: text("search_keywords")
    .array()
    .notNull()
    .default(sql`ARRAY[]::text[]`),

  syncSource: text("sync_source").notNull().default("none"),
  lastSyncedAt: timestamp("last_synced_at"),

  disabledAt: timestamp("disabled_at"),

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
});

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
});

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
});

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
});

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
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

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
});

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
export type NotificationKind = (typeof notificationKindEnum.enumValues)[number];

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

export const proposalTemplates = pgTable("proposal_template", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  isDefault: boolean("is_default").notNull().default(false),
  archivedAt: timestamp("archived_at"),

  // HTML/CSS template content (for the future PDF chapter)
  coverHtml: text("cover_html").notNull().default(""),
  headerHtml: text("header_html").notNull().default(""),
  footerHtml: text("footer_html").notNull().default(""),
  pageCss: text("page_css").notNull().default(""),

  // Section seed list — array of { kind, title, ordering }
  sectionSeed: jsonb("section_seed")
    .$type<TemplateSectionSeed[]>()
    .notNull()
    .default([]),

  // Branding tokens
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
    .default([]),

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
  archivedAt: timestamp("archived_at"),
  createdByUserId: text("created_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type KnowledgeEntry = typeof knowledgeEntries.$inferSelect;
export type NewKnowledgeEntry = typeof knowledgeEntries.$inferInsert;
export type KnowledgeKind = (typeof knowledgeKindEnum.enumValues)[number];
