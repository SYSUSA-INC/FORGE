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
  status: proposalSectionStatusEnum("status").notNull().default("not_started"),
  wordCount: integer("word_count").notNull().default(0),
  pageLimit: integer("page_limit"),
  authorUserId: text("author_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

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
