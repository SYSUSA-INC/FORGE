/**
 * Settings page status helpers.
 *
 * Server-only — these functions read env vars and DB to surface what's
 * actually wired up so the Settings tabs can be honest status panels
 * instead of "Coming soon" placeholders. Env vars don't reach the
 * browser, so each detection has to run on the server and serialize
 * its result down to the client.
 */
import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { memberships, users, type Role } from "@/db/schema";
import { getAIProviderStatus, type AIProviderStatus } from "@/lib/ai";

// ────────────────────────────────────────────────────────────────────
// Members summary (Users & Roles tab)
// ────────────────────────────────────────────────────────────────────

export type MembersSummary = {
  total: number;
  byRole: Record<Role, number>;
  recent: {
    userId: string;
    name: string;
    email: string;
    role: Role;
    joinedAt: string;
  }[];
};

const ROLE_KEYS: Role[] = [
  "admin",
  "capture",
  "proposal",
  "author",
  "reviewer",
  "pricing",
  "viewer",
];

export async function getMembersSummary(
  organizationId: string,
): Promise<MembersSummary> {
  const rows = await db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      role: memberships.role,
      joinedAt: memberships.createdAt,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.organizationId, organizationId),
        eq(memberships.status, "active"),
      ),
    );

  const byRole: Record<Role, number> = {
    admin: 0,
    capture: 0,
    proposal: 0,
    author: 0,
    reviewer: 0,
    pricing: 0,
    viewer: 0,
  };
  for (const r of rows) byRole[r.role] = (byRole[r.role] ?? 0) + 1;

  const recent = rows
    .slice()
    .sort((a, b) => b.joinedAt.getTime() - a.joinedAt.getTime())
    .slice(0, 5)
    .map((r) => ({
      userId: r.userId,
      name: r.name ?? "",
      email: r.email,
      role: r.role,
      joinedAt: r.joinedAt.toISOString(),
    }));

  return { total: rows.length, byRole, recent };
}

// ────────────────────────────────────────────────────────────────────
// Integration statuses (Integrations tab)
// ────────────────────────────────────────────────────────────────────

export type IntegrationStatus = {
  key: string;
  name: string;
  category: "data" | "ai" | "output" | "email";
  configured: boolean;
  /** Short description of what this integration powers. */
  powers: string;
  /** Specifically what's missing if not configured, or what's set if it is. */
  detail: string;
};

function envSet(name: string): boolean {
  const v = process.env[name];
  return typeof v === "string" && v.trim().length > 0;
}

export function getIntegrationStatuses(): IntegrationStatus[] {
  return [
    {
      key: "samgov",
      name: "SAM.gov",
      category: "data",
      configured: envSet("SAMGOV_API_KEY"),
      powers:
        "Opportunity search and import, entity (UEI/CAGE) lookups for organizations and competitors.",
      detail: envSet("SAMGOV_API_KEY")
        ? "SAMGOV_API_KEY is set."
        : "Set SAMGOV_API_KEY on Vercel. Free key from sam.gov/data-services.",
    },
    {
      key: "usaspending",
      name: "USAspending.gov",
      category: "data",
      configured: true,
      powers:
        "Past-performance import — pull federal contract awards by recipient name or UEI.",
      detail:
        "No credentials required (public API). Available out of the box.",
    },
    {
      key: "anthropic",
      name: "Anthropic (Claude)",
      category: "ai",
      configured: envSet("ANTHROPIC_API_KEY"),
      powers:
        "AI section drafting, Brain extraction, vision OCR for image artifacts, opportunity briefs.",
      detail: envSet("ANTHROPIC_API_KEY")
        ? "ANTHROPIC_API_KEY is set."
        : "Set ANTHROPIC_API_KEY on Vercel. Without it, AI features run in stub mode.",
    },
    {
      key: "openai",
      name: "OpenAI Embeddings",
      category: "ai",
      configured: envSet("OPENAI_API_KEY"),
      powers:
        "Vector embeddings (text-embedding-3-small, 1536-dim) for the Knowledge Brain semantic search.",
      detail: envSet("OPENAI_API_KEY")
        ? "OPENAI_API_KEY is set."
        : "Set OPENAI_API_KEY on Vercel. Without it, search falls back to keyword-only.",
    },
    {
      key: "browserless",
      name: "Browserless",
      category: "output",
      configured: envSet("BROWSERLESS_API_KEY"),
      powers: "HTML → PDF rendering for proposal exports.",
      detail: envSet("BROWSERLESS_API_KEY")
        ? "BROWSERLESS_API_KEY is set."
        : "Set BROWSERLESS_API_KEY on Vercel. Without it, PDF export is unavailable.",
    },
    {
      key: "cloudconvert",
      name: "CloudConvert",
      category: "output",
      configured: envSet("CLOUDCONVERT_API_KEY"),
      powers:
        "DOCX → PDF conversion when proposals are rendered through a Word template.",
      detail: envSet("CLOUDCONVERT_API_KEY")
        ? "CLOUDCONVERT_API_KEY is set."
        : "Set CLOUDCONVERT_API_KEY on Vercel. Without it, DOCX-template PDFs are unavailable.",
    },
    {
      key: "resend",
      name: "Resend",
      category: "email",
      configured: envSet("RESEND_API_KEY"),
      powers:
        "Outbound mail: invitations, password resets, opportunity review requests.",
      detail: envSet("RESEND_API_KEY")
        ? `RESEND_API_KEY is set. From: ${process.env.EMAIL_FROM ?? "Forge <noreply@sysgov.com>"}.`
        : "Set RESEND_API_KEY on Vercel. Without it, emails are logged but not sent.",
    },
  ];
}

// ────────────────────────────────────────────────────────────────────
// AI Engine status (AI Engine tab)
// ────────────────────────────────────────────────────────────────────

export type AIFeatureStatus = {
  key: string;
  name: string;
  /** Human-readable description of what this feature does. */
  description: string;
  /** True when the underlying provider is configured for live operation. */
  live: boolean;
  /** Why it's live or stubbed. */
  detail: string;
};

export type AIEngineStatus = {
  active: AIProviderStatus;
  providers: AIProviderStatus[];
  defaultModel: string;
  embeddingsConfigured: boolean;
  features: AIFeatureStatus[];
};

export function getAIEngineStatus(): AIEngineStatus {
  const { active, all } = getAIProviderStatus();
  const anthropicLive = all.find((p) => p.name === "anthropic")?.configured === true;
  const embeddingsLive = envSet("OPENAI_API_KEY");
  const visionLive = anthropicLive; // vision is Anthropic-only
  const aiLive = active.configured && active.name !== "stub";

  return {
    active,
    providers: all,
    defaultModel: process.env.AI_DEFAULT_MODEL ?? "claude-sonnet-4-6",
    embeddingsConfigured: embeddingsLive,
    features: [
      {
        key: "section_drafter",
        name: "Section drafting",
        description:
          "Generate technical, management, and past-performance section drafts from solicitation requirements + Brain context.",
        live: aiLive,
        detail: aiLive
          ? `Live via ${active.name}.`
          : "Stub mode — set the active provider's env vars to go live.",
      },
      {
        key: "brain_extraction",
        name: "Brain extraction (10c)",
        description:
          "Mines structured knowledge_entry candidates from uploaded artifacts (proposals, RFPs, debriefs).",
        live: aiLive,
        detail: aiLive
          ? `Live via ${active.name}.`
          : "Stub returns one placeholder candidate per artifact.",
      },
      {
        key: "embeddings",
        name: "Semantic search (10d)",
        description:
          "pgvector-backed similarity search over the corpus and curated knowledge entries.",
        live: embeddingsLive,
        detail: embeddingsLive
          ? "OpenAI text-embedding-3-small (1536-dim)."
          : "Stub returns deterministic mock vectors. Set OPENAI_API_KEY to go live.",
      },
      {
        key: "brain_suggest",
        name: "Brain Suggest in editor (10e)",
        description:
          "Real-time suggestions inside the section editor pulling from the Brain.",
        live: aiLive && embeddingsLive,
        detail:
          aiLive && embeddingsLive
            ? "Live."
            : !embeddingsLive
              ? "Needs OPENAI_API_KEY for embeddings."
              : "Needs an active AI provider.",
      },
      {
        key: "vision_ocr",
        name: "Image OCR (10g)",
        description:
          "Claude vision transcribes JPG/PNG/WebP/GIF artifacts into raw_text.",
        live: visionLive,
        detail: visionLive
          ? "Live via Anthropic vision."
          : "Anthropic-only. Set ANTHROPIC_API_KEY.",
      },
      {
        key: "opportunity_brief",
        name: "Opportunity briefs (6d)",
        description:
          "Per-opportunity AI summary on the opportunity detail page.",
        live: aiLive,
        detail: aiLive
          ? `Live via ${active.name}.`
          : "Stub returns a deterministic placeholder.",
      },
      {
        key: "intake_extraction",
        name: "Solicitation intake (8)",
        description:
          "AI extracts agency / NAICS / due date / requirements from uploaded RFPs.",
        live: aiLive,
        detail: aiLive
          ? `Live via ${active.name}.`
          : "Stub mode — manual entry only.",
      },
    ],
  };
}
